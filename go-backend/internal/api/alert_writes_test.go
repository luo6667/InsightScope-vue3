package api

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

func writeTestServer(t *testing.T) (Server, sqlmock.Sqlmock) {
	t.Helper()
	sqlDB, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	db, err := gorm.Open(mysql.New(mysql.Config{Conn: sqlDB, SkipInitializeWithVersion: true}), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	return Server{DB: db}, mock
}

func requestJSON(server Server, method, path, body string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	server.Router().ServeHTTP(w, req)
	return w
}

func TestCreateRuleRejectsMissingKeywordBeforeDatabase(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := requestJSON(Server{}, http.MethodPost, "/api/alerts/rules", `{"datasetId":"7","type":"keyword","threshold":1}`)
	if w.Code != 400 {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
}

func TestCreateRulePreservesFalseEnabledAndStringID(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server, mock := writeTestServer(t)
	mock.ExpectQuery("SELECT .* FROM `datasets`").WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(7))
	mock.ExpectBegin()
	mock.ExpectExec("INSERT INTO `alert_rules`").WillReturnResult(sqlmock.NewResult(42, 1))
	mock.ExpectCommit()
	w := requestJSON(server, http.MethodPost, "/api/alerts/rules", `{"datasetId":"7","type":"volume","threshold":5,"windowMin":"10","enabled":false}`)
	if w.Code != 201 || w.Body.String() != "{\"id\":\"42\"}" {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAcknowledgeUnknownAlertReturns404(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server, mock := writeTestServer(t)
	mock.ExpectQuery("SELECT .* FROM `alerts`").WillReturnRows(sqlmock.NewRows([]string{"id"}))
	w := requestJSON(server, http.MethodPatch, "/api/alerts/999/ack", "")
	if w.Code != 404 {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAcknowledgeAlertReturnsOK(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server, mock := writeTestServer(t)
	mock.ExpectQuery("SELECT .* FROM `alerts`").WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(8))
	mock.ExpectBegin()
	mock.ExpectExec("UPDATE `alerts` SET `acknowledged`=\\?,`updatedAt`=\\? WHERE `id` = \\?").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	w := requestJSON(server, http.MethodPatch, "/api/alerts/8/ack", "")
	if w.Code != 200 || w.Body.String() != "{\"ok\":true}" {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
