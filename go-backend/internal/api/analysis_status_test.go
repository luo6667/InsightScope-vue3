package api

import (
	"net/http"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
)

func TestGetAnalysisStatusReturnsLatestJobWithStringIDs(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server, mock := writeTestServer(t)
	now := time.Date(2026, 11, 21, 8, 0, 0, 0, time.UTC)
	mock.ExpectQuery("SELECT .* FROM `analysis_jobs` .*ORDER BY createdAt DESC.*LIMIT").WillReturnRows(sqlmock.NewRows([]string{"id", "datasetId", "status", "total", "processed", "failed", "concurrency", "createdAt", "updatedAt"}).AddRow(17, "8", "running", 10, 3, 1, 4, now, now))
	w := requestJSON(server, http.MethodGet, "/api/datasets/8/analysis", "")
	if w.Code != http.StatusOK || w.Body.String() != `{"job":{"id":"17","datasetId":"8","status":"running","total":10,"processed":3,"failed":1,"concurrency":4,"createdAt":"2026-11-21T08:00:00Z","updatedAt":"2026-11-21T08:00:00Z"}}` {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestGetAnalysisStatusReturnsNullWhenNoJob(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server, mock := writeTestServer(t)
	mock.ExpectQuery("SELECT .* FROM `analysis_jobs` .*ORDER BY createdAt DESC.*LIMIT").WillReturnRows(sqlmock.NewRows([]string{"id"}))
	w := requestJSON(server, http.MethodGet, "/api/datasets/8/analysis", "")
	if w.Code != http.StatusOK || w.Body.String() != `{"job":null}` {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
