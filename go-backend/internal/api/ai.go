package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"insightscope/go-backend/internal/ai"
)

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}
type chatInput struct {
	BaseURL     string        `json:"baseUrl"`
	APIKey      string        `json:"apiKey"`
	Model       string        `json:"model"`
	Messages    []chatMessage `json:"messages"`
	Temperature *float64      `json:"temperature"`
}

func (s Server) streamAI(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 10<<20)
	var input chatInput
	if c.ShouldBindJSON(&input) != nil || len(strings.TrimSpace(input.BaseURL)) > 2048 || len(strings.TrimSpace(input.APIKey)) > 1024 || len(strings.TrimSpace(input.Model)) > 128 || len(input.Messages) < 1 || len(input.Messages) > 50 {
		c.JSON(400, gin.H{"error": "参数校验失败"})
		return
	}
	input.APIKey = strings.Join(strings.Fields(input.APIKey), "")
	input.Model = strings.TrimSpace(input.Model)
	if input.APIKey == "" || input.Model == "" {
		c.JSON(400, gin.H{"error": "参数校验失败"})
		return
	}
	for _, message := range input.Messages {
		if message.Role != "system" && message.Role != "user" && message.Role != "assistant" {
			c.JSON(400, gin.H{"error": "参数校验失败"})
			return
		}
	}
	temperature := 0.7
	if input.Temperature != nil {
		if *input.Temperature < 0 || *input.Temperature > 2 {
			c.JSON(400, gin.H{"error": "参数校验失败"})
			return
		}
		temperature = *input.Temperature
	}
	base, err := ai.PublicBaseURL(input.BaseURL)
	if err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	upstreamBody, _ := json.Marshal(gin.H{"model": input.Model, "messages": input.Messages, "stream": true, "temperature": temperature, "max_tokens": 2000})
	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPost, base+"/chat/completions", bytes.NewReader(upstreamBody))
	if err != nil {
		c.JSON(400, gin.H{"error": "baseUrl格式无效"})
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+input.APIKey)
	client := s.HTTPClient
	if client == nil {
		client = ai.NewPublicClient()
	}
	res, err := client.Do(req)
	if err != nil {
		c.JSON(502, gin.H{"error": "无法连接 AI 服务，请检查 Base URL"})
		return
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		content, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
		contentType := res.Header.Get("Content-Type")
		if contentType == "" {
			contentType = "application/json"
		}
		c.Data(res.StatusCode, contentType, content)
		return
	}
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Status(200)
	c.Writer.Flush()
	buf := make([]byte, 4096)
	for {
		n, err := res.Body.Read(buf)
		if n > 0 {
			if _, writeErr := c.Writer.Write(buf[:n]); writeErr != nil {
				return
			}
			c.Writer.Flush()
		}
		if err != nil {
			return
		}
	}
}
