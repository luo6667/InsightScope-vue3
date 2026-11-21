package tasks

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/hibiken/asynq"
)

func TestFeedQueueUsesRealRedisWithoutDuplicateTasks(t *testing.T) {
	addr := os.Getenv("GO_INTEGRATION_REDIS")
	if addr == "" {
		t.Skip("set GO_INTEGRATION_REDIS for isolated Redis queue test")
	}
	if addr != "127.0.0.1:16379" {
		t.Fatal("integration Redis must use isolated port 16379")
	}
	option := asynq.RedisClientOpt{Addr: addr}
	queue := asynq.NewClient(option)
	defer queue.Close()
	inspector := asynq.NewInspector(option)
	defer inspector.Close()
	id := uint64(time.Now().UnixNano())
	client := Client{Queue: queue}
	if err := client.EnqueueFeed(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	if err := client.EnqueueFeed(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	items, err := inspector.ListPendingTasks("feed")
	if err != nil {
		t.Fatal(err)
	}
	found := 0
	for _, item := range items {
		var payload FeedPayload
		if json.Unmarshal(item.Payload, &payload) != nil || payload.DatasetID != id {
			continue
		}
		found++
		if err := inspector.DeleteTask("feed", item.ID); err != nil {
			t.Fatal(err)
		}
	}
	if found != 1 {
		t.Fatalf("queued copies for dataset %d: %d", id, found)
	}
}
