package api

import (
	"database/sql/driver"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

func TestAlertRulesKeepStringIDsAndExistingFields(t *testing.T) {
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
	mock.ExpectQuery("SELECT .* FROM `alert_rules`").WithArgs(driver.Value("7")).WillReturnRows(
		sqlmock.NewRows([]string{"id", "datasetId", "type", "threshold", "keyword", "windowMin", "enabled"}).
			AddRow(42, "7", "volume", 12, "", 10, true),
	)
	w := httptest.NewRecorder()
	(Server{DB: db}).Router().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/alerts/rules?datasetId=7", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	var body struct {
		Rules []struct {
			ID        string `json:"id"`
			DatasetID string `json:"datasetId"`
			WindowMin int    `json:"windowMin"`
		} `json:"rules"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Rules) != 1 || body.Rules[0].ID != "42" || body.Rules[0].DatasetID != "7" || body.Rules[0].WindowMin != 10 {
		t.Fatalf("unexpected rule response: %s", w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAlertQueryRejectsInvalidPagination(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	(Server{}).Router().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/alerts?limit=501", nil))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d", w.Code)
	}
}
