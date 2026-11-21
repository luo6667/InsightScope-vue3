package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"insightscope/go-backend/internal/data"
)

func alertDatasetID(c *gin.Context) (string, bool) {
	id := c.Query("datasetId")
	if id == "" {
		return "", true
	}
	if len(id) > 64 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "数据集 ID 不合法"})
		return "", false
	}
	if _, err := strconv.ParseUint(id, 10, 64); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "数据集 ID 不合法"})
		return "", false
	}
	return id, true
}

func (s Server) listRules(c *gin.Context) {
	id, ok := alertDatasetID(c)
	if !ok {
		return
	}
	query := s.DB.WithContext(c.Request.Context()).Model(&data.AlertRule{})
	if id != "" {
		query = query.Where("datasetId = ?", id)
	}
	var rules []data.AlertRule
	if err := query.Find(&rules).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器内部错误"})
		return
	}
	items := make([]gin.H, 0, len(rules))
	for _, r := range rules {
		items = append(items, gin.H{"id": strconv.FormatUint(r.ID, 10), "datasetId": r.DatasetID,
			"type": r.Type, "threshold": r.Threshold, "keyword": r.Keyword,
			"windowMin": r.WindowMin, "enabled": r.Enabled})
	}
	c.JSON(http.StatusOK, gin.H{"rules": items})
}

func (s Server) listAlerts(c *gin.Context) {
	id, ok := alertDatasetID(c)
	if !ok {
		return
	}
	limit, ok := alertPageInt(c, "limit", 100, 1, 500)
	if !ok {
		return
	}
	skip, ok := alertPageInt(c, "skip", 0, 0, 1000000)
	if !ok {
		return
	}
	query := s.DB.WithContext(c.Request.Context()).Model(&data.Alert{})
	if id != "" {
		query = query.Where("datasetId = ?", id)
	}
	var alerts []data.Alert
	if err := query.Order("triggeredAt DESC").Offset(skip).Limit(limit).Find(&alerts).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器内部错误"})
		return
	}
	items := make([]gin.H, 0, len(alerts))
	for _, a := range alerts {
		items = append(items, gin.H{"id": strconv.FormatUint(a.ID, 10), "datasetId": a.DatasetID,
			"type": a.Type, "severity": a.Severity, "message": a.Message, "value": a.Value,
			"triggeredAt": a.TriggeredAt.Format(time.RFC3339Nano), "acknowledged": a.Acknowledged})
	}
	c.JSON(http.StatusOK, gin.H{"alerts": items})
}

func alertPageInt(c *gin.Context, name string, fallback, min, max int) (int, bool) {
	if c.Query(name) == "" {
		return fallback, true
	}
	v, err := strconv.Atoi(c.Query(name))
	if err != nil || v < min || v > max {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数校验失败"})
		return 0, false
	}
	return v, true
}
