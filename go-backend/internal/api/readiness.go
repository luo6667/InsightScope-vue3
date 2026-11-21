package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func (s Server) readiness(c *gin.Context) {
	result := gin.H{"ok": true, "db": "up", "redis": "up"}
	if s.DB == nil {
		result["db"] = "down"
	} else if sqlDB, err := s.DB.DB(); err != nil || sqlDB.PingContext(c.Request.Context()) != nil {
		result["db"] = "down"
	}
	if s.RedisPing == nil || s.RedisPing(c.Request.Context()) != nil {
		result["redis"] = "down"
	}
	if result["db"] != "up" || result["redis"] != "up" {
		result["ok"] = false
		c.JSON(http.StatusServiceUnavailable, result)
		return
	}
	c.JSON(http.StatusOK, result)
}
