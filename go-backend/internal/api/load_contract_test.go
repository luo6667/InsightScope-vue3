package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"

	"insightscope/go-backend/internal/analysis"
	"insightscope/go-backend/internal/data"
	"insightscope/go-backend/internal/tasks"
)

func TestTenThousandCommentsAndBackgroundAnalysis(t *testing.T) {
	if os.Getenv("GO_LOAD_TEST") != "1" {
		t.Skip("set GO_LOAD_TEST=1 for isolated 10k data test")
	}
	dsn, addr := os.Getenv("GO_INTEGRATION_DSN"), os.Getenv("GO_INTEGRATION_REDIS")
	if !strings.Contains(dsn, "/plfx_go_it?") || addr != "127.0.0.1:16379" {
		t.Fatal("load test requires isolated plfx_go_it and Redis 16379")
	}
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	client := redis.NewClient(&redis.Options{Addr: addr})
	defer client.Close()
	server := Server{DB: db, StatsRedis: client}
	large := data.Dataset{Name: "Go 10k load", Platform: "test", Type: "imported"}
	if err := db.Create(&large).Error; err != nil {
		t.Fatal(err)
	}
	largeID := strconv.FormatUint(large.ID, 10)
	defer requestJSON(server, http.MethodDelete, "/api/datasets/"+largeID, "")
	small := data.Dataset{Name: "Go second dataset", Platform: "test", Type: "imported"}
	if err := db.Create(&small).Error; err != nil {
		t.Fatal(err)
	}
	smallID := strconv.FormatUint(small.ID, 10)
	defer requestJSON(server, http.MethodDelete, "/api/datasets/"+smallID, "")
	start := time.Now()
	rows := make([]data.Comment, 10000)
	base := time.Now().UTC().Add(-time.Hour)
	for i := range rows {
		rows[i] = data.Comment{DatasetID: largeID, Content: "sample review", Author: "load", Platform: "test", Timestamp: base.Add(time.Duration(i) * time.Millisecond), Sentiment: "neu", Topics: []string{}, Keywords: []string{}, Analyzed: false}
	}
	if err := db.CreateInBatches(rows, 500).Error; err != nil {
		t.Fatal(err)
	}
	other := make([]data.Comment, 100)
	for i := range other {
		other[i] = data.Comment{DatasetID: smallID, Content: "other", Author: "load", Platform: "test", Timestamp: base, Sentiment: "neu", Topics: []string{}, Keywords: []string{}}
	}
	if err := db.CreateInBatches(other, 100).Error; err != nil {
		t.Fatal(err)
	}
	loadTime := time.Since(start)
	started := time.Now()
	page := requestJSON(server, http.MethodGet, "/api/datasets/"+largeID+"/comments?page=3&limit=50&sentiment=neu", "")
	if page.Code != 200 {
		t.Fatalf("page: %d %s", page.Code, page.Body.String())
	}
	var pageBody struct {
		Total    int               `json:"total"`
		Comments []json.RawMessage `json:"comments"`
	}
	if err := json.Unmarshal(page.Body.Bytes(), &pageBody); err != nil || pageBody.Total != 10000 || len(pageBody.Comments) != 50 {
		t.Fatalf("page totals: %+v %v", pageBody, err)
	}
	pageTime := time.Since(started)
	started = time.Now()
	stats := requestJSON(server, http.MethodGet, "/api/datasets/"+largeID+"/stats", "")
	if stats.Code != 200 || !strings.Contains(stats.Body.String(), `"total":10000`) {
		t.Fatalf("stats: %d %s", stats.Code, stats.Body.String())
	}
	statsTime := time.Since(started)
	started = time.Now()
	exported := requestJSON(server, http.MethodGet, "/api/datasets/"+largeID+"/export?format=json", "")
	if exported.Code != 200 {
		t.Fatalf("export: %d", exported.Code)
	}
	var exportBody struct {
		Comments []json.RawMessage `json:"comments"`
	}
	if err := json.Unmarshal(exported.Body.Bytes(), &exportBody); err != nil || len(exportBody.Comments) != 10000 {
		t.Fatalf("exported: %d %v", len(exportBody.Comments), err)
	}
	exportTime := time.Since(started)

	modelServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil || len(body.Messages) < 2 {
			http.Error(w, "invalid request", 400)
			return
		}
		lines := strings.Split(strings.TrimPrefix(body.Messages[1].Content, "评论列表：\n"), "\n")
		results := make([]map[string]any, len(lines))
		for i := range results {
			results[i] = map[string]any{"sentiment": "pos", "sentimentScore": 0.7, "topics": []string{"性能"}, "keywords": []string{"快"}}
		}
		content, _ := json.Marshal(results)
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": string(content)}}}})
	}))
	defer modelServer.Close()
	credentials, err := analysis.NewCredentials(base64.StdEncoding.EncodeToString([]byte(strings.Repeat("k", 32))))
	if err != nil {
		t.Fatal(err)
	}
	job := data.AnalysisJob{DatasetID: largeID, Status: "pending", Total: 10000, Concurrency: 6}
	if err := db.Create(&job).Error; err != nil {
		t.Fatal(err)
	}
	nonce, ciphertext, err := credentials.Encrypt(job.ID, analysis.AIConfig{APIKey: "test", BaseURL: modelServer.URL, Model: "fake"})
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
	worker := analysis.Worker{DB: db, Credentials: credentials, Model: analysis.LLM{Client: &http.Client{}}, Locks: analysis.RedisLocks{Redis: client}, CacheVersioning: true}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	started = time.Now()
	if err := worker.Handle(ctx, task); err != nil {
		t.Fatal(err)
	}
	analysisTime := time.Since(started)
	var result data.AnalysisJob
	if err := db.First(&result, job.ID).Error; err != nil || result.Status != "done" || result.Processed != 10000 {
		t.Fatalf("job: %+v %v", result, err)
	}
	var otherCount int64
	if err := db.Model(&data.Comment{}).Where("datasetId = ? AND analyzed = ?", smallID, true).Count(&otherCount).Error; err != nil || otherCount != 0 {
		t.Fatalf("second dataset changed: %d %v", otherCount, err)
	}
	t.Logf("machine=%s/%s cpu=%d go=%s rows=10000+100 insert=%s page=%s stats=%s export=%s analysis=%s throughput=%.1f comments/s", runtime.GOOS, runtime.GOARCH, runtime.NumCPU(), runtime.Version(), loadTime, pageTime, statsTime, exportTime, analysisTime, 10000/analysisTime.Seconds())
}
