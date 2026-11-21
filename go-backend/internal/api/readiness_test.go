package api

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestReadinessRequiresBothMySQLAndRedis(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server, _ := writeTestServer(t)
	server.RedisPing = func(context.Context) error { return nil }
	w := requestJSON(server, http.MethodGet, "/readyz", "")
	if w.Code != http.StatusOK || w.Body.String() != `{"db":"up","ok":true,"redis":"up"}` {
		t.Fatalf("healthy: %d %s", w.Code, w.Body.String())
	}
	server.RedisPing = func(context.Context) error { return errors.New("unavailable") }
	w = requestJSON(server, http.MethodGet, "/readyz", "")
	if w.Code != http.StatusServiceUnavailable || w.Body.String() != `{"db":"up","ok":false,"redis":"down"}` {
		t.Fatalf("redis down: %d %s", w.Code, w.Body.String())
	}
	w = requestJSON(Server{RedisPing: func(context.Context) error { return nil }}, http.MethodGet, "/readyz", "")
	if w.Code != http.StatusServiceUnavailable || w.Body.String() != `{"db":"down","ok":false,"redis":"up"}` {
		t.Fatalf("mysql down: %d %s", w.Code, w.Body.String())
	}
}
