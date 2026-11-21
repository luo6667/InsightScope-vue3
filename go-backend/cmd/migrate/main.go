package main

import (
	"context"
	"database/sql"
	"log"
	"os"
	"time"

	mysqlDriver "github.com/go-sql-driver/mysql"

	"insightscope/go-backend/internal/migrations"
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
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	if err := migrations.Apply(ctx, db); err != nil {
		log.Fatal("migration failed: ", err)
	}
	log.Print("migrations applied")
}
