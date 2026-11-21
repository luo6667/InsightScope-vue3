package api

import (
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

var rateLimitScript = redis.NewScript(`local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return {n,redis.call('TTL',KEYS[1])}`)

func (s Server) writeLimit() gin.HandlerFunc {
	return func(c *gin.Context) {
		if s.RateLimitPerMin <= 0 || !strings.HasPrefix(c.Request.URL.Path, "/api") {
			c.Next()
			return
		}
		switch c.Request.Method {
		case http.MethodPost, http.MethodPatch, http.MethodPut, http.MethodDelete:
		default:
			c.Next()
			return
		}
		if s.FeedRedis == nil {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"error": "请求服务暂不可用"})
			return
		}
		ip, _, err := net.SplitHostPort(c.Request.RemoteAddr)
		if err != nil {
			ip = c.Request.RemoteAddr
		}
		key := "insight:write-limit:" + ip
		result, err := rateLimitScript.Run(c.Request.Context(), s.FeedRedis, []string{key}).Int64Slice()
		if err != nil || len(result) != 2 {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"error": "请求服务暂不可用"})
			return
		}
		remaining := int64(s.RateLimitPerMin) - result[0]
		if remaining < 0 {
			remaining = 0
		}
		reset := result[1]
		if reset < 0 {
			reset = 0
		}
		c.Header("RateLimit-Policy", fmt.Sprintf("%d;w=60", s.RateLimitPerMin))
		c.Header("RateLimit", fmt.Sprintf("limit=%d, remaining=%d, reset=%d", s.RateLimitPerMin, remaining, reset))
		if result[0] > int64(s.RateLimitPerMin) {
			c.Header("Retry-After", strconv.FormatInt(reset, 10))
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"error": "请求过于频繁，请稍后再试"})
			return
		}
		c.Next()
	}
}
