package api

import (
	"errors"
	"log"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"insightscope/go-backend/internal/data"
)

func analysisDatasetID(c *gin.Context) (string, bool) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID 不合法"})
		return "", false
	}
	return strconv.FormatUint(id, 10), true
}

func (s Server) pauseAnalysis(c *gin.Context) {
	datasetID, ok := analysisDatasetID(c)
	if !ok {
		return
	}
	var job data.AnalysisJob
	err := s.DB.WithContext(c.Request.Context()).Where("datasetId = ? AND status = ?", datasetID, "running").First(&job).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "没有运行中的任务"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器内部错误"})
		return
	}
	change := s.DB.WithContext(c.Request.Context()).Model(&data.AnalysisJob{}).Where("id = ? AND status = ?", job.ID, "running").Update("status", "paused")
	if change.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器内部错误"})
		return
	}
	if change.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "没有运行中的任务"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (s Server) resumeAnalysis(c *gin.Context) {
	datasetID, ok := analysisDatasetID(c)
	if !ok {
		return
	}
	var job data.AnalysisJob
	err := s.DB.WithContext(c.Request.Context()).Where("datasetId = ? AND status = ?", datasetID, "paused").First(&job).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "没有暂停的任务"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器内部错误"})
		return
	}
	if s.Queue == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "任务服务暂不可用"})
		return
	}
	change := s.DB.WithContext(c.Request.Context()).Model(&data.AnalysisJob{}).Where("id = ? AND status = ?", job.ID, "paused").Update("status", "running")
	if change.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器内部错误"})
		return
	}
	if change.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "没有暂停的任务"})
		return
	}
	if err := s.Queue.EnqueueAnalysis(c.Request.Context(), job.ID); err != nil {
		if revert := s.DB.WithContext(c.Request.Context()).Model(&data.AnalysisJob{}).Where("id = ? AND status = ?", job.ID, "running").Update("status", "paused").Error; revert != nil {
			log.Printf("[analysis] could not restore paused job %d after enqueue failure: %v", job.ID, revert)
		}
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "任务服务暂不可用"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (s Server) cancelAnalysis(c *gin.Context) {
	datasetID, ok := analysisDatasetID(c)
	if !ok {
		return
	}
	missing := false
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var job data.AnalysisJob
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("datasetId = ? AND status IN ?", datasetID, []string{"running", "paused"}).First(&job).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			missing = true
			return err
		}
		if err != nil {
			return err
		}
		if err := tx.Model(&job).Update("status", "failed").Error; err != nil {
			return err
		}
		return tx.Where("jobId = ?", job.ID).Delete(&data.AnalysisJobSecret{}).Error
	})
	if missing {
		c.JSON(http.StatusNotFound, gin.H{"error": "没有运行中的任务"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器内部错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (s Server) resetAnalysis(c *gin.Context) {
	datasetID, ok := analysisDatasetID(c)
	if !ok {
		return
	}
	var affected int64
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		jobIDs := tx.Model(&data.AnalysisJob{}).Select("id").Where("datasetId = ?", datasetID)
		if err := tx.Where("jobId IN (?)", jobIDs).Delete(&data.AnalysisJobSecret{}).Error; err != nil {
			return err
		}
		if err := tx.Where("datasetId = ?", datasetID).Delete(&data.AnalysisJob{}).Error; err != nil {
			return err
		}
		change := tx.Model(&data.Comment{}).Where("datasetId = ?", datasetID).Updates(map[string]any{"analyzed": false, "sentiment": "neu", "sentimentScore": 0, "topics": "[]", "keywords": "[]"})
		affected = change.RowsAffected
		return change.Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器内部错误"})
		return
	}
	if s.Events != nil {
		if err := s.Events.Publish(c.Request.Context(), datasetID, "analysis:reset", gin.H{"count": affected}); err != nil {
			log.Printf("[analysis] reset event failed for dataset %s: %v", datasetID, err)
		}
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "reset": affected})
}
