package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"insightscope/go-backend/internal/data"
)

type fakeFeedQueue struct {
	IDs []uint64
	Err error
}

func (q *fakeFeedQueue) EnqueueFeed(_ context.Context, id uint64) error {
	q.IDs = append(q.IDs, id)
	return q.Err
}

func TestFeedPullImportsOnlyNewCommentsAndPublishesEvents(t *testing.T) {
	gin.SetMode(gin.TestMode)
	feed := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"comments":[{"id":"source-1","text":"hello","name":"Ada"},{"id":"source-2","text":"already there"},null]}`))
	}))
	defer feed.Close()
	redisServer := miniredis.RunT(t)
	server, mock := writeTestServer(t)
	server.FeedRedis = redis.NewClient(&redis.Options{Addr: redisServer.Addr()})
	defer server.FeedRedis.Close()
	events := &recordedEvent{}
	server.Events = events
	mock.ExpectQuery("SELECT .* FROM `datasets`").WillReturnRows(sqlmock.NewRows([]string{"id", "feedUrl", "platform"}).AddRow(8, feed.URL, "来源"))
	mock.ExpectQuery("SELECT count.* FROM `comments`").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	mock.ExpectBegin()
	mock.ExpectExec("INSERT INTO `comments`").WillReturnResult(sqlmock.NewResult(71, 1))
	mock.ExpectCommit()
	mock.ExpectQuery("SELECT count.* FROM `comments`").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectBegin()
	mock.ExpectExec("UPDATE `datasets`").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	w := requestJSON(server, http.MethodPost, "/api/datasets/8/feed/pull", "")
	if w.Code != 200 || w.Body.String() != `{"count":1,"ok":true,"skipped":false}` {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	if events.Name != "feed:status" || events.DatasetID != "8" {
		t.Fatalf("last event: %+v", events)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestFeedPullSkipsWhenDatasetLockIsHeld(t *testing.T) {
	gin.SetMode(gin.TestMode)
	redisServer := miniredis.RunT(t)
	server := Server{FeedRedis: redis.NewClient(&redis.Options{Addr: redisServer.Addr()})}
	defer server.FeedRedis.Close()
	if err := server.FeedRedis.Set(context.Background(), "insight:feed:lock:8", "other", 0).Err(); err != nil {
		t.Fatal(err)
	}
	w := requestJSON(server, http.MethodPost, "/api/datasets/8/feed/pull", "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"skipped":true`) {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
}

func TestFeedStartQueuesPullAndReturnsServiceUnavailableOnFailure(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server, mock := writeTestServer(t)
	queue := &fakeFeedQueue{}
	server.FeedQueue = queue
	mock.ExpectQuery("SELECT .* FROM `datasets`").WillReturnRows(sqlmock.NewRows([]string{"id", "feedUrl", "feedRunning"}).AddRow(8, "https://example.com/feed", false))
	mock.ExpectBegin()
	mock.ExpectExec("UPDATE `datasets`").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	w := requestJSON(server, http.MethodPost, "/api/datasets/8/feed/start", "")
	if w.Code != 200 || w.Body.String() != `{"ok":true}` || len(queue.IDs) != 1 || queue.IDs[0] != 8 {
		t.Fatalf("start: %d %s %+v", w.Code, w.Body.String(), queue.IDs)
	}
	queue.Err = errors.New("redis unavailable")
	mock.ExpectQuery("SELECT .* FROM `datasets`").WillReturnRows(sqlmock.NewRows([]string{"id", "feedUrl", "feedRunning"}).AddRow(8, "https://example.com/feed", false))
	for i := 0; i < 2; i++ {
		mock.ExpectBegin()
		mock.ExpectExec("UPDATE `datasets`").WillReturnResult(sqlmock.NewResult(0, 1))
		mock.ExpectCommit()
	}
	w = requestJSON(server, http.MethodPost, "/api/datasets/8/feed/start", "")
	if w.Code != 503 {
		t.Fatalf("failed queue: %d %s", w.Code, w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDecodeFeedCommentKeepsAliasesAndInvalidTimestampFallsBack(t *testing.T) {
	raw := map[string]json.RawMessage{"text": json.RawMessage(`"hello"`), "name": json.RawMessage(`"Ada"`), "timestamp": json.RawMessage(`"not-a-date"`)}
	comment := decodeFeedComment(raw)
	if comment.Text == nil || *comment.Text != "hello" || comment.Name == nil || *comment.Name != "Ada" {
		t.Fatalf("comment: %+v", comment)
	}
	_, err := importTimestamp(comment.Timestamp, time.Time{})
	if err == nil {
		t.Fatal("invalid timestamp should be replaced by feed reader")
	}
}

func TestFeedSchedulerResumesAfterRestartAndRespectsInterval(t *testing.T) {
	now := time.Now().UTC()
	ds := data.Dataset{FeedIntervalMin: 5}
	if !feedReady(ds, time.Time{}, now) {
		t.Fatal("running feed without prior pull should resume")
	}
	last := now.Add(-3 * time.Minute)
	ds.FeedLastAt = &last
	if feedReady(ds, time.Time{}, now) {
		t.Fatal("recent successful pull should delay next pull")
	}
	ds.FeedLastAt = nil
	if feedReady(ds, last, now) {
		t.Fatal("recent failed attempt should not retry every minute")
	}
	if !feedReady(ds, now.Add(-6*time.Minute), now) {
		t.Fatal("elapsed interval should allow retry")
	}
}
