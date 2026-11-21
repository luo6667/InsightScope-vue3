package api

import (
	"context"
	"crypto/subtle"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"insightscope/go-backend/internal/analysis"
	"insightscope/go-backend/internal/data"
	"insightscope/go-backend/internal/tasks"
)

type Server struct {
	DB              *gorm.DB
	AccessToken     string
	HTTPClient      *http.Client
	RealtimeHandler http.Handler
	RedisPing       func(context.Context) error
	CORSOrigins     []string
	Credentials     analysis.Credentials
	Queue           tasks.Enqueuer
}

type datasetListRow struct {
	ID              string     `json:"id"`
	Name            string     `json:"name"`
	Platform        string     `json:"platform"`
	Type            string     `json:"type"`
	ScenarioID      string     `json:"scenarioId"`
	FeedURL         string     `json:"feedUrl"`
	FeedIntervalMin int        `json:"feedIntervalMin"`
	FeedRunning     bool       `json:"feedRunning"`
	FeedLastAt      *time.Time `json:"feedLastAt"`
	FeedLastCount   int        `json:"feedLastCount"`
	FeedLastError   string     `json:"feedLastError"`
	CommentCount    int64      `json:"commentCount"`
	AnalyzedCount   int64      `json:"analyzedCount"`
	CreatedAt       time.Time  `json:"createdAt"`
}

func (s Server) Router() *gin.Engine {
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(corsOrigins(s.CORSOrigins))
	if s.RealtimeHandler != nil {
		r.Any("/socket.io/*path", gin.WrapH(s.RealtimeHandler))
	}
	r.GET("/healthz", func(c *gin.Context) {
		db, err := s.DB.DB()
		if err != nil || db.PingContext(c.Request.Context()) != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"ok": false, "db": "down"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true, "db": "up"})
	})
	r.GET("/readyz", s.readiness)
	r.GET("/api/auth/status", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"authRequired": s.AccessToken != ""})
	})
	api := r.Group("/api", s.requireToken)
	api.GET("/datasets", s.listDatasets)
	api.GET("/scenarios", listScenarios)
	api.POST("/datasets", s.createDataset)
	api.GET("/datasets/:id", s.getDataset)
	api.DELETE("/datasets/:id", s.deleteDataset)
	api.GET("/datasets/:id/comments", s.listComments)
	api.PATCH("/datasets/:id/comments/:cid", s.updateComment)
	api.GET("/datasets/:id/export", s.exportComments)
	api.GET("/datasets/:id/stats", s.getStats)
	api.GET("/datasets/:id/analysis", s.getAnalysisJob)
	api.POST("/datasets/:id/analysis", s.createAnalysisJob)
	api.GET("/alerts/rules", s.listRules)
	api.POST("/alerts/rules", s.createRule)
	api.PATCH("/alerts/rules/:id", s.updateRule)
	api.DELETE("/alerts/rules/:id", s.deleteRule)
	api.GET("/alerts", s.listAlerts)
	api.PATCH("/alerts/:id/ack", s.ackAlert)
	api.POST("/ai", s.streamAI)
	return r
}

func (s Server) requireToken(c *gin.Context) {
	if s.AccessToken == "" {
		return
	}
	header := c.GetHeader("Authorization")
	if !strings.HasPrefix(header, "Bearer ") || subtle.ConstantTimeCompare([]byte(strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))), []byte(s.AccessToken)) != 1 {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "未授权：需要访问口令（ACCESS_TOKEN）"})
	}
}

func (s Server) counts(ctx context.Context, id uint64) (int64, int64, error) {
	var total, analyzed int64
	if err := s.DB.WithContext(ctx).Model(&data.Comment{}).Where("datasetId = ?", id).Count(&total).Error; err != nil {
		return 0, 0, err
	}
	if err := s.DB.WithContext(ctx).Model(&data.Comment{}).Where("datasetId = ? AND analyzed = ?", id, true).Count(&analyzed).Error; err != nil {
		return 0, 0, err
	}
	return total, analyzed, nil
}

func (s Server) listDatasets(c *gin.Context) {
	var datasets []data.Dataset
	if err := s.DB.WithContext(c.Request.Context()).Order("createdAt DESC").Find(&datasets).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器内部错误"})
		return
	}
	rows := make([]datasetListRow, 0, len(datasets))
	for _, d := range datasets {
		total, analyzed, err := s.counts(c.Request.Context(), d.ID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器内部错误"})
			return
		}
		rows = append(rows, datasetListRow{
			ID: strconv.FormatUint(d.ID, 10), Name: d.Name, Platform: d.Platform, Type: d.Type,
			ScenarioID: d.ScenarioID, FeedURL: d.FeedURL, FeedIntervalMin: d.FeedIntervalMin,
			FeedRunning: d.FeedRunning, FeedLastAt: d.FeedLastAt, FeedLastCount: d.FeedLastCount,
			FeedLastError: d.FeedLastError, CommentCount: total, AnalyzedCount: analyzed, CreatedAt: d.CreatedAt,
		})
	}
	c.JSON(http.StatusOK, gin.H{"datasets": rows})
}

func (s Server) getDataset(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID 不合法"})
		return
	}
	var d data.Dataset
	if err := s.DB.WithContext(c.Request.Context()).First(&d, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "数据集不存在"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器内部错误"})
		}
		return
	}
	total, analyzed, err := s.counts(c.Request.Context(), d.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器内部错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"id": strconv.FormatUint(d.ID, 10), "name": d.Name, "platform": d.Platform,
		"type": d.Type, "scenarioId": d.ScenarioID, "commentCount": total,
		"analyzedCount": analyzed, "createdAt": d.CreatedAt,
	})
}
