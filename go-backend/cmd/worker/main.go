package main

import (
	"context"
	"log"
	"os"
	"time"

	mysqlDriver "github.com/go-sql-driver/mysql"
	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"

	"insightscope/go-backend/internal/analysis"
	"insightscope/go-backend/internal/realtime"
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
	if !db.Migrator().HasTable("analysis_job_secrets") {
		log.Fatal("run go run ./cmd/migrate before starting the worker")
	}
	credentials, err := analysis.NewCredentials(os.Getenv("ANALYSIS_ENCRYPTION_KEY"))
	if err != nil {
		log.Fatal(err)
	}
	redisAddr := env("REDIS_ADDR", "127.0.0.1:6379")
	redisPassword := os.Getenv("REDIS_PASSWORD")
	redisClient := redis.NewClient(&redis.Options{Addr: redisAddr, Password: redisPassword})
	defer redisClient.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := redisClient.Ping(ctx).Err(); err != nil {
		log.Fatal("Redis connection failed: ", err)
	}
	worker := analysis.Worker{DB: db, Credentials: credentials, Events: realtime.Publisher{Redis: redisClient}, Locks: analysis.RedisLocks{Redis: redisClient}}
	server := asynq.NewServer(asynq.RedisClientOpt{Addr: redisAddr, Password: redisPassword}, asynq.Config{Concurrency: 4, Queues: map[string]int{"analysis": 1}})
	mux := asynq.NewServeMux()
	mux.HandleFunc(tasks.AnalysisType, worker.Handle)
	log.Fatal(server.Run(mux))
}
