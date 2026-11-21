package analysis

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestCredentialsRoundTripAndJobBinding(t *testing.T) {
	key := base64.StdEncoding.EncodeToString([]byte(strings.Repeat("k", 32)))
	cipher, err := NewCredentials(key)
	if err != nil {
		t.Fatal(err)
	}
	config := AIConfig{APIKey: "secret-api-key", BaseURL: "https://api.example.com", Model: "model-a", Temperature: 0.2}
	nonce, encrypted, err := cipher.Encrypt(42, config)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encrypted), config.APIKey) {
		t.Fatal("API key exposed in ciphertext")
	}
	got, err := cipher.Decrypt(42, nonce, encrypted)
	if err != nil || got != config {
		t.Fatalf("round trip: %+v %v", got, err)
	}
	if _, err := cipher.Decrypt(43, nonce, encrypted); err == nil {
		t.Fatal("ciphertext accepted for another job")
	}
	encrypted[0] ^= 1
	if _, err := cipher.Decrypt(42, nonce, encrypted); err == nil {
		t.Fatal("tampered ciphertext accepted")
	}
}

func TestCredentialsRejectsInvalidKey(t *testing.T) {
	if _, err := NewCredentials("short"); err == nil {
		t.Fatal("short key accepted")
	}
}
