package main

import (
	"log"
	"os"
	"time"

	mysqlDriver "github.com/go-sql-driver/mysql"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"

	"insightscope/go-backend/internal/api"
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
	port := env("PORT", "5176")
	log.Fatal(api.Server{DB: db, AccessToken: os.Getenv("ACCESS_TOKEN")}.Router().Run(":" + port))
}
