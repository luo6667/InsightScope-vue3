package api

import (
	"errors"
	"net/http"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"insightscope/go-backend/internal/analysis"
	"insightscope/go-backend/internal/data"
)

type topicCount struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}
type trendDay struct {
	Date  string `json:"date"`
	Pos   int    `json:"pos"`
	Neu   int    `json:"neu"`
	Neg   int    `json:"neg"`
	Total int    `json:"total"`
}

func (s Server) getStats(c *gin.Context) {
	id, ok := idParam(c)
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
	dictRaw := c.Query("dictionary")
	if len([]rune(dictRaw)) > 1000 {
		c.JSON(400, gin.H{"error": "参数校验失败"})
		return
	}
	custom := make([]string, 0)
	for _, word := range strings.Split(strings.TrimSpace(dictRaw), ",") {
		if word = strings.TrimSpace(word); word != "" {
			custom = append(custom, word)
		}
	}
	var dataset data.Dataset
	if err := s.DB.WithContext(c.Request.Context()).Select("id").First(&dataset, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(404, gin.H{"error": "数据集不存在"})
		} else {
			c.JSON(500, gin.H{"error": "服务器内部错误"})
		}
		return
	}
	query := s.DB.WithContext(c.Request.Context()).Model(&data.Comment{}).Where("datasetId = ?", id)
	if hasFrom {
		query = query.Where("timestamp >= ?", from)
	}
	if hasTo {
		query = query.Where("timestamp <= ?", to)
	}
	var rows []data.Comment
	if err := query.Select("sentiment", "topics", "timestamp", "analyzed").Find(&rows).Error; err != nil {
		c.JSON(500, gin.H{"error": "服务器内部错误"})
		return
	}
	sentiment := map[string]int{"pos": 0, "neu": 0, "neg": 0}
	topics := make(map[string]int)
	topicOrder := make(map[string]int)
	trend := make(map[string]*trendDay)
	analyzed := 0
	for _, row := range rows {
		if row.Analyzed {
			analyzed++
		}
		if _, ok := sentiment[row.Sentiment]; ok {
			sentiment[row.Sentiment]++
		}
		for _, topic := range row.Topics {
			if _, ok := topics[topic]; !ok {
				topicOrder[topic] = len(topicOrder)
			}
			topics[topic]++
		}
		date := row.Timestamp.UTC().Format("2006-01-02")
		if trend[date] == nil {
			trend[date] = &trendDay{Date: date}
		}
		d := trend[date]
		switch row.Sentiment {
		case "pos":
			d.Pos++
		case "neu":
			d.Neu++
		case "neg":
			d.Neg++
		}
		d.Total++
	}
	topicList := make([]topicCount, 0, len(topics))
	for name, count := range topics {
		topicList = append(topicList, topicCount{Name: name, Count: count})
	}
	sort.SliceStable(topicList, func(i, j int) bool {
		if topicList[i].Count == topicList[j].Count {
			return topicOrder[topicList[i].Name] < topicOrder[topicList[j].Name]
		}
		return topicList[i].Count > topicList[j].Count
	})
	if len(topicList) > 12 {
		topicList = topicList[:12]
	}
	trendList := make([]trendDay, 0, len(trend))
	for _, day := range trend {
		trendList = append(trendList, *day)
	}
	sort.Slice(trendList, func(i, j int) bool { return trendList[i].Date < trendList[j].Date })
	var contentRows []data.Comment
	if err := query.Session(&gorm.Session{}).Select("content").Order("timestamp DESC").Limit(1000).Find(&contentRows).Error; err != nil {
		c.JSON(500, gin.H{"error": "服务器内部错误"})
		return
	}
	contents := make([]string, 0, len(contentRows))
	for _, row := range contentRows {
		contents = append(contents, row.Content)
	}
	c.JSON(http.StatusOK, gin.H{"total": len(rows), "analyzed": analyzed, "sentiment": sentiment,
		"topics": topicList, "keywords": analysis.CountKeywords(contents, 20, custom), "trend": trendList})
}
