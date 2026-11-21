package api

import (
	"encoding/json"
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"insightscope/go-backend/internal/data"
)

type commentPatch struct {
	Sentiment      *string   `json:"sentiment"`
	SentimentScore *float64  `json:"sentimentScore"`
	Topics         *[]string `json:"topics"`
}

func (s Server) updateComment(c *gin.Context) {
	datasetID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || len(c.Param("id")) > 64 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID 不合法"})
		return
	}
	commentID, err := strconv.ParseUint(c.Param("cid"), 10, 64)
	if err != nil || len(c.Param("cid")) > 64 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID 不合法"})
		return
	}
	var patch commentPatch
	if c.ShouldBindJSON(&patch) != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数校验失败"})
		return
	}
	if patch.Sentiment == nil && patch.Topics == nil && patch.SentimentScore == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "没有可更新的字段"})
		return
	}
	if patch.Sentiment != nil && *patch.Sentiment != "pos" && *patch.Sentiment != "neu" && *patch.Sentiment != "neg" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数校验失败"})
		return
	}
	if patch.SentimentScore != nil && (*patch.SentimentScore < -1 || *patch.SentimentScore > 1) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数校验失败"})
		return
	}
	if patch.Topics != nil {
		if len(*patch.Topics) > 5 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "参数校验失败"})
			return
		}
		for _, topic := range *patch.Topics {
			trimmed := strings.TrimSpace(topic)
			if trimmed == "" || len([]rune(trimmed)) > 50 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "参数校验失败"})
				return
			}
		}
	}
	changes := map[string]any{"analyzed": true}
	if patch.Sentiment != nil {
		changes["sentiment"] = *patch.Sentiment
		score := 0.0
		if patch.SentimentScore != nil {
			score = *patch.SentimentScore
		} else if *patch.Sentiment == "pos" {
			score = 0.8
		} else if *patch.Sentiment == "neg" {
			score = -0.8
		}
		changes["sentimentScore"] = math.Round(score*100) / 100
	}
	if patch.Topics != nil {
		topics, err := json.Marshal(*patch.Topics)
		if err != nil {
			c.JSON(500, gin.H{"error": "服务器内部错误"})
			return
		}
		changes["topics"] = string(topics)
	}
	var changed int64
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&data.Comment{}).Where("id = ? AND datasetId = ?", commentID, datasetID).Updates(changes)
		if result.Error != nil {
			return result.Error
		}
		changed = result.RowsAffected
		if changed > 0 && s.StatsRedis != nil {
			return data.BumpDataVersion(tx, strconv.FormatUint(datasetID, 10))
		}
		return nil
	})
	if err != nil {
		c.JSON(500, gin.H{"error": "服务器内部错误"})
		return
	}
	if changed == 0 {
		c.JSON(404, gin.H{"error": "评论不存在"})
		return
	}
	c.JSON(200, gin.H{"ok": true})
}
