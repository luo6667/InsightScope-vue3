package analysis

import (
	"context"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/hibiken/asynq"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"

	"insightscope/go-backend/internal/tasks"
)

func TestWorkerRejectsMalformedTaskWithoutDatabase(t *testing.T) {
	worker := Worker{}
	if err := worker.Handle(context.Background(), asynq.NewTask(tasks.AnalysisType, []byte(`{"jobId":0}`))); !errors.Is(err, asynq.SkipRetry) {
		t.Fatalf("unexpected error: %v", err)
	}
}

type fakeEvents struct{ Names []string }

func (e *fakeEvents) Publish(_ context.Context, _ string, name string, _ any) error {
	e.Names = append(e.Names, name)
	return nil
}

func TestWorkerWritesResultAndProgressBeforeClearingSecret(t *testing.T) {
	sqlDB, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	db, err := gorm.Open(mysql.New(mysql.Config{Conn: sqlDB, SkipInitializeWithVersion: true}), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	cipher, err := NewCredentials(base64.StdEncoding.EncodeToString([]byte(strings.Repeat("k", 32))))
	if err != nil {
		t.Fatal(err)
	}
	nonce, encrypted, err := cipher.Encrypt(42, AIConfig{APIKey: "secret", BaseURL: "https://api.example.com", Model: "test", Temperature: 0.2})
	if err != nil {
		t.Fatal(err)
	}
	jobRows := func(status string, processed int) *sqlmock.Rows {
		return sqlmock.NewRows([]string{"id", "datasetId", "status", "total", "processed", "failed", "concurrency"}).AddRow(42, "8", status, 1, processed, 0, 6)
	}
	mock.ExpectQuery("SELECT .* FROM `analysis_jobs`").WillReturnRows(jobRows("pending", 0))
	mock.ExpectQuery("SELECT .* FROM `analysis_job_secrets`").WillReturnRows(sqlmock.NewRows([]string{"jobId", "nonce", "ciphertext"}).AddRow(42, nonce, encrypted))
	mock.ExpectQuery("SELECT count\\(\\*\\) FROM `comments`").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectBegin()
	mock.ExpectExec("UPDATE `analysis_jobs`").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	mock.ExpectQuery("SELECT .* FROM `analysis_jobs`").WillReturnRows(jobRows("running", 0))
	mock.ExpectQuery("SELECT .* FROM `comments`").WillReturnRows(sqlmock.NewRows([]string{"id", "content"}).AddRow(5, "good"))
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT .* FROM `analysis_jobs` .* FOR UPDATE").WillReturnRows(jobRows("running", 0))
	mock.ExpectExec("UPDATE `comments`").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE `analysis_jobs`").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	mock.ExpectQuery("SELECT .* FROM `analysis_jobs`").WillReturnRows(jobRows("running", 1))
	mock.ExpectQuery("SELECT .* FROM `comments`").WillReturnRows(sqlmock.NewRows([]string{"id", "content"}))
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT .* FROM `analysis_jobs` .* FOR UPDATE").WillReturnRows(jobRows("running", 1))
	mock.ExpectQuery("SELECT count\\(\\*\\) FROM `comments`").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	mock.ExpectExec("UPDATE `analysis_jobs`").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("DELETE FROM `analysis_job_secrets`").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	model := LLM{Client: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"choices":[{"message":{"content":"[{\"sentiment\":\"pos\",\"topics\":[\"性能\"],\"keywords\":[\"流畅\"]}]"}}]}`)), Header: http.Header{}}, nil
	})}}
	events := &fakeEvents{}
	task, err := tasks.Analysis(42)
	if err != nil {
		t.Fatal(err)
	}
	if err := (Worker{DB: db, Credentials: cipher, Model: model, Events: events}).Handle(context.Background(), task); err != nil {
		t.Fatal(err)
	}
	if len(events.Names) != 2 || events.Names[0] != "analysis:progress" || events.Names[1] != "analysis:progress" {
		t.Fatalf("events: %+v", events.Names)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestWorkerCompletesEmptyJobAndClearsSecret(t *testing.T) {
	sqlDB, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	db, err := gorm.Open(mysql.New(mysql.Config{Conn: sqlDB, SkipInitializeWithVersion: true}), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	cipher, err := NewCredentials(base64.StdEncoding.EncodeToString([]byte(strings.Repeat("k", 32))))
	if err != nil {
		t.Fatal(err)
	}
	nonce, encrypted, err := cipher.Encrypt(42, AIConfig{APIKey: "secret", BaseURL: "https://api.example.com", Model: "test", Temperature: 0.2})
	if err != nil {
		t.Fatal(err)
	}
	jobRows := func(status string) *sqlmock.Rows {
		return sqlmock.NewRows([]string{"id", "datasetId", "status", "total", "processed", "failed", "concurrency"}).AddRow(42, "8", status, 0, 0, 0, 6)
	}
	mock.ExpectQuery("SELECT .* FROM `analysis_jobs`").WillReturnRows(jobRows("pending"))
	mock.ExpectQuery("SELECT .* FROM `analysis_job_secrets`").WillReturnRows(sqlmock.NewRows([]string{"jobId", "nonce", "ciphertext"}).AddRow(42, nonce, encrypted))
	mock.ExpectQuery("SELECT count\\(\\*\\) FROM `comments`").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	mock.ExpectBegin()
	mock.ExpectExec("UPDATE `analysis_jobs`").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	mock.ExpectQuery("SELECT .* FROM `analysis_jobs`").WillReturnRows(jobRows("running"))
	mock.ExpectQuery("SELECT .* FROM `comments`").WillReturnRows(sqlmock.NewRows([]string{"id", "content"}))
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT .* FROM `analysis_jobs` .* FOR UPDATE").WillReturnRows(jobRows("running"))
	mock.ExpectQuery("SELECT count\\(\\*\\) FROM `comments`").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	mock.ExpectExec("UPDATE `analysis_jobs`").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("DELETE FROM `analysis_job_secrets`").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	task, err := tasks.Analysis(42)
	if err != nil {
		t.Fatal(err)
	}
	if err := (Worker{DB: db, Credentials: cipher}).Handle(context.Background(), task); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestWorkerIgnoresDeletedJob(t *testing.T) {
	sqlDB, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	db, err := gorm.Open(mysql.New(mysql.Config{Conn: sqlDB, SkipInitializeWithVersion: true}), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectQuery("SELECT .* FROM `analysis_jobs`").WillReturnRows(sqlmock.NewRows([]string{"id"}))
	task, err := tasks.Analysis(42)
	if err != nil {
		t.Fatal(err)
	}
	if err := (Worker{DB: db}).Handle(context.Background(), task); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
