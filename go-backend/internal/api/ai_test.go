package api

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestAIStreamPreservesSSEAndUserModel(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server := Server{HTTPClient: &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.String() != "https://api.example.com/v1/chat/completions" || req.Header.Get("Authorization") != "Bearer sample-key" {
			t.Errorf("upstream request = %s, auth = %q", req.URL, req.Header.Get("Authorization"))
		}
		body, _ := io.ReadAll(req.Body)
		if !strings.Contains(string(body), `"model":"user-model"`) || !strings.Contains(string(body), `"stream":true`) {
			t.Errorf("body: %s", body)
		}
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: io.NopCloser(strings.NewReader("data: {\"choices\":[{\"delta\":{\"content\":\"你好\"}}]}\n\n"))}, nil
	})}}
	w := requestJSON(server, http.MethodPost, "/api/ai", `{"baseUrl":"https://api.example.com/v1","apiKey":"sample-key","model":"user-model","messages":[{"role":"user","content":"hello"}]}`)
	if w.Code != 200 || !strings.Contains(w.Header().Get("Content-Type"), "text/event-stream") || !strings.Contains(w.Body.String(), "你好") {
		t.Fatalf("status %d, body %s", w.Code, w.Body.String())
	}
}

func TestAIStreamRejectsLocalURL(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	(Server{}).Router().ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/ai", strings.NewReader(`{"baseUrl":"http://127.0.0.1:3306","apiKey":"key","model":"model","messages":[{"role":"user","content":"hi"}]}`)))
	if w.Code != 400 {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
}

func TestAIStreamPreservesUpstreamError(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server := Server{HTTPClient: &http.Client{Transport: roundTripFunc(func(_ *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 401, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(`{"error":{"message":"invalid key"}}`))}, nil
	})}}
	w := requestJSON(server, http.MethodPost, "/api/ai", `{"baseUrl":"https://api.example.com/v1","apiKey":"wrong-key","model":"user-model","messages":[{"role":"user","content":"hello"}]}`)
	if w.Code != 401 || !strings.Contains(w.Body.String(), "invalid key") {
		t.Fatalf("status %d, body %s", w.Code, w.Body.String())
	}
}
