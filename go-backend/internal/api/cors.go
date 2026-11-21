package api

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

func corsOrigins(origins []string) gin.HandlerFunc {
	allowed := make(map[string]bool, len(origins))
	for _, origin := range origins {
		if trimmed := strings.TrimSpace(origin); trimmed != "" {
			allowed[trimmed] = true
		}
	}
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin != "" {
			c.Header("Vary", "Origin")
			if allowed[origin] {
				c.Header("Access-Control-Allow-Origin", origin)
				if c.Request.Method == http.MethodOptions {
					c.Header("Access-Control-Allow-Methods", "GET,HEAD,PUT,PATCH,POST,DELETE")
					if headers := c.GetHeader("Access-Control-Request-Headers"); headers != "" {
						c.Header("Access-Control-Allow-Headers", headers)
					}
					c.AbortWithStatus(http.StatusNoContent)
					return
				}
			}
		}
		c.Next()
	}
}
