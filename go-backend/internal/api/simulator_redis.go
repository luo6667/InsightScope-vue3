package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

var advanceSimulation = redis.NewScript(`if redis.call('HGET',KEYS[1],'generation') ~= ARGV[1] then return 0 end; redis.call('HINCRBY',KEYS[1],'index',1); redis.call('EXPIRE',KEYS[1],600); return 1`)
var finishSimulation = redis.NewScript(`if redis.call('HGET',KEYS[1],'generation') ~= ARGV[1] then return 0 end; redis.call('DEL',KEYS[1]); return 1`)
var speedSimulation = redis.NewScript(`if redis.call('EXISTS',KEYS[1]) == 0 then return 0 end; redis.call('HSET',KEYS[1],'speed',ARGV[1]); redis.call('EXPIRE',KEYS[1],600); return 1`)

func simKey(id uint64) string { return "insight:sim:" + strconv.FormatUint(id, 10) }

func (s *Simulator) startRedis(ctx context.Context, id uint64, speed float64) (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	generation := hex.EncodeToString(bytes)
	key := simKey(id)
	pipe := s.Redis.TxPipeline()
	pipe.HSet(ctx, key, "generation", generation, "index", 0, "speed", speed)
	pipe.Expire(ctx, key, 10*time.Minute)
	_, err := pipe.Exec(ctx)
	return generation, err
}

func (s *Simulator) currentRedis(id uint64, sim *simulation) (int, float64, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	state, err := s.Redis.HGetAll(ctx, simKey(id)).Result()
	if err != nil {
		log.Printf("[simulate] Redis state %d: %v", id, err)
		return 0, 0, false
	}
	if state["generation"] != sim.generation {
		return 0, 0, false
	}
	index, err := strconv.Atoi(state["index"])
	if err != nil {
		return 0, 0, false
	}
	speed, err := strconv.ParseFloat(state["speed"], 64)
	if err != nil || speed < 1 || speed > 20 {
		return 0, 0, false
	}
	return index, speed, true
}

func (s *Simulator) advanceRedis(id uint64, sim *simulation) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	owned, err := advanceSimulation.Run(ctx, s.Redis, []string{simKey(id)}, sim.generation).Int64()
	if err != nil {
		log.Printf("[simulate] Redis advance %d: %v", id, err)
		return false
	}
	return owned == 1
}

func (s *Simulator) stopIfCurrentRedis(id uint64, sim *simulation) (bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	owned, err := finishSimulation.Run(ctx, s.Redis, []string{simKey(id)}, sim.generation).Int64()
	return owned == 1, err
}

func (s *Simulator) changeSpeedRedis(ctx context.Context, id uint64, speed float64) (bool, error) {
	exists, err := speedSimulation.Run(ctx, s.Redis, []string{simKey(id)}, speed).Int64()
	return exists == 1, err
}
