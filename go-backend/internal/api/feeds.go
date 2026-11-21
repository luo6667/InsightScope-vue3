package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"

	"insightscope/go-backend/internal/ai"
	"insightscope/go-backend/internal/data"
	"insightscope/go-backend/internal/tasks"
)

var releaseFeedLock = redis.NewScript(`if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end`)
var renewFeedLock = redis.NewScript(`if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE',KEYS[1],ARGV[2]) else return 0 end`)

func feedID(c *gin.Context) (uint64, bool) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID 不合法"})
		return 0, false
	}
	return id, true
}

func (s Server) startFeed(c *gin.Context) {
	id, ok := feedID(c)
	if !ok {
		return
	}
	var ds data.Dataset
	err := s.DB.WithContext(c.Request.Context()).First(&ds, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(404, gin.H{"error": "数据集不存在"})
		return
	}
	if err != nil {
		c.JSON(500, gin.H{"error": "服务器内部错误"})
		return
	}
	if ds.FeedURL == "" {
		c.JSON(400, gin.H{"error": "该数据集未配置数据源 URL"})
		return
	}
	if s.FeedQueue == nil {
		c.JSON(503, gin.H{"error": "任务服务暂不可用"})
		return
	}
	if err := s.DB.WithContext(c.Request.Context()).Model(&ds).Update("feedRunning", true).Error; err != nil {
		c.JSON(500, gin.H{"error": "服务器内部错误"})
		return
	}
	if err := s.FeedQueue.EnqueueFeed(c.Request.Context(), id); err != nil {
		if restoreErr := s.DB.WithContext(c.Request.Context()).Model(&ds).Update("feedRunning", ds.FeedRunning).Error; restoreErr != nil {
			log.Printf("[feed] restore running state %d: %v", id, restoreErr)
		}
		c.JSON(503, gin.H{"error": "任务服务暂不可用"})
		return
	}
	s.publishFeed(c.Request.Context(), id, "feed:status", gin.H{"running": true})
	c.JSON(200, gin.H{"ok": true})
}

func (s Server) stopFeed(c *gin.Context) {
	id, ok := feedID(c)
	if !ok {
		return
	}
	if err := s.DB.WithContext(c.Request.Context()).Model(&data.Dataset{}).Where("id = ?", id).Update("feedRunning", false).Error; err != nil {
		c.JSON(500, gin.H{"error": "服务器内部错误"})
		return
	}
	c.JSON(200, gin.H{"ok": true})
}

func (s Server) pullFeed(c *gin.Context) {
	id, ok := feedID(c)
	if !ok {
		return
	}
	count, skipped, err := s.fetchFeed(c.Request.Context(), id)
	if err != nil {
		c.JSON(500, gin.H{"error": "服务器内部错误"})
		return
	}
	c.JSON(200, gin.H{"ok": true, "count": count, "skipped": skipped})
}

func (s Server) HandleFeed(ctx context.Context, task *asynq.Task) error {
	if task.Type() != tasks.FeedType {
		return asynq.SkipRetry
	}
	var payload tasks.FeedPayload
	if err := json.Unmarshal(task.Payload(), &payload); err != nil || payload.DatasetID == 0 {
		return asynq.SkipRetry
	}
	var ds data.Dataset
	if err := s.DB.WithContext(ctx).Select("id", "feedRunning").First(&ds, payload.DatasetID).Error; errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	} else if err != nil {
		return err
	}
	if !ds.FeedRunning {
		return nil
	}
	_, _, err := s.fetchFeed(ctx, payload.DatasetID)
	return err
}

func (s Server) publishFeed(ctx context.Context, id uint64, event string, payload any) {
	if s.Events == nil {
		return
	}
	if err := s.Events.Publish(ctx, strconv.FormatUint(id, 10), event, payload); err != nil {
		log.Printf("[feed] event %s for %d: %v", event, id, err)
	}
}

