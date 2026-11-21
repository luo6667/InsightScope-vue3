package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestAccessStatusAndDatasetAuthentication(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := (Server{AccessToken: "test-secret"}).Router()

	status := httptest.NewRecorder()
	router.ServeHTTP(status, httptest.NewRequest(http.MethodGet, "/api/auth/status", nil))
	if status.Code != http.StatusOK {
		t.Fatalf("auth status = %d", status.Code)
	}
	var body struct {
		AuthRequired bool `json:"authRequired"`
	}
	if err := json.Unmarshal(status.Body.Bytes(), &body); err != nil || !body.AuthRequired {
		t.Fatalf("auth status body = %s, error = %v", status.Body.String(), err)
	}

	denied := httptest.NewRecorder()
	router.ServeHTTP(denied, httptest.NewRequest(http.MethodGet, "/api/datasets", nil))
	if denied.Code != http.StatusUnauthorized {
		t.Fatalf("dataset access without token = %d; want 401", denied.Code)
	}
}

func TestUnknownAPIUsesJSONErrorAndSecurityHeaders(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := (Server{}).Router()
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/not-found", nil))
	if w.Code != 404 || w.Body.String() != `{"error":"接口不存在"}` {
		t.Fatalf("unknown API: %d %s", w.Code, w.Body.String())
	}
	if w.Header().Get("X-Content-Type-Options") != "nosniff" || w.Header().Get("Content-Security-Policy") == "" {
		t.Fatalf("security headers: %+v", w.Header())
	}
	protected := httptest.NewRecorder()
	(Server{AccessToken: "secret"}).Router().ServeHTTP(protected, httptest.NewRequest(http.MethodGet, "/api/not-found", nil))
	if protected.Code != 401 {
		t.Fatalf("unknown protected API: %d %s", protected.Code, protected.Body.String())
	}
}
