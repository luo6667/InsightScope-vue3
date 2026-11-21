package main

import (
	"context"
	"log"
	"os"
	"strings"
	"time"

	mysqlDriver "github.com/go-sql-driver/mysql"
	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"

	"insightscope/go-backend/internal/analysis"
	"insightscope/go-backend/internal/api"
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
	// Existing Sequelize schema is deliberately read-only at startup.
	dsn := (&mysqlDriver.Config{
		User: env("MYSQL_USER", "root"), Passwd: env("MYSQL_PASSWORD", "1234"),
		Net: "tcp", Addr: env("MYSQL_HOST", "127.0.0.1") + ":" + env("MYSQL_PORT", "3306"),
		DBName: env("MYSQL_DATABASE", "plfx"), ParseTime: true, Loc: time.UTC,
		Params: map[string]string{"charset": "utf8mb4"},
	}).FormatDSN()
	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Fatal("MySQL connection failed: ", err)
	}
	if !db.Migrator().HasTable("analysis_job_secrets") {
		log.Fatal("run go run ./cmd/migrate before starting the API")
	}
	redisClient := redis.NewClient(&redis.Options{Addr: env("REDIS_ADDR", "127.0.0.1:6379"), Password: os.Getenv("REDIS_PASSWORD")})
	defer redisClient.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := redisClient.Ping(ctx).Err(); err != nil {
		log.Fatal("Redis connection failed: ", err)
	}
	credentials, err := analysis.NewCredentials(os.Getenv("ANALYSIS_ENCRYPTION_KEY"))
	if err != nil {
		log.Fatal(err)
	}
	queue := asynq.NewClient(asynq.RedisClientOpt{Addr: env("REDIS_ADDR", "127.0.0.1:6379"), Password: os.Getenv("REDIS_PASSWORD")})
	defer queue.Close()
	if err := tasks.Recover(context.Background(), db, tasks.Client{Queue: queue}); err != nil {
		log.Fatal("analysis job recovery failed: ", err)
	}
	port := env("PORT", "5176")
	origins := strings.Split(env("CORS_ORIGIN", "http://localhost:5175,http://localhost:5176"), ",")
	for i := range origins {
		origins[i] = strings.TrimSpace(origins[i])
	}
	socket := realtime.NewServer(db, os.Getenv("ACCESS_TOKEN"), origins)
	defer socket.Close(nil)
	busContext, stopBus := context.WithCancel(context.Background())
	defer stopBus()
	go (realtime.Bus{Redis: redisClient, Socket: socket}).Run(busContext)
	server := api.Server{DB: db, AccessToken: os.Getenv("ACCESS_TOKEN"), RealtimeHandler: socket.ServeHandler(nil), CORSOrigins: origins,
		Credentials: credentials, Queue: tasks.Client{Queue: queue}, Events: realtime.Publisher{Redis: redisClient}, FeedRedis: redisClient, RedisPing: func(ctx context.Context) error { return redisClient.Ping(ctx).Err() }}
	go server.RunFeedScheduler(busContext)
	log.Fatal(server.Router().Run(":" + port))
}
