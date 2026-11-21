package main

import (
	"context"
	"log"
	"os"
	"strings"
	"time"

	mysqlDriver "github.com/go-sql-driver/mysql"
	"github.com/redis/go-redis/v9"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"

	"insightscope/go-backend/internal/api"
	"insightscope/go-backend/internal/realtime"
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
	redisClient := redis.NewClient(&redis.Options{Addr: env("REDIS_ADDR", "127.0.0.1:6379"), Password: os.Getenv("REDIS_PASSWORD")})
	defer redisClient.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := redisClient.Ping(ctx).Err(); err != nil {
		log.Fatal("Redis connection failed: ", err)
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
	log.Fatal(api.Server{DB: db, AccessToken: os.Getenv("ACCESS_TOKEN"), RealtimeHandler: socket.ServeHandler(nil), RedisPing: func(ctx context.Context) error { return redisClient.Ping(ctx).Err() }}.Router().Run(":" + port))
}
