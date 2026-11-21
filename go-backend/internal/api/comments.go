package api

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"insightscope/go-backend/internal/data"
)

func commentPageInt(c *gin.Context, name string, fallback int) (int, bool) {
	if c.Query(name) == "" {
		return fallback, true
	}
	value, err := strconv.Atoi(c.Query(name))
	max := 100
	if name == "page" {
		max = 1_000_000
	}
	if err != nil || value < 1 || value > max {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数校验失败"})
		return 0, false
	}
	return value, true
}

func parseCommentDate(c *gin.Context, name string) (time.Time, bool, bool) {
	raw := c.Query(name)
	if raw == "" {
		return time.Time{}, false, true
	}
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02", "2006-01-02 15:04:05"} {
		if value, err := time.Parse(layout, raw); err == nil {
			return value, true, true
		}
	}
	c.JSON(http.StatusBadRequest, gin.H{"error": "参数校验失败"})
	return time.Time{}, false, false
}

func escapeLike(value string) string {
	return strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_").Replace(value)
}

func (s Server) listComments(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || len(c.Param("id")) > 64 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID 不合法"})
		return
	}
	page, ok := commentPageInt(c, "page", 1)
	if !ok {
		return
	}
	limit, ok := commentPageInt(c, "limit", 20)
	if !ok {
		return
	}
	from, hasFrom, ok := parseCommentDate(c, "from")
	if !ok {
		return
	}
	to, hasTo, ok := parseCommentDate(c, "to")
	if !ok {
		return
	}
	sentiment := c.Query("sentiment")
	if sentiment != "" && sentiment != "pos" && sentiment != "neu" && sentiment != "neg" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数校验失败"})
		return
	}
	topic := strings.TrimSpace(c.Query("topic"))
	search := strings.TrimSpace(c.Query("q"))
	if len([]rune(topic)) > 50 || (c.Query("topic") != "" && topic == "") ||
		len([]rune(search)) > 200 || (c.Query("q") != "" && search == "") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数校验失败"})
		return
	}

	var dataset data.Dataset
	if err := s.DB.WithContext(c.Request.Context()).Select("id").First(&dataset, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "数据集不存在"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器内部错误"})
		}
		return
	}
	query := s.DB.WithContext(c.Request.Context()).Model(&data.Comment{}).Where("datasetId = ?", id)
	if sentiment != "" {
		query = query.Where("sentiment = ?", sentiment)
	}
	if hasFrom {
		query = query.Where("timestamp >= ?", from)
	}
	if hasTo {
		query = query.Where("timestamp <= ?", to)
	}
	if topic != "" {
		query = query.Where("JSON_CONTAINS(topics, JSON_QUOTE(?)) = 1", topic)
	}
	if search != "" {
		query = query.Where("content LIKE ?", "%"+escapeLike(search)+"%")
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器内部错误"})
		return
	}
	var comments []data.Comment
	if err := query.Order("timestamp DESC").Offset((page - 1) * limit).Limit(limit).Find(&comments).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器内部错误"})
		return
	}
	rows := make([]gin.H, 0, len(comments))
	for _, row := range comments {
		topics, keywords := row.Topics, row.Keywords
		if topics == nil {
			topics = []string{}
		}
		if keywords == nil {
			keywords = []string{}
		}
		rows = append(rows, gin.H{"id": strconv.FormatUint(row.ID, 10), "content": row.Content,
			"author": row.Author, "platform": row.Platform, "timestamp": row.Timestamp,
			"sentiment": row.Sentiment, "sentimentScore": row.SentimentScore,
			"topics": topics, "keywords": keywords, "analyzed": row.Analyzed})
	}
	c.JSON(http.StatusOK, gin.H{"total": total, "page": page, "limit": limit, "comments": rows})
}
