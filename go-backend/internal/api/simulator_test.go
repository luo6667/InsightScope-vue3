package api

import (
	"context"
	"net/http"
	"sync"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

type simulationEvents struct {
	mu    sync.Mutex
	names []string
}

func (e *simulationEvents) Publish(_ context.Context, _, name string, _ any) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.names = append(e.names, name)
	return nil
}

func TestSimulationStartRejectsEmptyDatasetAndInvalidSpeed(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server, mock := writeTestServer(t)
	server.Simulator = &Simulator{DB: server.DB}
	w := requestJSON(server, http.MethodPost, "/api/datasets/8/simulate/start", `{"speed":21}`)
	if w.Code != 400 {
		t.Fatalf("invalid speed: %d %s", w.Code, w.Body.String())
	}
	mock.ExpectQuery("SELECT count.* FROM `comments`").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	w = requestJSON(server, http.MethodPost, "/api/datasets/8/simulate/start", `{"speed":5}`)
	if w.Code != 400 || w.Body.String() != `{"error":"数据集没有评论"}` {
		t.Fatalf("empty dataset: %d %s", w.Code, w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSimulationSpeedAndStopPreserveResponses(t *testing.T) {
	gin.SetMode(gin.TestMode)
	_, cancel := context.WithCancel(context.Background())
	defer cancel()
	sim := &simulation{speed: 5, cancel: cancel}
	server := Server{Simulator: &Simulator{running: map[uint64]*simulation{8: sim}}}
	w := requestJSON(server, http.MethodPost, "/api/datasets/8/simulate/speed", `{"speed":"10"}`)
	if w.Code != 200 || w.Body.String() != `{"ok":true,"speed":10}` || sim.speed != 10 {
		t.Fatalf("speed: %d %s", w.Code, w.Body.String())
	}
	w = requestJSON(server, http.MethodPost, "/api/datasets/8/simulate/stop", "")
	if w.Code != 200 || w.Body.String() != `{"ok":true}` {
		t.Fatalf("stop: %d %s", w.Code, w.Body.String())
	}
	w = requestJSON(server, http.MethodPost, "/api/datasets/8/simulate/speed", `{"speed":5}`)
	if w.Code != 404 {
		t.Fatalf("speed after stop: %d %s", w.Code, w.Body.String())
	}
}

func TestSimulationReplaysOneCommentAndStopsAtEnd(t *testing.T) {
	server, mock := writeTestServer(t)
	events := &simulationEvents{}
	_, cancel := context.WithCancel(context.Background())
	sim := &simulation{speed: 20, cancel: cancel}
	player := &Simulator{DB: server.DB, Events: events, running: map[uint64]*simulation{8: sim}}
	mock.ExpectQuery("SELECT count.* FROM `comments`").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectQuery("SELECT .* FROM `comments`").WillReturnRows(sqlmock.NewRows([]string{"id", "datasetId", "content", "author", "platform", "sentiment", "sentimentScore"}).AddRow(71, "8", "hello", "Ada", "来源", "neu", 0))
	mock.ExpectQuery("SELECT count.* FROM `comments`").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	player.run(context.Background(), 8, sim)
	if len(events.names) != 2 || events.names[0] != "comment:stream" || events.names[1] != "sim:status" {
		t.Fatalf("events: %+v", events.names)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSimulationRedisStateAllowsCrossInstanceSpeedAndStop(t *testing.T) {
	redisServer := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: redisServer.Addr()})
	defer client.Close()
	_, cancel := context.WithCancel(context.Background())
	defer cancel()
	sim := &simulation{speed: 5, cancel: cancel}
	first := &Simulator{Redis: client, running: map[uint64]*simulation{8: sim}}
	generation, err := first.startRedis(context.Background(), 8, 5)
	if err != nil {
		t.Fatal(err)
	}
	sim.generation = generation
	second := &Simulator{Redis: client}
	if changed, err := second.changeSpeedRedis(context.Background(), 8, 10); err != nil || !changed {
		t.Fatalf("cross-instance speed: %v %v", changed, err)
	}
	if _, speed, active := first.current(8, sim); !active || speed != 10 {
		t.Fatalf("first instance speed: %v %v", active, speed)
	}
	if err := second.stop(8); err != nil {
		t.Fatal(err)
	}
	if _, _, active := first.current(8, sim); active || first.advance(8, sim) {
		t.Fatal("stopped generation must not replay")
	}
}
