package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

func TestCommentListRejectsInvalidQueryBeforeDatabaseAccess(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, path := range []string{
		"/api/datasets/1/comments?limit=101",
		"/api/datasets/1/comments?sentiment=bad",
		"/api/datasets/1/comments?from=not-a-date",
		"/api/datasets/1/comments?topic=%20",
	} {
		w := httptest.NewRecorder()
		(Server{}).Router().ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		if w.Code != http.StatusBadRequest {
			t.Errorf("%s: got %d, want 400", path, w.Code)
		}
	}
}

func TestCommentListReturnsDatasetNotFound(t *testing.T) {
	gin.SetMode(gin.TestMode)
	sqlDB, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	db, err := gorm.Open(mysql.New(mysql.Config{Conn: sqlDB, SkipInitializeWithVersion: true}), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectQuery("SELECT .* FROM `datasets`").WillReturnRows(sqlmock.NewRows([]string{"id"}))
	w := httptest.NewRecorder()
	(Server{DB: db}).Router().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/datasets/999/comments", nil))
	if w.Code != http.StatusNotFound {
		t.Fatalf("got %d: %s", w.Code, w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCommentListKeepsResponseShape(t *testing.T) {
	gin.SetMode(gin.TestMode)
	sqlDB, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	db, err := gorm.Open(mysql.New(mysql.Config{Conn: sqlDB, SkipInitializeWithVersion: true}), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectQuery("SELECT .* FROM `datasets`").WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(7))
	mock.ExpectQuery("SELECT count\\(\\*\\) FROM `comments`").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectQuery("SELECT .* FROM `comments`").WillReturnRows(sqlmock.NewRows([]string{
		"id", "datasetId", "content", "author", "platform", "timestamp", "sentiment", "sentimentScore", "topics", "keywords", "analyzed",
	}).AddRow(99, "7", "闪退", "用户", "应用商店", time.Date(2026, 11, 1, 10, 0, 0, 0, time.UTC), "neg", -0.8, `["闪退"]`, `["崩溃"]`, true))
	w := httptest.NewRecorder()
	(Server{DB: db}).Router().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/datasets/7/comments", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("got %d: %s", w.Code, w.Body.String())
	}
	var body struct {
		Total    int `json:"total"`
		Page     int `json:"page"`
		Limit    int `json:"limit"`
		Comments []struct {
			ID     string   `json:"id"`
			Topics []string `json:"topics"`
		} `json:"comments"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Total != 1 || body.Page != 1 || body.Limit != 20 || len(body.Comments) != 1 || body.Comments[0].ID != "99" || len(body.Comments[0].Topics) != 1 || body.Comments[0].Topics[0] != "闪退" {
		t.Fatalf("unexpected response: %s", w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
