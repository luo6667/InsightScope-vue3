package analysis

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) { return f(req) }

func TestAnalyzeBatchFallsBackForMissingItem(t *testing.T) {
	requests := 0
	client := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		requests++
		if req.URL.String() != "https://api.example.com/v1/chat/completions" || req.Header.Get("Authorization") != "Bearer secret" {
			t.Fatalf("bad request: %s %s", req.URL, req.Header.Get("Authorization"))
		}
		body, _ := io.ReadAll(req.Body)
		content := `{"choices":[{"message":{"content":"[{\"sentiment\":\"pos\",\"sentimentScore\":2,\"topics\":[\"性能\"],\"keywords\":[\"流畅\"]},null]"}}]}`
		if strings.Contains(string(body), `"max_tokens":300`) {
			content = `{"choices":[{"message":{"content":"[{\"sentiment\":\"neg\",\"topics\":[\"价格\"],\"keywords\":[\"太贵\"]}]"}}]}`
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(content)), Header: http.Header{}}, nil
	})}
	results := (LLM{Client: client}).Analyze(context.Background(), AIConfig{APIKey: "secret", BaseURL: "https://api.example.com/v1", Model: "test", Temperature: 0.2}, []string{"good", "bad"})
	if requests != 2 || results[0] == nil || results[1] == nil || results[0].Sentiment != "pos" || results[0].Score != 1 || results[1].Sentiment != "neg" || results[1].Score != -0.7 {
		t.Fatalf("requests=%d results=%+v", requests, results)
	}
}

func TestAnalyzeReturnsFailuresWhenModelIsUnavailable(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 503, Body: io.NopCloser(strings.NewReader("unavailable")), Header: http.Header{}}, nil
	})}
	results := (LLM{Client: client}).Analyze(context.Background(), AIConfig{BaseURL: "https://api.example.com"}, []string{"one"})
	if len(results) != 1 || results[0] != nil {
		t.Fatalf("expected failed item, got %+v", results)
	}
}
