package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"

	"insightscope/go-backend/internal/analysis"
)

type fakeAnalysisQueue struct {
	JobID uint64
	Err   error
}

func (q *fakeAnalysisQueue) EnqueueAnalysis(_ context.Context, id uint64) error {
	q.JobID = id
	return q.Err
}

func analysisTestServer(t *testing.T) (Server, sqlmock.Sqlmock, *fakeAnalysisQueue) {
	t.Helper()
	server, mock := writeTestServer(t)
	cipher, err := analysis.NewCredentials(base64.StdEncoding.EncodeToString([]byte(strings.Repeat("k", 32))))
	if err != nil {
		t.Fatal(err)
	}
	queue := &fakeAnalysisQueue{}
	server.Credentials = cipher
	server.Queue = queue
	return server, mock, queue
}

func TestCreateAnalysisRejectsPrivateURLBeforeDatabase(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := requestJSON(Server{}, http.MethodPost, "/api/datasets/8/analysis", `{"apiKey":"secret","baseUrl":"http://127.0.0.1:8000/v1","model":"test"}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
}

func TestCreateAnalysisStoresEncryptedConfigAndQueuesOnlyJobID(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server, mock, queue := analysisTestServer(t)
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT .* FROM `datasets` .* FOR UPDATE").WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(8))
	mock.ExpectQuery("SELECT .* FROM `analysis_jobs`").WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectExec("INSERT INTO `analysis_jobs`").WillReturnResult(sqlmock.NewResult(42, 1))
	mock.ExpectExec("INSERT INTO `analysis_job_secrets`").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	w := requestJSON(server, http.MethodPost, "/api/datasets/8/analysis", `{"apiKey":"secret-api-key","baseUrl":"https://api.example.com/v1","model":"model-a"}`)
	if w.Code != http.StatusCreated || queue.JobID != 42 || strings.Contains(w.Body.String(), "secret-api-key") {
		t.Fatalf("status %d queue %d: %s", w.Code, queue.JobID, w.Body.String())
	}
	var body struct {
		Job analysisJobResponse `json:"job"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Job.ID != "42" || body.Job.DatasetID != "8" || body.Job.Status != "pending" || body.Job.Concurrency != 6 {
		t.Fatalf("unexpected job: %+v", body.Job)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCreateAnalysisQueueFailureReturns503AndClearsSecret(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server, mock, queue := analysisTestServer(t)
	queue.Err = errors.New("redis unavailable")
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT .* FROM `datasets` .* FOR UPDATE").WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(8))
	mock.ExpectQuery("SELECT .* FROM `analysis_jobs`").WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectExec("INSERT INTO `analysis_jobs`").WillReturnResult(sqlmock.NewResult(42, 1))
	mock.ExpectExec("INSERT INTO `analysis_job_secrets`").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	mock.ExpectBegin()
	mock.ExpectExec("DELETE FROM `analysis_job_secrets`").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE `analysis_jobs`").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	w := requestJSON(server, http.MethodPost, "/api/datasets/8/analysis", `{"apiKey":"secret","baseUrl":"https://api.example.com","model":"test"}`)
	if w.Code != http.StatusServiceUnavailable || strings.Contains(w.Body.String(), "secret") {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
