package api

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"insightscope/go-backend/internal/data"
)

const exportBatch = 1000

func exportCell(value string) string {
	if value != "" && strings.ContainsRune("=+-@", rune(value[0])) {
		value = "'" + value
	}
	return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
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

func commentFilter(c *gin.Context, db *gorm.DB, id uint64) (*gorm.DB, bool) {
	from, hasFrom, ok := parseCommentDate(c, "from")
	if !ok {
		return nil, false
	}
	to, hasTo, ok := parseCommentDate(c, "to")
	if !ok {
		return nil, false
	}
	sentiment := c.Query("sentiment")
	if sentiment != "" && sentiment != "pos" && sentiment != "neu" && sentiment != "neg" {
		c.JSON(400, gin.H{"error": "参数校验失败"})
		return nil, false
	}
	topic, search := strings.TrimSpace(c.Query("topic")), strings.TrimSpace(c.Query("q"))
	if len([]rune(topic)) > 50 || (c.Query("topic") != "" && topic == "") || len([]rune(search)) > 200 || (c.Query("q") != "" && search == "") {
		c.JSON(400, gin.H{"error": "参数校验失败"})
		return nil, false
	}
	query := db.WithContext(c.Request.Context()).Model(&data.Comment{}).Where("datasetId = ?", id)
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
	return query, true
}

func (s Server) exportComments(c *gin.Context) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	format := c.DefaultQuery("format", "json")
	if format != "json" && format != "csv" {
		c.JSON(400, gin.H{"error": "参数校验失败"})
		return
	}
	query, ok := commentFilter(c, s.DB, id)
	if !ok {
		return
	}
	var count int64
	if err := s.DB.WithContext(c.Request.Context()).Model(&data.Dataset{}).Where("id = ?", id).Count(&count).Error; err != nil {
		c.JSON(500, gin.H{"error": "服务器内部错误"})
		return
	}
	if count == 0 {
		c.JSON(404, gin.H{"error": "数据集不存在"})
		return
	}

	if format == "csv" {
		c.Header("Content-Type", "text/csv;charset=utf-8")
		c.Header("Content-Disposition", "attachment; filename=comments-"+strconv.FormatUint(id, 10)+".csv")
		_, _ = fmt.Fprint(c.Writer, "\ufeffcontent,author,platform,timestamp,sentiment,topics\r\n")
	} else {
		c.Header("Content-Type", "application/json; charset=utf-8")
	}
	comments := make([]gin.H, 0)
	for offset := 0; ; offset += exportBatch {
		var rows []data.Comment
		if err := query.Session(&gorm.Session{}).Order("timestamp DESC").Order("id DESC").Limit(exportBatch).Offset(offset).Find(&rows).Error; err != nil {
			if format == "csv" {
				c.Error(err)
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器内部错误"})
			return
		}
		for _, row := range rows {
			if format == "csv" {
				values := []string{row.Content, row.Author, row.Platform, row.Timestamp.UTC().Format(time.RFC3339Nano), row.Sentiment, strings.Join(row.Topics, "|")}
				for i, value := range values {
					values[i] = exportCell(value)
				}
				_, _ = fmt.Fprint(c.Writer, strings.Join(values, ",")+"\r\n")
			} else {
				topics := row.Topics
				if topics == nil {
					topics = []string{}
				}
				comments = append(comments, gin.H{"id": strconv.FormatUint(row.ID, 10), "content": row.Content,
					"author": row.Author, "platform": row.Platform, "timestamp": row.Timestamp,
					"sentiment": row.Sentiment, "sentimentScore": row.SentimentScore, "topics": topics})
			}
		}
		if len(rows) < exportBatch {
			break
		}
	}
	if format == "json" {
		c.JSON(200, gin.H{"comments": comments})
	}
}
