package analysis

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func TestRedisLeaseRenewsAndOnlyOwnerCanRelease(t *testing.T) {
	server, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	defer client.Close()
	ctx := context.Background()
	lease, err := (RedisLocks{Redis: client}).Acquire(ctx, 42)
	if err != nil {
		t.Fatal(err)
	}
	key := "insight:analysis:lock:42"
	blockedCtx,cancel:=context.WithTimeout(ctx,20*time.Millisecond)
	defer cancel()
	if _,err:=(RedisLocks{Redis:client}).Acquire(blockedCtx,42);err==nil {t.Fatal("second worker acquired active job lock")}
	server.FastForward(time.Minute)
	valid, err := lease.Renew(ctx)
	if err != nil || !valid || server.TTL(key) < time.Minute {
		t.Fatalf("renew: valid=%v err=%v ttl=%v", valid, err, server.TTL(key))
	}
	if err := client.Set(ctx, key, "new-owner", time.Minute).Err(); err != nil {
		t.Fatal(err)
	}
	valid, err = lease.Renew(ctx)
	if err != nil || valid {
		t.Fatalf("stale owner renewed lock: valid=%v err=%v", valid, err)
	}
	if err := lease.Release(ctx); err != nil {
		t.Fatal(err)
	}
	value, err := client.Get(ctx, key).Result()
	if err != nil || value != "new-owner" {
		t.Fatalf("stale owner deleted replacement: %q %v", value, err)
	}
}
