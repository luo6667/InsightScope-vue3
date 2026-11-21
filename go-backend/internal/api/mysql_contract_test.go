package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"

	"insightscope/go-backend/internal/alerts"
	"insightscope/go-backend/internal/analysis"
	"insightscope/go-backend/internal/data"
	"insightscope/go-backend/internal/tasks"
)

// Run only against an isolated Sequelize-created plfx_go_it database.
func TestMySQLContractWithOriginalSchema(t *testing.T) {
	dsn := os.Getenv("GO_INTEGRATION_DSN")
	if dsn == "" {
		t.Skip("set GO_INTEGRATION_DSN for isolated MySQL contract test")
	}
	if !strings.Contains(dsn, "/plfx_go_it?") {
		t.Fatal("integration DSN must target plfx_go_it")
	}
	redisAddr := os.Getenv("GO_INTEGRATION_REDIS")
	if redisAddr == "" {
		t.Fatal("set GO_INTEGRATION_REDIS for isolated Redis")
	}
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	client := redis.NewClient(&redis.Options{Addr: redisAddr})
	defer client.Close()
	server := Server{DB: db, FeedRedis: client, StatsRedis: client, Alerts: &alerts.Engine{DB: db}}

	created := requestJSON(server, http.MethodPost, "/api/datasets", `{"name":"Go contract imported","comments":[{"id":"one","text":"差评","name":"Ada","sentiment":"neg","topics":["产品"]},{"id":"two","text":"好评","name":"Bo","sentiment":"pos"}]}`)
	if created.Code != 201 {
		t.Fatalf("create imported: %d %s", created.Code, created.Body.String())
	}
	var imported struct {
		ID    string `json:"id"`
		Count int    `json:"count"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &imported); err != nil || imported.Count != 2 {
		t.Fatalf("create imported: %s %v", created.Body.String(), err)
	}
	defer requestJSON(server, http.MethodDelete, "/api/datasets/"+imported.ID, "")
	comments := requestJSON(server, http.MethodGet, "/api/datasets/"+imported.ID+"/comments", "")
	if comments.Code != 200 || !strings.Contains(comments.Body.String(), "产品") {
		t.Fatalf("read JSON topics: %d %s", comments.Code, comments.Body.String())
	}
	stats := requestJSON(server, http.MethodGet, "/api/datasets/"+imported.ID+"/stats", "")
	if stats.Code != 200 {
		t.Fatalf("stats: %d %s", stats.Code, stats.Body.String())
	}
	var importedComment data.Comment
	beforeVersion, err := data.CurrentDataVersion(db, imported.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Where("datasetId = ? AND sourceId = ?", imported.ID, "one").First(&importedComment).Error; err != nil {
		t.Fatal(err)
	}
	changed := requestJSON(server, http.MethodPatch, "/api/datasets/"+imported.ID+"/comments/"+strconv.FormatUint(importedComment.ID, 10), `{"sentiment":"neu","topics":["新话题"]}`)
	if changed.Code != 200 {
		t.Fatalf("patch: %d %s", changed.Code, changed.Body.String())
	}
	afterVersion, err := data.CurrentDataVersion(db, imported.ID)
	if err != nil {
		t.Fatal(err)
	}
	if afterVersion <= beforeVersion {
		t.Fatalf("cache version did not advance: %d -> %d", beforeVersion, afterVersion)
	}
	updatedStats := requestJSON(server, http.MethodGet, "/api/datasets/"+imported.ID+"/stats", "")
	if updatedStats.Code != 200 || !strings.Contains(updatedStats.Body.String(), "新话题") {
		t.Fatalf("cached stats invalidation: %d %s", updatedStats.Code, updatedStats.Body.String())
	}
	server.StatsRedis = redis.NewClient(&redis.Options{Addr: "127.0.0.1:16380", MaxRetries: 0, DialTimeout: 50 * time.Millisecond})
	defer server.StatsRedis.Close()
	fallbackStats := requestJSON(server, http.MethodGet, "/api/datasets/"+imported.ID+"/stats", "")
	if fallbackStats.Code != 200 || !strings.Contains(fallbackStats.Body.String(), "新话题") {
		t.Fatalf("stats Redis fallback: %d %s", fallbackStats.Code, fallbackStats.Body.String())
	}
	server.StatsRedis = client

	feedSource := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`[{"id":"source-1","content":"敏感词 出现","author":"Ada","topics":["话题"]}]`))
	}))
	defer feedSource.Close()
	feedBody, _ := json.Marshal(map[string]any{"name": "Go contract feed", "feedUrl": feedSource.URL})
	createdFeed := requestJSON(server, http.MethodPost, "/api/datasets", string(feedBody))
	if createdFeed.Code != 201 {
		t.Fatalf("create feed: %d %s", createdFeed.Code, createdFeed.Body.String())
	}
	var feedDataset struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(createdFeed.Body.Bytes(), &feedDataset); err != nil {
		t.Fatal(err)
	}
	defer requestJSON(server, http.MethodDelete, "/api/datasets/"+feedDataset.ID, "")
	rule := requestJSON(server, http.MethodPost, "/api/alerts/rules", `{"datasetId":"`+feedDataset.ID+`","type":"keyword","keyword":"敏感词","threshold":1}`)
	if rule.Code != 201 {
		t.Fatalf("create rule: %d %s", rule.Code, rule.Body.String())
	}
	first := requestJSON(server, http.MethodPost, "/api/datasets/"+feedDataset.ID+"/feed/pull", "")
	if first.Code != 200 || !strings.Contains(first.Body.String(), `"count":1`) {
		t.Fatalf("first pull: %d %s", first.Code, first.Body.String())
	}
	second := requestJSON(server, http.MethodPost, "/api/datasets/"+feedDataset.ID+"/feed/pull", "")
	if second.Code != 200 || !strings.Contains(second.Body.String(), `"count":0`) {
		t.Fatalf("dedup pull: %d %s", second.Code, second.Body.String())
	}
	var alertsCount int64
	if err := db.Model(&data.Alert{}).Where("datasetId = ?", feedDataset.ID).Count(&alertsCount).Error; err != nil || alertsCount != 1 {
		t.Fatalf("alerts: %d %v", alertsCount, err)
	}
	id, _ := strconv.ParseUint(feedDataset.ID, 10, 64)
	if id == 0 {
		t.Fatal("feed dataset ID is not numeric")
	}

	createdAnalysis := requestJSON(server, http.MethodPost, "/api/datasets", `{"name":"Go contract analysis","comments":[{"content":"客服很慢"}]}`)
	if createdAnalysis.Code != 201 {
		t.Fatalf("analysis dataset: %d %s", createdAnalysis.Code, createdAnalysis.Body.String())
	}
	var analysisDataset struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(createdAnalysis.Body.Bytes(), &analysisDataset); err != nil {
		t.Fatal(err)
	}
	defer requestJSON(server, http.MethodDelete, "/api/datasets/"+analysisDataset.ID, "")
	var modelHits atomic.Int64
	modelServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		modelHits.Add(1)
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"[{\"sentiment\":\"neg\",\"sentimentScore\":-0.8,\"topics\":[\"客服\"],\"keywords\":[\"慢\"]}]"}}]}`))
	}))
	defer modelServer.Close()
	cipher, err := analysis.NewCredentials(base64.StdEncoding.EncodeToString([]byte(strings.Repeat("k", 32))))
	if err != nil {
		t.Fatal(err)
	}
	job := data.AnalysisJob{DatasetID: analysisDataset.ID, Status: "pending", Total: 1, Concurrency: 1}
	if err := db.Create(&job).Error; err != nil {
		t.Fatal(err)
	}
	nonce, encrypted, err := cipher.Encrypt(job.ID, analysis.AIConfig{APIKey: "test-key", BaseURL: modelServer.URL, Model: "test-model"})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&data.AnalysisJobSecret{JobID: job.ID, Nonce: nonce, Ciphertext: encrypted}).Error; err != nil {
		t.Fatal(err)
	}
	task, err := tasks.Analysis(job.ID)
	if err != nil {
		t.Fatal(err)
	}
	worker := analysis.Worker{DB: db, Credentials: cipher, Model: analysis.LLM{Client: &http.Client{}}, Locks: analysis.RedisLocks{Redis: client}, CacheVersioning: true}
	probe := worker.Model.Analyze(context.Background(), analysis.AIConfig{APIKey: "test-key", BaseURL: modelServer.URL, Model: "test-model"}, []string{"客服很慢"})
	if len(probe) != 1 || probe[0] == nil {
		t.Fatalf("fake model response was not parsed; hits=%d", modelHits.Load())
	}
	if err := worker.Handle(context.Background(), task); err != nil {
		t.Fatal(err)
	}
	var finished data.AnalysisJob
	if err := db.First(&finished, job.ID).Error; err != nil || finished.Status != "done" || finished.Processed != 1 {
		t.Fatalf("finished: %+v %v", finished, err)
	}
	var analyzed data.Comment
	if err := db.Where("datasetId = ?", analysisDataset.ID).First(&analyzed).Error; err != nil || !analyzed.Analyzed || analyzed.Sentiment != "neg" || len(analyzed.Topics) != 1 {
		t.Fatalf("analyzed: %+v %v", analyzed, err)
	}
	var secrets int64
	if err := db.Model(&data.AnalysisJobSecret{}).Where("jobId = ?", job.ID).Count(&secrets).Error; err != nil || secrets != 0 {
		t.Fatalf("secrets: %d %v", secrets, err)
	}
	reset := requestJSON(server, http.MethodPost, "/api/datasets/"+analysisDataset.ID+"/analysis/reset", "")
	if reset.Code != 200 {
		t.Fatalf("reset: %d %s", reset.Code, reset.Body.String())
	}
	if err := db.Where("datasetId = ?", analysisDataset.ID).First(&analyzed).Error; err != nil || analyzed.Analyzed || len(analyzed.Topics) != 0 || len(analyzed.Keywords) != 0 {
		t.Fatalf("reset comment: %+v %v", analyzed, err)
	}
}

