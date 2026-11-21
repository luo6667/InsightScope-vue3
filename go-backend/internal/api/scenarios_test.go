package api

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
)

func TestScenarioListAndGenerationMatchLegacyDefinitions(t *testing.T) {
	gin.SetMode(gin.TestMode)
	definitions, err := scenarios()
	if err != nil {
		t.Fatal(err)
	}
	if len(definitions) != 3 {
		t.Fatalf("scenario count %d", len(definitions))
	}
	for _, def := range definitions {
		rows := generateScenario(def)
		if len(rows) != def.Count {
			t.Fatalf("%s generated %d comments, expected %d", def.ID, len(rows), def.Count)
		}
		for i, row := range rows {
			if !row.Analyzed || len(row.Topics) == 0 || len(row.Keywords) == 0 || row.Content == "" {
				t.Fatalf("%s invalid row %d", def.ID, i)
			}
			if i > 0 && row.Timestamp.Before(rows[i-1].Timestamp) {
				t.Fatalf("%s rows not time sorted", def.ID)
			}
		}
	}
	w := requestJSON(Server{}, http.MethodGet, "/api/scenarios", "")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	var result struct {
		Scenarios []struct {
			ID    string `json:"id"`
			Count int    `json:"count"`
		} `json:"scenarios"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Scenarios) != 3 || result.Scenarios[0].ID != "app-update" || result.Scenarios[0].Count != 450 {
		t.Fatalf("unexpected scenarios: %s", w.Body.String())
	}
}

func TestCreateScenarioIsTransactional(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server, mock := writeTestServer(t)
	mock.ExpectBegin()
	mock.ExpectExec("INSERT INTO `datasets`").WillReturnResult(sqlmock.NewResult(24, 1))
	mock.ExpectExec("INSERT INTO `comments`").WillReturnResult(sqlmock.NewResult(1, 450))
	mock.ExpectCommit()
	w := requestJSON(server, http.MethodPost, "/api/datasets", `{"scenarioId":"app-update"}`)
	if w.Code != http.StatusCreated || w.Body.String() != `{"count":450,"id":"24"}` {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCreateUnknownScenarioDoesNotWrite(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := requestJSON(Server{}, http.MethodPost, "/api/datasets", `{"scenarioId":"missing"}`)
	if w.Code != http.StatusBadRequest || w.Body.String() != `{"error":"场景不存在"}` {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
}
