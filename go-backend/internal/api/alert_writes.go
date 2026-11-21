package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"insightscope/go-backend/internal/data"
)

type ruleInput struct {
	DatasetID string          `json:"datasetId"`
	Type      *string         `json:"type"`
	Threshold *float64        `json:"threshold"`
	Keyword   *string         `json:"keyword"`
	WindowMin json.RawMessage `json:"windowMin"`
	Enabled   *bool           `json:"enabled"`
}

func ruleTypeValid(value string) bool {
	return value == "negativity" || value == "volume" || value == "keyword"
}

func idParam(c *gin.Context) (uint64, bool) {
	raw := c.Param("id")
	id, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || len(raw) > 64 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID 不合法"})
		return 0, false
	}
	return id, true
}

func windowMin(raw json.RawMessage, fallback int) (int, error) {
	if len(raw) == 0 {
		return fallback, nil
	}
	var value int
	if err := json.Unmarshal(raw, &value); err != nil {
		var str string
		if err := json.Unmarshal(raw, &str); err != nil {
			return 0, err
		}
		value, err = strconv.Atoi(str)
		if err != nil {
			return 0, err
		}
	}
	if value < 1 || value > 1440 {
		return 0, errors.New("windowMin out of range")
	}
	return value, nil
}

func validateRule(c *gin.Context, input ruleInput, create bool) (int, bool) {
	window, err := windowMin(input.WindowMin, 10)
	if err != nil {
		c.JSON(400, gin.H{"error": "时间窗口需在 1 ~ 1440 分钟之间"})
		return 0, false
	}
	if create {
		if _, err := strconv.ParseUint(input.DatasetID, 10, 64); err != nil || len(input.DatasetID) > 64 || input.Type == nil || input.Threshold == nil {
			c.JSON(400, gin.H{"error": "参数校验失败"})
			return 0, false
		}
	} else if input.Type == nil && input.Threshold == nil && input.Keyword == nil && len(input.WindowMin) == 0 && input.Enabled == nil {
		c.JSON(400, gin.H{"error": "没有可更新的字段"})
		return 0, false
	}
	if input.Type != nil && !ruleTypeValid(*input.Type) {
		c.JSON(400, gin.H{"error": "参数校验失败"})
		return 0, false
	}
	if input.Threshold != nil && (*input.Threshold < 0 || *input.Threshold > 100000) {
		c.JSON(400, gin.H{"error": "参数校验失败"})
		return 0, false
	}
	if input.Keyword != nil && len([]rune(*input.Keyword)) > 255 {
		c.JSON(400, gin.H{"error": "参数校验失败"})
		return 0, false
	}
	if create && *input.Type == "keyword" && (input.Keyword == nil || *input.Keyword == "") {
		c.JSON(400, gin.H{"error": "敏感关键词规则必须填写关键词"})
		return 0, false
	}
	return window, true
}

func (s Server) createRule(c *gin.Context) {
	var input ruleInput
	if c.ShouldBindJSON(&input) != nil {
		c.JSON(400, gin.H{"error": "参数校验失败"})
		return
	}
	window, ok := validateRule(c, input, true)
	if !ok {
		return
	}
	var dataset data.Dataset
	if err := s.DB.WithContext(c.Request.Context()).Select("id").First(&dataset, input.DatasetID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(404, gin.H{"error": "数据集不存在"})
		} else {
			c.JSON(500, gin.H{"error": "服务器内部错误"})
		}
		return
	}
	rule := data.AlertRule{DatasetID: input.DatasetID, Type: *input.Type, Threshold: *input.Threshold, WindowMin: window, Enabled: true}
	if input.Keyword != nil {
		rule.Keyword = *input.Keyword
	}
	if input.Enabled != nil {
		rule.Enabled = *input.Enabled
	}
	if err := s.DB.WithContext(c.Request.Context()).Create(&rule).Error; err != nil {
		c.JSON(500, gin.H{"error": "服务器内部错误"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": strconv.FormatUint(rule.ID, 10)})
}

func (s Server) updateRule(c *gin.Context) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	var input ruleInput
	if c.ShouldBindJSON(&input) != nil {
		c.JSON(400, gin.H{"error": "参数校验失败"})
		return
	}
	window, ok := validateRule(c, input, false)
	if !ok {
		return
	}
	var rule data.AlertRule
	if err := s.DB.WithContext(c.Request.Context()).First(&rule, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(404, gin.H{"error": "规则不存在"})
		} else {
			c.JSON(500, gin.H{"error": "服务器内部错误"})
		}
		return
	}
	changes := map[string]any{}
	if input.Type != nil {
		changes["type"] = *input.Type
	}
	if input.Threshold != nil {
		changes["threshold"] = *input.Threshold
	}
	if input.Keyword != nil {
		changes["keyword"] = *input.Keyword
	}
	if len(input.WindowMin) > 0 {
		changes["windowMin"] = window
	}
	if input.Enabled != nil {
		changes["enabled"] = *input.Enabled
	}
	if err := s.DB.WithContext(c.Request.Context()).Model(&rule).Updates(changes).Error; err != nil {
		c.JSON(500, gin.H{"error": "服务器内部错误"})
		return
	}
	c.JSON(200, gin.H{"ok": true})
}

func (s Server) deleteRule(c *gin.Context) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	var rule data.AlertRule
	if err := s.DB.WithContext(c.Request.Context()).Select("id").First(&rule, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(404, gin.H{"error": "规则不存在"})
		} else {
			c.JSON(500, gin.H{"error": "服务器内部错误"})
		}
		return
	}
	if err := s.DB.WithContext(c.Request.Context()).Delete(&rule).Error; err != nil {
		c.JSON(500, gin.H{"error": "服务器内部错误"})
		return
	}
	c.JSON(200, gin.H{"ok": true})
}

func (s Server) ackAlert(c *gin.Context) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	var alert data.Alert
	if err := s.DB.WithContext(c.Request.Context()).Select("id").First(&alert, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(404, gin.H{"error": "告警不存在"})
		} else {
			c.JSON(500, gin.H{"error": "服务器内部错误"})
		}
		return
	}
	if err := s.DB.WithContext(c.Request.Context()).Model(&alert).Update("acknowledged", true).Error; err != nil {
		c.JSON(500, gin.H{"error": "服务器内部错误"})
		return
	}
	c.JSON(200, gin.H{"ok": true})
}
