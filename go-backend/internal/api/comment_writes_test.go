package api

import (
	"net/http"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
)

func TestCommentPatchValidation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, body := range []string{
		`{}`,
		`{"sentiment":"unknown"}`,
		`{"sentiment":"pos","sentimentScore":2}`,
		`{"topics":[""]}`,
		`{"topics":["a","b","c","d","e","f"]}`,
	} {
		w := requestJSON(Server{}, http.MethodPatch, "/api/datasets/7/comments/9", body)
		if w.Code != 400 {
			t.Errorf("body %s: status %d", body, w.Code)
		}
	}
}

func TestCommentPatchUpdatesMatchingDataset(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server, mock := writeTestServer(t)
	mock.ExpectBegin()
	mock.ExpectExec("UPDATE `comments` SET .* WHERE id = \\? AND datasetId = \\?").WithArgs(
		true, "neg", -0.8, sqlmock.AnyArg(), uint64(9), uint64(7),
	).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	w := requestJSON(server, http.MethodPatch, "/api/datasets/7/comments/9", `{"sentiment":"neg"}`)
	if w.Code != 200 {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