func (s Server) fetchFeed(ctx context.Context, id uint64) (count int, skipped bool, err error) {
	if s.FeedRedis == nil {
		return 0, false, errors.New("feed Redis lock unavailable")
	}
	ownerBytes := make([]byte, 16)
	if _, err = rand.Read(ownerBytes); err != nil {
		return
	}
	owner := hex.EncodeToString(ownerBytes)
	key := fmt.Sprintf("insight:feed:lock:%d", id)
	locked, lockErr := s.FeedRedis.SetNX(ctx, key, owner, 2*time.Minute).Result()
	if lockErr != nil {
		return 0, false, lockErr
	}
	if !locked {
		return 0, true, nil
	}
	pullCtx, stop := context.WithCancel(ctx)
	defer func() {
		stop()
		unlockCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if unlockErr := releaseFeedLock.Run(unlockCtx, s.FeedRedis, []string{key}, owner).Err(); unlockErr != nil {
			log.Printf("[feed] unlock %d: %v", id, unlockErr)
		}
	}()
	go func() {
		ticker := time.NewTicker(20 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-pullCtx.Done():
				return
			case <-ticker.C:
				renewCtx, cancel := context.WithTimeout(pullCtx, 3*time.Second)
				valid, err := renewFeedLock.Run(renewCtx, s.FeedRedis, []string{key}, owner, (2 * time.Minute).Milliseconds()).Int64()
				cancel()
				if err != nil || valid != 1 {
					stop()
					return
				}
			}
		}
	}()
	count, err = s.doFetchFeed(pullCtx, id)
	return count, false, err
}

func feedLimit() int {
	value, err := strconv.Atoi(os.Getenv("FEED_MAX_ITEMS"))
	if err != nil || value < 1 {
		return 2000
	}
	return value
}

func (s Server) doFetchFeed(ctx context.Context, id uint64) (int, error) {
	var ds data.Dataset
	if err := s.DB.WithContext(ctx).First(&ds, id).Error; errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, nil
	} else if err != nil {
		return 0, err
	}
	if ds.FeedURL == "" {
		return 0, nil
	}
	count, err := s.readFeed(ctx, ds)
	if err != nil {
		_ = s.DB.WithContext(ctx).Model(&data.Dataset{}).Where("id = ?", id).Update("feedLastError", err.Error()).Error
		s.publishFeed(ctx, id, "feed:error", gin.H{"message": err.Error()})
		return 0, err
	}
	return count, nil
}

func (s Server) readFeed(ctx context.Context, ds data.Dataset) (int, error) {
	if os.Getenv("ALLOW_PRIVATE_FEED_URL") == "0" {
		if _, err := ai.PublicBaseURL(ds.FeedURL); err != nil {
			return 0, err
		}
	}
	requestCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(requestCtx, http.MethodGet, ds.FeedURL, nil)
	if err != nil {
		return 0, err
	}
	client := s.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}
	if os.Getenv("ALLOW_PRIVATE_FEED_URL") == "0" {
		copyClient := *client
		copyClient.CheckRedirect = func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return errors.New("重定向次数过多")
			}
			_, err := ai.PublicBaseURL(req.URL.String())
			return err
		}
		client = &copyClient
	}
	response, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return 0, fmt.Errorf("数据源返回 %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 16<<20))
	if err != nil {
		return 0, err
	}
	var items []json.RawMessage
	if json.Unmarshal(body, &items) != nil {
		var wrapped struct {
			Comments []json.RawMessage `json:"comments"`
		}
		if json.Unmarshal(body, &wrapped) != nil || wrapped.Comments == nil {
			return 0, errors.New("数据源不是合法 JSON 数组（或 { comments: [...] }）")
		}
		items = wrapped.Comments
	}
	if len(items) > feedLimit() {
		items = items[:feedLimit()]
	}
	now := time.Now().UTC()
	inserted := 0
	for _, item := range items {
		var raw map[string]json.RawMessage
		if json.Unmarshal(item, &raw) != nil || raw == nil {
			continue
		}
		comment := decodeFeedComment(raw)
		duplicate, err := s.feedDuplicate(ctx, ds.ID, comment)
		if err != nil {
			return 0, err
		}
		if duplicate {
			continue
		}
		ts, err := importTimestamp(comment.Timestamp, now.Add(time.Duration(inserted)*time.Second))
		if err != nil {
			ts = now.Add(time.Duration(inserted) * time.Second)
		}
		platform := ds.Platform
		if platform == "" {
			if parsed, e := url.Parse(ds.FeedURL); e == nil {
				platform = strings.TrimPrefix(parsed.Hostname(), "www.")
			}
		}
		row := normalizedImport(comment, strconv.FormatUint(ds.ID, 10), platform, ts)
		row.Content = truncateFeed(row.Content, 2000)
		row.Author = truncateFeed(row.Author, 64)
		row.Platform = truncateFeed(row.Platform, 64)
		row.SourceID = truncateFeed(row.SourceID, 191)
		if comment.Sentiment != nil {
			row.Analyzed = true
		}
		if err := s.DB.WithContext(ctx).Create(&row).Error; err != nil {
			return 0, err
		}
		inserted++
		s.publishFeed(ctx, ds.ID, "comment:stream", gin.H{"id": strconv.FormatUint(row.ID, 10), "content": row.Content, "author": row.Author, "platform": row.Platform, "timestamp": row.Timestamp, "sentiment": row.Sentiment, "sentimentScore": row.SentimentScore, "topics": row.Topics})
	}
	lastAt := time.Now().UTC()
	if err := s.DB.WithContext(ctx).Model(&data.Dataset{}).Where("id = ?", ds.ID).Updates(map[string]any{"feedLastAt": lastAt, "feedLastCount": inserted, "feedLastError": ""}).Error; err != nil {
		return 0, err
	}
	s.publishFeed(ctx, ds.ID, "feed:status", gin.H{"running": true, "lastAt": lastAt, "count": inserted})
	if inserted > 0 && s.Alerts != nil {
		if err := s.Alerts.Check(ctx, strconv.FormatUint(ds.ID, 10), nil); err != nil {
			log.Printf("[feed] alert check for %d: %v", ds.ID, err)
		}
	}
	return inserted, nil
}

