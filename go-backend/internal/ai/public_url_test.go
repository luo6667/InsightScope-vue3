package ai

import "testing"

func TestPublicBaseURLBlocksLocalTargets(t *testing.T) {
	for _, raw := range []string{"http://localhost:3000", "http://127.0.0.1", "http://169.254.169.254", "http://[::ffff:127.0.0.1]", "https://foo.internal", "file:///etc/passwd", "https://user:pass@example.com"} {
		if _, err := PublicBaseURL(raw); err == nil {
			t.Errorf("accepted %q", raw)
		}
	}
	if got, err := PublicBaseURL(" https://api.example.com/v1/ "); err != nil || got != "https://api.example.com/v1" {
		t.Fatalf("got %q, %v", got, err)
	}
}
