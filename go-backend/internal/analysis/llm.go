package analysis

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"time"

	"insightscope/go-backend/internal/ai"
)

const systemPrompt = `你是用户评论分析师。给定一个评论列表（每行编号），为每条评论输出分析结果，整体输出一个 JSON 数组：
[{"sentiment":"pos|neu|neg","sentimentScore":-1到1的小数,"topics":["1-2个主题词"],"keywords":["2-4个关键词"]},...]
硬性要求：
1. 数组顺序必须与评论列表顺序一致，数量相同
2. 只输出 JSON 数组，禁止 markdown 代码块、禁止解释文字
3. 主题如"性能/价格/客服/界面/闪退/耗电/物流/质量"等`

type Result struct {
	Sentiment string
	Score     float64
	Topics    []string
	Keywords  []string
}

type LLM struct{ Client *http.Client }

func (l LLM) client() *http.Client {
	if l.Client != nil {
		return l.Client
	}
	return ai.NewPublicClient()
}

func parseResults(raw string) ([]map[string]any, error) {
	clean := strings.TrimSpace(raw)
	clean = strings.TrimPrefix(clean, "```json")
	clean = strings.TrimPrefix(clean, "```")
	clean = strings.TrimSuffix(clean, "```")
	clean = strings.TrimSpace(clean)
	var values []map[string]any
	if json.Unmarshal([]byte(clean), &values) == nil {
		return values, nil
	}
	start, end := strings.Index(clean, "["), strings.LastIndex(clean, "]")
	if start >= 0 && end > start && json.Unmarshal([]byte(clean[start:end+1]), &values) == nil {
		return values, nil
	}
	var one map[string]any
	if json.Unmarshal([]byte(clean), &one) == nil {
		return []map[string]any{one}, nil
	}
	return nil, errors.New("解析失败")
}

func stringsOf(value any, max int) []string {
	array, ok := value.([]any)
	if !ok {
		return []string{}
	}
	result := make([]string, 0, min(len(array), max))
	for _, item := range array {
		stringValue, ok := item.(string)
		if ok && strings.TrimSpace(stringValue) != "" {
			result = append(result, strings.TrimSpace(stringValue))
			if len(result) == max {
				break
			}
		}
	}
	return result
}

func normalizeResult(raw map[string]any) Result {
	sentiment, _ := raw["sentiment"].(string)
	if sentiment != "pos" && sentiment != "neu" && sentiment != "neg" {
		sentiment = "neu"
	}
	score, ok := raw["sentimentScore"].(float64)
	if !ok || math.IsNaN(score) || math.IsInf(score, 0) {
		switch sentiment {
		case "pos":
			score = 0.7
		case "neg":
			score = -0.7
		default:
			score = 0
		}
	}
	score = math.Max(-1, math.Min(1, score))
	score = math.Round(score*100) / 100
	return Result{Sentiment: sentiment, Score: score, Topics: stringsOf(raw["topics"], 3), Keywords: stringsOf(raw["keywords"], 5)}
}

func (l LLM) request(ctx context.Context, config AIConfig, contents []string) ([]*Result, error) {
	list := make([]string, len(contents))
	for i, content := range contents {
		limit := 200
		if len(contents) == 1 {
			limit = 500
		}
		chars := []rune(content)
		if len(chars) > limit {
			chars = chars[:limit]
		}
		list[i] = fmt.Sprintf("%d. %s", i+1, string(chars))
	}
	maxTokens := 1100
	timeout := 30 * time.Second
	if len(contents) == 1 {
		maxTokens = 300
		timeout = 20 * time.Second
	}
	body := map[string]any{"model": config.Model, "messages": []map[string]string{{"role": "system", "content": systemPrompt}, {"role": "user", "content": "评论列表：\n" + strings.Join(list, "\n")}}, "temperature": config.Temperature, "max_tokens": maxTokens, "stream": false}
	encoded, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(config.BaseURL, "/")+"/chat/completions", bytes.NewReader(encoded))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+strings.Join(strings.Fields(config.APIKey), ""))
	req.Header.Set("Content-Type", "application/json")
	response, err := l.client().Do(req)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("模型服务返回 HTTP %d", response.StatusCode)
	}
	var reply struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 2<<20)).Decode(&reply); err != nil {
		return nil, err
	}
	if len(reply.Choices) == 0 {
		return nil, errors.New("模型未返回结果")
	}
	values, err := parseResults(reply.Choices[0].Message.Content)
	if err != nil {
		return nil, err
	}
	results := make([]*Result, 0, len(values))
	for _, value := range values {
		if value == nil {
			results = append(results, nil)
		} else {
			result := normalizeResult(value)
			results = append(results, &result)
		}
	}
	return results, nil
}

// Analyze uses one batched request and retries missing or invalid results one comment at a time.
func (l LLM) Analyze(ctx context.Context, config AIConfig, contents []string) []*Result {
	results := make([]*Result, len(contents))
	if len(contents) == 0 {
		return results
	}
	if len(contents) > 1 {
		batch, err := l.request(ctx, config, contents)
		if err == nil {
			for i := range results {
				if i < len(batch) {
					results[i] = batch[i]
				}
			}
		}
	}
	for i := range results {
		if results[i] != nil {
			continue
		}
		one, err := l.request(ctx, config, []string{contents[i]})
		if err == nil && len(one) > 0 {
			results[i] = one[0]
		}
	}
	return results
}
