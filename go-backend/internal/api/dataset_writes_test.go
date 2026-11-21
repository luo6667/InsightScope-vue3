package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
)

func TestCreateImportRejectsInvalidTimestampWithoutWriting(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := requestJSON(Server{}, http.MethodPost, "/api/datasets", `{"comments":[{"content":"hello","timestamp":"bad date"}]}`)
	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "timestamp") {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
}

func TestImportAliasesAndExplicitFieldDedup(t *testing.T) {
	var one, two, three importComment
	for i, target := range []*importComment{&one, &two, &three} {
		body := `{"text":"same","name":"Ada","source":"论坛"}`
		if i == 2 {
			body = `{"text":"same","name":"Ada","source":"论坛","timestamp":"2024-01-01"}`
		}
		if err := json.Unmarshal([]byte(body), target); err != nil {
			t.Fatal(err)
		}
	}
	if importDedupKey(one) != importDedupKey(two) || importDedupKey(one) == importDedupKey(three) {
		t.Fatal("explicit fields must control deduplication")
	}
	row := normalizedImport(one, "7", "导入来源", time.Now())
	if row.Content != "same" || row.Author != "Ada" || row.Platform != "论坛" || row.Analyzed {
		t.Fatalf("normalized row: %+v", row)
	}
}

func TestCreateImportTransactionAndResponse(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server, mock := writeTestServer(t)
	mock.ExpectBegin()
	mock.ExpectExec("INSERT INTO `datasets`").WillReturnResult(sqlmock.NewResult(12, 1))
	mock.ExpectExec("INSERT INTO `comments`").WillReturnResult(sqlmock.NewResult(41, 1))
	mock.ExpectCommit()
	w := requestJSON(server, http.MethodPost, "/api/datasets", `{"name":"示例","comments":[{"text":"hello","name":"Ada"},{"text":"hello","name":"Ada"}]}`)
	if w.Code != http.StatusCreated || w.Body.String() != `{"count":1,"deduped":1,"id":"12"}` {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCreateImportRollsBackOnCommentFailure(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server, mock := writeTestServer(t)
	mock.ExpectBegin()
	mock.ExpectExec("INSERT INTO `datasets`").WillReturnResult(sqlmock.NewResult(12, 1))
	mock.ExpectExec("INSERT INTO `comments`").WillReturnError(errors.New("write failed"))
	mock.ExpectRollback()
	w := requestJSON(server, http.MethodPost, "/api/datasets", `{"comments":[{"content":"hello"}]}`)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCreateFeedPreservesManualStartAndHostPlatform(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server, mock := writeTestServer(t)
	mock.ExpectBegin()
	mock.ExpectExec("INSERT INTO `datasets`").WithArgs(sqlmock.AnyArg(), "example.com", "feed", sqlmock.AnyArg(), "https://www.example.com/comments", 5, false, sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).WillReturnResult(sqlmock.NewResult(19, 1))
	mock.ExpectCommit()
	w := requestJSON(server, http.MethodPost, "/api/datasets", `{"feedUrl":"https://www.example.com/comments"}`)
	if w.Code != http.StatusCreated || w.Body.String() != `{"count":0,"feed":true,"id":"19"}` {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCreateFeedRejectsInvalidIntervalBeforeWriting(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := requestJSON(Server{}, http.MethodPost, "/api/datasets", `{"feedUrl":"https://example.com/comments","feedIntervalMin":1441}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
}
