package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"insightscope/go-backend/internal/ai"
	"insightscope/go-backend/internal/data"
)

type importComment struct {
	Content        *string         `json:"content"`
	Text           *string         `json:"text"`
	Comment        *string         `json:"comment"`
	Author         *string         `json:"author"`
	Name           *string         `json:"name"`
	Nickname       *string         `json:"nickname"`
	User           json.RawMessage `json:"user"`
	Username       *string         `json:"username"`
	Email          *string         `json:"email"`
	Platform       *string         `json:"platform"`
	Source         *string         `json:"source"`
	Channel        *string         `json:"channel"`
	Timestamp      json.RawMessage `json:"timestamp"`
	Sentiment      *string         `json:"sentiment"`
	SentimentScore *float64        `json:"sentimentScore"`
	Topics         []string        `json:"topics"`
	Keywords       []string        `json:"keywords"`
	ID             json.RawMessage `json:"id"`
	CommentID      json.RawMessage `json:"commentId"`
}

type createDatasetBody struct {
	Name            string          `json:"name"`
	Platform        string          `json:"platform"`
	ScenarioID      string          `json:"scenarioId"`
	Comments        []importComment `json:"comments"`
	FeedURL         string          `json:"feedUrl"`
	FeedIntervalMin json.RawMessage `json:"feedIntervalMin"`
}

func feedInterval(raw json.RawMessage) (int, error) {
	if len(raw) == 0 {
		return 5, nil
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return 0, err
	}
	var number float64
	switch typed := value.(type) {
	case float64:
		number = typed
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		if err != nil {
			return 0, err
		}
		number = parsed
	default:
		return 0, errors.New("feedIntervalMin 不合法")
	}
	if number < 1 || number > 1440 || number != float64(int(number)) {
		return 0, errors.New("feedIntervalMin 不合法")
	}
	return int(number), nil
}

func (s Server) createFeedDataset(c *gin.Context, body createDatasetBody) {
	feedURL := strings.TrimRight(strings.TrimSpace(body.FeedURL), "/")
	if len(feedURL) > 2048 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "feedUrl 不合法"})
		return
	}
	parsed, err := url.Parse(feedURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" || parsed.User != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "feedUrl 仅支持无凭据的 http/https 绝对地址"})
		return
	}
	if os.Getenv("ALLOW_PRIVATE_FEED_URL") == "0" {
		if _, err := ai.PublicBaseURL(feedURL); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": strings.ReplaceAll(err.Error(), "baseUrl", "feedUrl")})
			return
		}
	}
	interval, err := feedInterval(body.FeedIntervalMin)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "feedIntervalMin 不合法"})
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		name = "定时抓取 " + time.Now().Format("2006/1/2")
	}
	platform := strings.TrimSpace(body.Platform)
	if platform == "" {
		platform = strings.TrimPrefix(strings.ToLower(parsed.Hostname()), "www.")
		if len(platform) > 64 {
			platform = platform[:64]
		}
	}
	if platform == "" {
		platform = "数据源"
	}
	dataset := data.Dataset{Name: name, Platform: platform, Type: "feed", FeedURL: feedURL, FeedIntervalMin: interval, FeedRunning: false}
	if err := s.DB.WithContext(c.Request.Context()).Create(&dataset).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器内部错误"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": fmt.Sprint(dataset.ID), "count": 0, "feed": true})
}

func firstString(values ...*string) string {
	for _, value := range values {
		if value != nil && strings.TrimSpace(*value) != "" {
			return strings.TrimSpace(*value)
		}
	}
	return ""
}

func rawScalar(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	var value any
	if json.Unmarshal(raw, &value) != nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return typed
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	default:
		return ""
	}
}

func importTimestamp(raw json.RawMessage, fallback time.Time) (time.Time, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return fallback, nil
	}
	var milliseconds float64
	if json.Unmarshal(raw, &milliseconds) == nil {
		return time.UnixMilli(int64(milliseconds)).UTC(), nil
	}
	var value string
	if json.Unmarshal(raw, &value) != nil {
		return time.Time{}, errors.New("timestamp 不是可解析的日期")
	}
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02T15:04:05", "2006-01-02 15:04:05", "2006-01-02"} {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed, nil
		}
	}
	return time.Time{}, errors.New("timestamp 不是可解析的日期")
}

func validateImportComment(c importComment) error {
	for _, field := range []*string{c.Content, c.Text, c.Comment} {
		if field != nil && len([]rune(*field)) > 2000 {
			return errors.New("评论内容超过 2000 字")
		}
	}
	for _, field := range []*string{c.Author, c.Name, c.Nickname, c.Username, c.Email, c.Platform, c.Source, c.Channel} {
		if field != nil && len([]rune(*field)) > 64 {
			return errors.New("评论作者或来源超过 64 字")
		}
	}
	if c.Sentiment != nil && *c.Sentiment != "pos" && *c.Sentiment != "neu" && *c.Sentiment != "neg" {
		return errors.New("sentiment 不合法")
	}
	if c.SentimentScore != nil && (*c.SentimentScore < -1 || *c.SentimentScore > 1) {
		return errors.New("sentimentScore 不合法")
	}
	if len(c.Topics) > 20 || len(c.Keywords) > 20 {
		return errors.New("topics 或 keywords 超过 20 项")
	}
	for _, item := range append(append([]string{}, c.Topics...), c.Keywords...) {
		if len([]rune(item)) > 50 {
			return errors.New("topic 或 keyword 超过 50 字")
		}
	}
	for _, raw := range []json.RawMessage{c.ID, c.CommentID} {
		if len([]rune(rawScalar(raw))) > 191 {
			return errors.New("评论 id 超过 191 字")
		}
	}
	_, err := importTimestamp(c.Timestamp, time.Now())
	return err
}

