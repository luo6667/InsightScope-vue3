package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

func TestWriteLimitRejectsSecondWriteAndKeepsReadsAvailable(t *testing.T) {
	gin.SetMode(gin.TestMode)
	redisServer := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: redisServer.Addr()})
	defer client.Close()
	server := Server{AccessToken: "secret", FeedRedis: client, RateLimitPerMin: 1}
	first := requestJSON(server, http.MethodPost, "/api/datasets", "{}")
	if first.Code != 401 || first.Header().Get("RateLimit") == "" {
		t.Fatalf("first: %d %s", first.Code, first.Body.String())
	}
	second := requestJSON(server, http.MethodPost, "/api/datasets", "{}")
	if second.Code != 429 || second.Body.String() != `{"error":"请求过于频繁，请稍后再试"}` || second.Header().Get("Retry-After") == "" {
		t.Fatalf("second: %d %s", second.Code, second.Body.String())
	}
	read := httptest.NewRecorder()
	server.Router().ServeHTTP(read, httptest.NewRequest(http.MethodGet, "/api/auth/status", nil))
	if read.Code != 200 {
		t.Fatalf("read: %d %s", read.Code, read.Body.String())
	}
}
