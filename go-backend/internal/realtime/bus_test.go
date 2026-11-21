package realtime

import (
	"encoding/json"
	"testing"
)

func TestRealtimeEventEnvelopeRejectsUnknownEventsAndRooms(t *testing.T) {
	valid := Event{DatasetID: "12", Name: "analysis:progress", Payload: json.RawMessage(`{"processed":5}`)}
	if !valid.valid() {
		t.Fatal("valid existing client event rejected")
	}
	for _, bad := range []Event{
		{DatasetID: "dataset:12", Name: valid.Name, Payload: valid.Payload},
		{DatasetID: "12", Name: "api-key", Payload: valid.Payload},
		{DatasetID: "12", Name: valid.Name, Payload: json.RawMessage(`{"broken":`)},
	} {
		if bad.valid() {
			t.Fatalf("accepted invalid realtime event: %+v", bad)
		}
	}
}

func TestPublisherRejectsInvalidEventBeforeRedis(t *testing.T) {
	err := (Publisher{}).Publish(t.Context(), "not-an-id", "analysis:progress", map[string]int{"processed": 5})
	if err == nil {
		t.Fatal("invalid dataset room should not be published")
	}
}
