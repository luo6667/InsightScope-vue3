package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestCORSAllowsConfiguredOriginAndPreflight(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := (Server{CORSOrigins: []string{"http://localhost:5175"}}).Router()
	request := httptest.NewRequest(http.MethodOptions, "/api/datasets", nil)
	request.Header.Set("Origin", "http://localhost:5175")
	request.Header.Set("Access-Control-Request-Method", "POST")
	request.Header.Set("Access-Control-Request-Headers", "authorization,content-type")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, request)
	if w.Code != http.StatusNoContent || w.Header().Get("Access-Control-Allow-Origin") != "http://localhost:5175" || w.Header().Get("Access-Control-Allow-Headers") != "authorization,content-type" {
		t.Fatalf("preflight: %d %+v", w.Code, w.Header())
	}
}

func TestCORSDoesNotAllowUnconfiguredOrigin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := (Server{CORSOrigins: []string{"http://localhost:5175"}}).Router()
	request := httptest.NewRequest(http.MethodOptions, "/api/datasets", nil)
	request.Header.Set("Origin", "https://untrusted.example")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, request)
	if w.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("unexpected CORS access: %+v", w.Header())
	}
}