func truncateFeed(value string, limit int) string {
	runes := []rune(value)
	if len(runes) > limit {
		return string(runes[:limit])
	}
	return value
}

func decodeFeedComment(raw map[string]json.RawMessage) importComment {
	stringField := func(names ...string) *string {
		for _, name := range names {
			if value, ok := raw[name]; ok && string(value) != "null" {
				text := rawScalar(value)
				return &text
			}
		}
		return nil
	}
	c := importComment{Content: stringField("content"), Text: stringField("text"), Comment: stringField("comment"), Author: stringField("author"), Name: stringField("name"), Nickname: stringField("nickname"), User: raw["user"], Username: stringField("username"), Email: stringField("email"), Platform: stringField("platform"), Source: stringField("source"), Channel: stringField("channel"), Timestamp: raw["timestamp"], ID: raw["id"], CommentID: raw["commentId"]}
	if value := stringField("sentiment"); value != nil && (*value == "pos" || *value == "neu" || *value == "neg") {
		c.Sentiment = value
	}
	_ = json.Unmarshal(raw["sentimentScore"], &c.SentimentScore)
	_ = json.Unmarshal(raw["topics"], &c.Topics)
	_ = json.Unmarshal(raw["keywords"], &c.Keywords)
	return c
}

func (s Server) feedDuplicate(ctx context.Context, datasetID uint64, raw importComment) (bool, error) {
	filter := map[string]any{"datasetId": strconv.FormatUint(datasetID, 10)}
	if sourceID := rawScalar(raw.ID); sourceID != "" {
		filter["sourceId"] = sourceID
	} else if sourceID := rawScalar(raw.CommentID); sourceID != "" {
		filter["sourceId"] = sourceID
	} else {
		if content := firstString(raw.Content, raw.Text, raw.Comment); content != "" {
			filter["content"] = content
		}
		if author := firstString(raw.Author, raw.Name, raw.Nickname, raw.Username, raw.Email); author != "" {
			filter["author"] = author
		}
		if platform := firstString(raw.Platform, raw.Source, raw.Channel); platform != "" {
			filter["platform"] = platform
		}
		if len(raw.Timestamp) > 0 {
			if ts, err := importTimestamp(raw.Timestamp, time.Time{}); err == nil && !ts.IsZero() {
				filter["timestamp"] = ts
			}
		}
		if raw.Sentiment != nil {
			filter["sentiment"] = *raw.Sentiment
		}
		if raw.SentimentScore != nil {
			filter["sentimentScore"] = *raw.SentimentScore
		}
		if len(raw.Topics) > 0 {
			encoded, _ := json.Marshal(raw.Topics)
			filter["topics"] = string(encoded)
		}
		if len(raw.Keywords) > 0 {
			encoded, _ := json.Marshal(raw.Keywords)
			filter["keywords"] = string(encoded)
		}
	}
	var count int64
	err := s.DB.WithContext(ctx).Model(&data.Comment{}).Where(filter).Limit(1).Count(&count).Error
	return count > 0, err
}
