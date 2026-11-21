package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
)

func TestCSVCellEscapesFormulaAndQuotes(t *testing.T) {
	if got := exportCell(`=SUM("x")`); got != `"'=SUM(""x"")"` {
		t.Fatalf("escaped cell = %q", got)
	}
	if got := exportCell("hello,\nworld"); got != "\"hello,\nworld\"" {
		t.Fatalf("escaped newline = %q", got)
	}
}

func TestExportJSONMatchesExistingShape(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server, mock := writeTestServer(t)
	mock.ExpectQuery("SELECT count\\(\\*\\) FROM `datasets`").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectQuery("SELECT .* FROM `comments`").WillReturnRows(sqlmock.NewRows([]string{
		"id", "datasetId", "content", "author", "platform", "timestamp", "sentiment", "sentimentScore", "topics",
	}).AddRow(11, "7", "content", "author", "store", time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC), "neg", -0.8, `["性能"]`))
	w := httptest.NewRecorder()
	server.Router().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/datasets/7/export?format=json", nil))
	if w.Code != 200 {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	var body struct {
		Comments []struct {
			ID     string   `json:"id"`
			Topics []string `json:"topics"`
		} `json:"comments"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Comments) != 1 || body.Comments[0].ID != "11" || body.Comments[0].Topics[0] != "性能" {
		t.Fatalf("body: %s", w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestExportCSVPreservesHeaderAndEscapesFormula(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server, mock := writeTestServer(t)
	mock.ExpectQuery("SELECT count\\(\\*\\) FROM `datasets`").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectQuery("SELECT .* FROM `comments`").WillReturnRows(sqlmock.NewRows([]string{
		"id", "datasetId", "content", "author", "platform", "timestamp", "sentiment", "topics",
	}).AddRow(11, "7", "=1+1", "author", "store", time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC), "neg", `["性能"]`))
	w := httptest.NewRecorder()
	server.Router().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/datasets/7/export?format=csv", nil))
	if w.Code != 200 || !strings.HasPrefix(w.Body.String(), "\ufeffcontent,author,platform,timestamp,sentiment,topics\r\n") || !strings.Contains(w.Body.String(), `"'=1+1"`) {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