func TestAnalysisResumesAfterWorkerInterruption(t *testing.T) {
	dsn := os.Getenv("GO_INTEGRATION_DSN")
	if dsn == "" {
		t.Skip("set GO_INTEGRATION_DSN for isolated MySQL test")
	}
	if !strings.Contains(dsn, "/plfx_go_it?") || os.Getenv("GO_INTEGRATION_REDIS") != "127.0.0.1:16379" {
		t.Fatal("integration test requires isolated plfx_go_it and Redis 16379")
	}
	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	redisClient := redis.NewClient(&redis.Options{Addr: "127.0.0.1:16379"})
	defer redisClient.Close()
	comments := make([]map[string]string, 16)
	for i := range comments {
		comments[i] = map[string]string{"content": "待分析评论" + strconv.Itoa(i)}
	}
	body, err := json.Marshal(map[string]any{"name": "Worker interruption contract", "comments": comments})
	if err != nil {
		t.Fatal(err)
	}
	server := Server{DB: db, StatsRedis: redisClient}
	created := requestJSON(server, http.MethodPost, "/api/datasets", string(body))
	if created.Code != http.StatusCreated {
		t.Fatalf("create dataset: %d %s", created.Code, created.Body.String())
	}
	var dataset struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &dataset); err != nil {
		t.Fatal(err)
	}
	defer requestJSON(server, http.MethodDelete, "/api/datasets/"+dataset.ID, "")
	credentials, err := analysis.NewCredentials(base64.StdEncoding.EncodeToString([]byte(strings.Repeat("r", 32))))
	if err != nil {
		t.Fatal(err)
	}
	job := data.AnalysisJob{DatasetID: dataset.ID, Status: "pending", Total: 16, Concurrency: 1}
	if err := db.Create(&job).Error; err != nil {
		t.Fatal(err)
	}
	var requests atomic.Int64
	var interrupt context.CancelFunc
	model := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if requests.Add(1) == 2 {
			interrupt()
			return
		}
		var input struct {
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil || len(input.Messages) < 2 {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		lines := strings.Split(strings.TrimPrefix(input.Messages[1].Content, "评论列表：\n"), "\n")
		results := make([]map[string]any, len(lines))
		for i := range results {
			results[i] = map[string]any{"sentiment": "pos", "sentimentScore": 0.7, "topics": []string{"体验"}, "keywords": []string{"好"}}
		}
		content, _ := json.Marshal(results)
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": string(content)}}}})
	}))
	defer model.Close()
	nonce, ciphertext, err := credentials.Encrypt(job.ID, analysis.AIConfig{APIKey: "test", BaseURL: model.URL, Model: "fake"})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&data.AnalysisJobSecret{JobID: job.ID, Nonce: nonce, Ciphertext: ciphertext}).Error; err != nil {
		t.Fatal(err)
	}
	task, err := tasks.Analysis(job.ID)
	if err != nil {
		t.Fatal(err)
	}
	worker := analysis.Worker{DB: db, Credentials: credentials, Model: analysis.LLM{Client: &http.Client{}}, Locks: analysis.RedisLocks{Redis: redisClient}, CacheVersioning: true}
	ctx, cancel := context.WithCancel(context.Background())
	interrupt = cancel
	if err := worker.Handle(ctx, task); err == nil {
		t.Fatal("interrupted worker unexpectedly completed")
	}
	var interrupted data.AnalysisJob
	if err := db.First(&interrupted, job.ID).Error; err != nil || interrupted.Status != "running" || interrupted.Processed != 8 {
		t.Fatalf("checkpoint after interruption: %+v %v", interrupted, err)
	}
	if err := worker.Handle(context.Background(), task); err != nil {
		t.Fatal(err)
	}
	var finished data.AnalysisJob
	if err := db.First(&finished, job.ID).Error; err != nil || finished.Status != "done" || finished.Processed != 16 {
		var remaining int64
		_ = db.Model(&data.Comment{}).Where("datasetId = ? AND analyzed = ?", dataset.ID, false).Count(&remaining).Error
		t.Fatalf("resumed job: %+v %v, model requests=%d, remaining=%d", finished, err, requests.Load(), remaining)
	}
	var analyzed, secrets int64
	if err := db.Model(&data.Comment{}).Where("datasetId = ? AND analyzed = ?", dataset.ID, true).Count(&analyzed).Error; err != nil || analyzed != 16 {
		t.Fatalf("analyzed comments: %d %v", analyzed, err)
	}
	if err := db.Model(&data.AnalysisJobSecret{}).Where("jobId = ?", job.ID).Count(&secrets).Error; err != nil || secrets != 0 {
		t.Fatalf("remaining secrets: %d %v", secrets, err)
	}
}
