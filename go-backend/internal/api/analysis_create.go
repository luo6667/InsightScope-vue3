package api

import (
	"encoding/json"
	"errors"
	"log"
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"insightscope/go-backend/internal/ai"
	"insightscope/go-backend/internal/analysis"
	"insightscope/go-backend/internal/data"
)

type createAnalysisBody struct {
	APIKey      string          `json:"apiKey"`
	BaseURL     string          `json:"baseUrl"`
	Model       string          `json:"model"`
	Temperature *float64        `json:"temperature"`
	Concurrency json.RawMessage `json:"concurrency"`
}

func analysisConcurrency(raw json.RawMessage) (int, error) {
	if len(raw) == 0 {
		return 6, nil
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
		return 0, errors.New("concurrency 不合法")
	}
	if number < 1 || number > 8 || number != float64(int(number)) {
		return 0, errors.New("concurrency 不合法")
	}
	return int(number), nil
}

func (s Server) createAnalysisJob(c *gin.Context) {
	datasetID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID 不合法"})
		return
	}
	var body createAnalysisBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数不合法"})
		return
	}
	body.APIKey = strings.TrimSpace(body.APIKey)
	body.BaseURL = strings.TrimSpace(body.BaseURL)
	body.Model = strings.TrimSpace(body.Model)
	concurrency, err := analysisConcurrency(body.Concurrency)
	if err != nil || body.APIKey == "" || body.Model == "" || len(body.APIKey) > 1024 || len(body.Model) > 128 || len(body.BaseURL) > 2048 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数不合法"})
		return
	}
	temperature := 0.2
	if body.Temperature != nil {
		temperature = *body.Temperature
	}
	if math.IsNaN(temperature) || temperature < 0 || temperature > 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数不合法"})
		return
	}
	safeBase, err := ai.PublicBaseURL(body.BaseURL)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if s.Queue == nil || s.Credentials.AEAD == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "任务服务暂不可用"})
		return
	}
	var job data.AnalysisJob
	created := false
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var dataset data.Dataset
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id").First(&dataset, datasetID).Error; err != nil {
			return err
		}
		err := tx.Where("datasetId = ? AND status IN ?", strconv.FormatUint(datasetID, 10), []string{"pending", "running"}).Order("createdAt DESC").First(&job).Error
		if err == nil {
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		job = data.AnalysisJob{DatasetID: strconv.FormatUint(datasetID, 10), Status: "pending", Concurrency: concurrency}
		if err := tx.Create(&job).Error; err != nil {
			return err
		}
		nonce, ciphertext, err := s.Credentials.Encrypt(job.ID, analysis.AIConfig{APIKey: body.APIKey, BaseURL: safeBase, Model: body.Model, Temperature: temperature})
		if err != nil {
			return err
		}
		if err := tx.Create(&data.AnalysisJobSecret{JobID: job.ID, Nonce: nonce, Ciphertext: ciphertext}).Error; err != nil {
			return err
		}
		created = true
		return nil
	})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "数据集不存在"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器内部错误"})
		return
	}
	if !created {
		c.JSON(http.StatusOK, gin.H{"job": jobResponse(job)})
		return
	}
	if err := s.Queue.EnqueueAnalysis(c.Request.Context(), job.ID); err != nil {
		cleanupErr := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
			if err := tx.Where("jobId = ?", job.ID).Delete(&data.AnalysisJobSecret{}).Error; err != nil {
				return err
			}
			return tx.Model(&data.AnalysisJob{}).Where("id = ?", job.ID).Update("status", "failed").Error
		})
		if cleanupErr != nil {
			log.Printf("[analysis] could not clean failed enqueue for job %d: %v", job.ID, cleanupErr)
		}
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "任务服务暂不可用"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"job": jobResponse(job)})
}