func normalizedImport(c importComment, datasetID, platform string, timestamp time.Time) data.Comment {
	content := ""
	for _, value := range []*string{c.Content, c.Text, c.Comment} {
		if value != nil {
			content = *value
			break
		}
	}
	author := firstString(c.Author, c.Name, c.Nickname)
	if author == "" {
		author = strings.TrimSpace(rawScalar(c.User))
	}
	if author == "" {
		author = firstString(c.Username, c.Email)
	}
	if author == "" {
		author = "匿名用户"
	}
	source := firstString(c.Platform, c.Source, c.Channel)
	if source == "" {
		source = platform
	}
	sentiment := "neu"
	if c.Sentiment != nil {
		sentiment = *c.Sentiment
	}
	score := 0.0
	if c.SentimentScore != nil {
		score = *c.SentimentScore
	}
	sourceID := rawScalar(c.ID)
	if sourceID == "" {
		sourceID = rawScalar(c.CommentID)
	}
	return data.Comment{DatasetID: datasetID, Content: content, Author: author, Platform: source,
		Timestamp: timestamp, Sentiment: sentiment, SentimentScore: score, Topics: append([]string{}, c.Topics...),
		Keywords: append([]string{}, c.Keywords...), Analyzed: c.Sentiment != nil, SourceID: sourceID}
}

// Match the Node import key: source ID takes precedence; otherwise only explicit fields count.
func importDedupKey(c importComment) string {
	id := rawScalar(c.ID)
	if id == "" {
		id = rawScalar(c.CommentID)
	}
	if id != "" {
		return "id:" + id
	}
	parts := make([]string, 0, 9)
	content := firstString(c.Content, c.Text, c.Comment)
	if content != "" {
		parts = append(parts, "content:"+content)
	}
	author := firstString(c.Author, c.Name, c.Nickname)
	if author == "" {
		author = strings.TrimSpace(rawScalar(c.User))
	}
	if author == "" {
		author = firstString(c.Username, c.Email)
	}
	if author != "" {
		parts = append(parts, "author:"+author)
	}
	if source := firstString(c.Platform, c.Source, c.Channel); source != "" {
		parts = append(parts, "platform:"+source)
	}
	if len(c.Timestamp) > 0 {
		parts = append(parts, "ts:"+strings.TrimSpace(rawScalar(c.Timestamp)))
	}
	if c.Sentiment != nil {
		parts = append(parts, "sentiment:"+*c.Sentiment)
	}
	if c.SentimentScore != nil {
		parts = append(parts, "score:"+strconv.FormatFloat(*c.SentimentScore, 'f', -1, 64))
	}
	if len(c.Topics) > 0 {
		parts = append(parts, "topics:"+strings.Join(c.Topics, ","))
	}
	if len(c.Keywords) > 0 {
		parts = append(parts, "keywords:"+strings.Join(c.Keywords, ","))
	}
	return strings.Join(parts, "|")
}

func (s Server) createDataset(c *gin.Context) {
	var body createDatasetBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数不合法"})
		return
	}
	body.Name = strings.TrimSpace(body.Name)
	body.Platform = strings.TrimSpace(body.Platform)
	body.ScenarioID = strings.TrimSpace(body.ScenarioID)
	body.FeedURL = strings.TrimSpace(body.FeedURL)
	if strings.TrimSpace(body.ScenarioID) != "" {
		if len([]rune(body.Name)) > 100 || len([]rune(body.Platform)) > 64 || len([]rune(body.ScenarioID)) > 64 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数不合法"})
			return
		}
		s.createScenarioDataset(c, body)
		return
	}
	if len(body.Comments) == 0 && strings.TrimSpace(body.FeedURL) != "" {
		if len([]rune(body.Name)) > 100 || len([]rune(body.Platform)) > 64 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数不合法"})
			return
		}
		s.createFeedDataset(c, body)
		return
	}
	if len(body.Comments) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "需要 scenarioId / comments 数组 / feedUrl 三者之一"})
		return
	}
	if len(body.Comments) > 5000 || len([]rune(body.Name)) > 100 || len([]rune(body.Platform)) > 64 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数不合法"})
		return
	}
	for _, comment := range body.Comments {
		if err := validateImportComment(comment); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		name = "导入数据 " + time.Now().Format("2006/1/2")
	}
	platform := strings.TrimSpace(body.Platform)
	if platform == "" {
		platform = "导入来源"
	}
	seen := map[string]bool{}
	unique := make([]importComment, 0, len(body.Comments))
	for _, comment := range body.Comments {
		key := importDedupKey(comment)
		if !seen[key] {
			unique = append(unique, comment)
			seen[key] = true
		}
	}
	var dataset data.Dataset
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		dataset = data.Dataset{Name: name, Platform: platform, Type: "imported"}
		if err := tx.Create(&dataset).Error; err != nil {
			return err
		}
		rows := make([]data.Comment, 0, len(unique))
		now := time.Now().UTC()
		for i, raw := range unique {
			ts, err := importTimestamp(raw.Timestamp, now.Add(time.Duration(i)*time.Second))
			if err != nil {
				return err
			}
			rows = append(rows, normalizedImport(raw, strconv.FormatUint(dataset.ID, 10), platform, ts))
		}
		return tx.CreateInBatches(rows, 500).Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器内部错误"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": fmt.Sprint(dataset.ID), "count": len(unique), "deduped": len(body.Comments) - len(unique)})
}
