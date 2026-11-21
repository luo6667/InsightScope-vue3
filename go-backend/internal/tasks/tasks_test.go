package tasks

import (
	"encoding/json"
	"testing"
)

func TestQueuePayloadContainsOnlyIdentifier(t *testing.T) {
	task, err := Analysis(42)
	if err != nil {
		t.Fatal(err)
	}
	if task.Type() != AnalysisType || string(task.Payload()) != `{"jobId":42}` {
		t.Fatalf("analysis task: %s %s", task.Type(), task.Payload())
	}
	var payload map[string]any
	if err := json.Unmarshal(task.Payload(), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload) != 1 {
		t.Fatalf("unexpected queue payload: %+v", payload)
	}
	if _, err := Analysis(0); err == nil {
		t.Fatal("zero job ID accepted")
	}
}
