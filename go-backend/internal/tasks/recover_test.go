package tasks

import (
	"context"
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

type recordingQueue struct {
	IDs []uint64
	Err error
}

func (q *recordingQueue) EnqueueAnalysis(_ context.Context, id uint64) error {
	q.IDs = append(q.IDs, id)
	return q.Err
}

func TestRecoverClearsTerminalSecretsAndRequeuesActiveJobs(t *testing.T) {
	sqlDB, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	db, err := gorm.Open(mysql.New(mysql.Config{Conn: sqlDB, SkipInitializeWithVersion: true}), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectBegin()
	mock.ExpectExec("DELETE FROM `analysis_job_secrets`").WillReturnResult(sqlmock.NewResult(0, 2))
	mock.ExpectCommit()
	mock.ExpectQuery("SELECT analysis_jobs.id FROM `analysis_jobs` JOIN analysis_job_secrets").WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(42).AddRow(43))
	queue := &recordingQueue{}
	if err := Recover(context.Background(), db, queue); err != nil {
		t.Fatal(err)
	}
	if len(queue.IDs) != 2 || queue.IDs[0] != 42 || queue.IDs[1] != 43 {
		t.Fatalf("queued IDs: %+v", queue.IDs)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestRecoverKeepsJobForNextStartupWhenQueueFails(t *testing.T) {
	sqlDB, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	db, err := gorm.Open(mysql.New(mysql.Config{Conn: sqlDB, SkipInitializeWithVersion: true}), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectBegin()
	mock.ExpectExec("DELETE FROM `analysis_job_secrets`").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectCommit()
	mock.ExpectQuery("SELECT analysis_jobs.id FROM `analysis_jobs` JOIN analysis_job_secrets").WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(42))
	queue := &recordingQueue{Err: errors.New("redis down")}
	if err := Recover(context.Background(), db, queue); err == nil {
		t.Fatal("queue failure should stop startup recovery")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
