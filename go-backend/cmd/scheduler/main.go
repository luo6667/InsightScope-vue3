package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"time"

	mysqlDriver "github.com/go-sql-driver/mysql"
	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"

	"insightscope/go-backend/internal/api"
	"insightscope/go-backend/internal/tasks"
)

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func main() {
	dsn := (&mysqlDriver.Config{User: env("MYSQL_USER", "root"), Passwd: env("MYSQL_PASSWORD", "1234"), Net: "tcp",
		Addr: env("MYSQL_HOST", "127.0.0.1") + ":" + env("MYSQL_PORT", "3306"), DBName: env("MYSQL_DATABASE", "plfx"),
		ParseTime: true, Loc: time.UTC, Params: map[string]string{"charset": "utf8mb4"}}).FormatDSN()
	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Fatal("MySQL connection failed: ", err)
	}
	redisAddr := env("REDIS_ADDR", "127.0.0.1:6379")
	redisPassword := os.Getenv("REDIS_PASSWORD")
	client := redis.NewClient(&redis.Options{Addr: redisAddr, Password: redisPassword})
	defer client.Close()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	checkCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	if err := client.Ping(checkCtx).Err(); err != nil {
		log.Fatal("Redis connection failed: ", err)
	}
	cancel()
	queue := asynq.NewClient(asynq.RedisClientOpt{Addr: redisAddr, Password: redisPassword})
	defer queue.Close()
	log.Print("feed scheduler started")
	go func() {
		check := func() {
			checkCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
			defer cancel()
			if err := tasks.Recover(checkCtx, db, tasks.Client{Queue: queue}); err != nil && ctx.Err() == nil {
				log.Printf("[analysis] scheduler recovery: %v", err)
			}
		}
		check()
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				check()
			}
		}
	}()
	(api.Server{DB: db, FeedQueue: tasks.Client{Queue: queue}}).RunFeedScheduler(ctx)
}
