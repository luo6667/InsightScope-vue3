package api

import (
	"errors"
	"net/http"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
)

func TestDeleteDatasetRemovesRelatedRecordsAtomically(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server, mock := writeTestServer(t)
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT .* FROM `datasets` .* FOR UPDATE").WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(8))
	mock.ExpectExec("DELETE FROM `analysis_job_secrets`").WillReturnResult(sqlmock.NewResult(0, 1))
	for _, table := range []string{"comments", "analysis_jobs", "alerts", "alert_rules", "datasets"} {
		mock.ExpectExec("DELETE FROM `" + table + "`").WillReturnResult(sqlmock.NewResult(0, 1))
	}
	mock.ExpectCommit()
	w := requestJSON(server, http.MethodDelete, "/api/datasets/8", "")
	if w.Code != http.StatusOK || w.Body.String() != `{"ok":true}` {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDeleteDatasetRollsBackOnFailure(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server, mock := writeTestServer(t)
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT .* FROM `datasets` .* FOR UPDATE").WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(8))
	mock.ExpectExec("DELETE FROM `analysis_job_secrets`").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("DELETE FROM `comments`").WillReturnError(errors.New("write failed"))
	mock.ExpectRollback()
	w := requestJSON(server, http.MethodDelete, "/api/datasets/8", "")
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDeleteMissingDatasetReturns404(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server, mock := writeTestServer(t)
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT .* FROM `datasets` .* FOR UPDATE").WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectRollback()
	w := requestJSON(server, http.MethodDelete, "/api/datasets/8", "")
	if w.Code != http.StatusNotFound {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
