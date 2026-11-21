package api

import (
	"context"
	"net/http"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
)

type recordedEvent struct {
	Name      string
	DatasetID string
}

func (e *recordedEvent) Publish(_ context.Context, datasetID, name string, _ any) error {
	e.Name = name
	e.DatasetID = datasetID
	return nil
}

func TestPauseAndResumeAnalysisKeepExistingResponses(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server, mock := writeTestServer(t)
	mock.ExpectQuery("SELECT .* FROM `analysis_jobs`").WillReturnRows(sqlmock.NewRows([]string{"id", "datasetId", "status"}).AddRow(42, "8", "running"))
	mock.ExpectBegin()
	mock.ExpectExec("UPDATE `analysis_jobs`").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	w := requestJSON(server, http.MethodPost, "/api/datasets/8/analysis/pause", "")
	if w.Code != http.StatusOK || w.Body.String() != `{"ok":true}` {
		t.Fatalf("pause: %d %s", w.Code, w.Body.String())
	}
	queue := &fakeAnalysisQueue{}
	server.Queue = queue
	mock.ExpectQuery("SELECT .* FROM `analysis_jobs`").WillReturnRows(sqlmock.NewRows([]string{"id", "datasetId", "status"}).AddRow(42, "8", "paused"))
	mock.ExpectBegin()
	mock.ExpectExec("UPDATE `analysis_jobs`").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	w = requestJSON(server, http.MethodPost, "/api/datasets/8/analysis/resume", "")
	if w.Code != http.StatusOK || w.Body.String() != `{"ok":true}` || queue.JobID != 42 {
		t.Fatalf("resume: %d %s job %d", w.Code, w.Body.String(), queue.JobID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCancelAnalysisClearsStoredCredentials(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server, mock := writeTestServer(t)
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT .* FROM `analysis_jobs` .* FOR UPDATE").WillReturnRows(sqlmock.NewRows([]string{"id", "datasetId", "status"}).AddRow(42, "8", "running"))
	mock.ExpectExec("UPDATE `analysis_jobs`").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("DELETE FROM `analysis_job_secrets`").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	w := requestJSON(server, http.MethodPost, "/api/datasets/8/analysis/cancel", "")
	if w.Code != http.StatusOK || w.Body.String() != `{"ok":true}` {
		t.Fatalf("cancel: %d %s", w.Code, w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestResetAnalysisClearsJobsSecretsAndCommentLabels(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server, mock := writeTestServer(t)
	event := &recordedEvent{}
	server.Events = event
	mock.ExpectBegin()
	mock.ExpectExec("DELETE FROM `analysis_job_secrets`").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("DELETE FROM `analysis_jobs`").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE `comments`").WillReturnResult(sqlmock.NewResult(0, 3))
	mock.ExpectCommit()
	w := requestJSON(server, http.MethodPost, "/api/datasets/8/analysis/reset", "")
	if w.Code != http.StatusOK || w.Body.String() != `{"ok":true,"reset":3}` || event.Name != "analysis:reset" || event.DatasetID != "8" {
		t.Fatalf("reset: %d %s event %+v", w.Code, w.Body.String(), event)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
