package api

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"insightscope/go-backend/internal/data"
)

type analysisJobResponse struct {
	ID          string    `json:"id"`
	DatasetID   string    `json:"datasetId"`
	Status      string    `json:"status"`
	Total       int       `json:"total"`
	Processed   int       `json:"processed"`
	Failed      int       `json:"failed"`
	Concurrency int       `json:"concurrency"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

func (s Server) getAnalysisJob(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID 不合法"})
		return
	}
	var job data.AnalysisJob
	err = s.DB.WithContext(c.Request.Context()).Where("datasetId = ?", strconv.FormatUint(id, 10)).Order("createdAt DESC").First(&job).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusOK, gin.H{"job": nil})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器内部错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"job": analysisJobResponse{
		ID: strconv.FormatUint(job.ID, 10), DatasetID: job.DatasetID, Status: job.Status,
		Total: job.Total, Processed: job.Processed, Failed: job.Failed, Concurrency: job.Concurrency,
		CreatedAt: job.CreatedAt, UpdatedAt: job.UpdatedAt,
	}})
}
