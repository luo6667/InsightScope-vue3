package analysis

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

const leaseTTL = 2 * time.Minute

var renewScript = redis.NewScript(`if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE',KEYS[1],ARGV[2]) else return 0 end`)
var releaseScript = redis.NewScript(`if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end`)

type Lease interface {
	Renew(context.Context) (bool, error)
	Release(context.Context) error
}

type LockStore interface {
	Acquire(context.Context, uint64) (Lease, error)
}

type RedisLocks struct{ Redis *redis.Client }

type redisLease struct {
	client     *redis.Client
	key, owner string
}

func (r RedisLocks) Acquire(ctx context.Context, jobID uint64) (Lease, error) {
	ownerBytes := make([]byte, 16)
	if _, err := rand.Read(ownerBytes); err != nil {
		return nil, err
	}
	owner := hex.EncodeToString(ownerBytes)
	key := fmt.Sprintf("insight:analysis:lock:%d", jobID)
	for {
		acquired, err := r.Redis.SetNX(ctx, key, owner, leaseTTL).Result()
		if err != nil {
			return nil, err
		}
		if acquired {
			return redisLease{client: r.Redis, key: key, owner: owner}, nil
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
}

func (l redisLease) Renew(ctx context.Context) (bool, error) {
	result, err := renewScript.Run(ctx, l.client, []string{l.key}, l.owner, leaseTTL.Milliseconds()).Int64()
	return result == 1, err
}

func (l redisLease) Release(ctx context.Context) error {
	return releaseScript.Run(ctx, l.client, []string{l.key}, l.owner).Err()
}
