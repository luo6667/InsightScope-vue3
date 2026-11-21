package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"time"

	"github.com/redis/go-redis/v9"
	sio "github.com/zishang520/socket.io/servers/socket/v3"
)

const eventChannel = "insight:realtime:v1"

var allowedEvents = map[string]bool{
	"analysis:progress": true, "analysis:error": true, "analysis:reset": true,
	"comment:stream": true, "alert:new": true, "feed:status": true,
	"feed:error": true, "sim:status": true,
}

type Event struct {
	DatasetID string          `json:"datasetId"`
	Name      string          `json:"name"`
	Payload   json.RawMessage `json:"payload"`
}

func (e Event) valid() bool {
	if e.DatasetID == "" || len(e.DatasetID) > 64 || !allowedEvents[e.Name] || len(e.Payload) == 0 {
		return false
	}
	for _, r := range e.DatasetID {
		if r < '0' || r > '9' {
			return false
		}
	}
	return json.Valid(e.Payload)
}

// Publisher sends only event metadata and the existing client payload. It never stores events in Redis.
type Publisher struct{ Redis *redis.Client }

func (p Publisher) Publish(ctx context.Context, datasetID, name string, payload any) error {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	event := Event{DatasetID: datasetID, Name: name, Payload: encoded}
	if !event.valid() {
		return errors.New("invalid realtime event")
	}
	message, err := json.Marshal(event)
	if err != nil {
		return err
	}
	return p.Redis.Publish(ctx, eventChannel, message).Err()
}

// Bus reconnects after Redis interruptions; clients refresh durable state through REST after reconnecting.
type Bus struct {
	Redis  *redis.Client
	Socket *sio.Server
}

func (b Bus) forward(raw string) {
	var event Event
	if err := json.Unmarshal([]byte(raw), &event); err != nil || !event.valid() {
		return
	}
	var payload any
	if err := json.Unmarshal(event.Payload, &payload); err != nil {
		return
	}
	b.Socket.To(sio.Room("dataset:"+event.DatasetID)).Emit(event.Name, payload)
}

func (b Bus) Run(ctx context.Context) {
	for ctx.Err() == nil {
		sub := b.Redis.Subscribe(ctx, eventChannel)
		if _, err := sub.Receive(ctx); err == nil {
			for ctx.Err() == nil {
				message, err := sub.ReceiveMessage(ctx)
				if err != nil {
					break
				}
				b.forward(message.Payload)
			}
		} else if ctx.Err() == nil {
			log.Printf("[realtime] Redis subscription unavailable: %v", err)
		}
		_ = sub.Close()
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Second):
		}
	}
}
