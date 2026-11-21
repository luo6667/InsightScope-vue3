package config

import (
	"strings"
	"testing"
)

func TestProductionRequiresOriginalSecuritySettings(t *testing.T) {
	values := map[string]string{"NODE_ENV": "production"}
	read := func(key string) string { return values[key] }
	err := CheckProduction(read)
	if err == nil {
		t.Fatal("production defaults must be rejected")
	}
	for _, name := range []string{"MYSQL_PASSWORD", "CORS_ORIGIN", "RATE_LIMIT_PER_MIN", "ACCESS_TOKEN"} {
		if !strings.Contains(err.Error(), name) {
			t.Fatalf("missing %s: %v", name, err)
		}
	}
	values["MYSQL_PASSWORD"] = "strong-password"
	values["CORS_ORIGIN"] = "https://example.com"
	values["RATE_LIMIT_PER_MIN"] = "60"
	values["ACCESS_TOKEN"] = strings.Repeat("x", 16)
	if err := CheckProduction(read); err != nil {
		t.Fatal(err)
	}
}

func TestDevelopmentAllowsLocalDefaults(t *testing.T) {
	if err := CheckProduction(func(string) string { return "" }); err != nil {
		t.Fatal(err)
	}
}
