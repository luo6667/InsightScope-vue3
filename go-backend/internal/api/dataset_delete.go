package api

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"insightscope/go-backend/internal/data"
)

func (s Server) deleteDataset(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID 不合法"})
		return
	}
	missing := false
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var dataset data.Dataset
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&dataset, id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				missing = true
			}
			return err
		}
		datasetID := strconv.FormatUint(dataset.ID, 10)
		for _, model := range []any{&data.Comment{}, &data.AnalysisJob{}, &data.Alert{}, &data.AlertRule{}} {
			if err := tx.Where("datasetId = ?", datasetID).Delete(model).Error; err != nil {
				return err
			}
		}
		return tx.Delete(&dataset).Error
	})
	if missing {
		c.JSON(http.StatusNotFound, gin.H{"error": "数据集不存在"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器内部错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
