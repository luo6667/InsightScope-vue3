package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
)

func TestStatsAggregatesExistingResponseFields(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server, mock := writeTestServer(t)
	mock.ExpectQuery("SELECT .* FROM `datasets`").WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(7))
	stamp := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	mock.ExpectQuery("SELECT .* FROM `comments`").WillReturnRows(sqlmock.NewRows([]string{"sentiment", "topics", "timestamp", "analyzed"}).
		AddRow("neg", `["闪退"]`, stamp, true).AddRow("pos", `["性能"]`, stamp, false))
	mock.ExpectQuery("SELECT .* FROM `comments`").WillReturnRows(sqlmock.NewRows([]string{"content"}).AddRow("闪退"))
	w := httptest.NewRecorder()
	server.Router().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/datasets/7/stats", nil))
	if w.Code != 200 {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	var body struct {
		Total     int            `json:"total"`
		Analyzed  int            `json:"analyzed"`
		Sentiment map[string]int `json:"sentiment"`
		Topics    []topicCount   `json:"topics"`
		Keywords  []struct {
			Word string `json:"word"`
		} `json:"keywords"`
		Trend []trendDay `json:"trend"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Total != 2 || body.Analyzed != 1 || body.Sentiment["neg"] != 1 || body.Topics[0].Name != "闪退" || body.Keywords[0].Word != "闪退" || body.Trend[0].Total != 2 {
		t.Fatalf("stats: %s", w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
