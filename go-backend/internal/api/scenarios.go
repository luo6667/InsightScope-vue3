package api

import (
	_ "embed"
	"encoding/json"
	"math"
	"math/rand"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"insightscope/go-backend/internal/data"
)

//go:embed scenarios.json
var scenarioJSON []byte

type scenarioSegment struct {
	StartDay int                 `json:"startDay"`
	EndDay   int                 `json:"endDay"`
	Dist     map[string]float64  `json:"dist"`
	Topics   map[string][]string `json:"topics"`
}

type scenarioDef struct {
	ID          string              `json:"id"`
	Name        string              `json:"name"`
	Description string              `json:"description"`
	Days        int                 `json:"days"`
	Count       int                 `json:"count"`
	Segments    []scenarioSegment   `json:"segments"`
	Templates   map[string][]string `json:"templates"`
	Authors     []string            `json:"authors"`
	Platforms   []string            `json:"platforms"`
}

func scenarios() ([]scenarioDef, error) {
	var definitions []scenarioDef
	err := json.Unmarshal(scenarioJSON, &definitions)
	return definitions, err
}

func listScenarios(c *gin.Context) {
	definitions, err := scenarios()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器内部错误"})
		return
	}
	rows := make([]gin.H, 0, len(definitions))
	for _, def := range definitions {
		rows = append(rows, gin.H{"id": def.ID, "name": def.Name, "description": def.Description, "count": def.Count, "days": def.Days})
	}
	c.JSON(http.StatusOK, gin.H{"scenarios": rows})
}

func pick(values []string) string { return values[rand.Intn(len(values))] }

func sample(values []string, count int) []string {
	copyOf := append([]string{}, values...)
	rand.Shuffle(len(copyOf), func(i, j int) { copyOf[i], copyOf[j] = copyOf[j], copyOf[i] })
	if count > len(copyOf) {
		count = len(copyOf)
	}
	return copyOf[:count]
}

var scenarioKeywords = map[string][]string{
	"pos": {"流畅", "好用", "喜欢", "满意", "推荐", "提升", "稳定", "值得"},
	"neu": {"观望", "适应", "一般", "更新", "反馈", "等待", "观望中"},
	"neg": {"闪退", "卡顿", "耗电", "客服差", "失望", "慢", "退款", "不推荐", "太贵", "故障"},
}

func generateScenario(def scenarioDef) []data.Comment {
	start := time.Now().In(time.Local)
	start = time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, start.Location()).AddDate(0, 0, -def.Days+1)
	rows := make([]data.Comment, 0, def.Count)
	totalDays := 0
	for _, seg := range def.Segments {
		totalDays += seg.EndDay - seg.StartDay + 1
	}
	for i := 0; i < def.Count; i++ {
		roll := rand.Intn(totalDays)
		seg := def.Segments[0]
		for _, candidate := range def.Segments {
			roll -= candidate.EndDay - candidate.StartDay + 1
			if roll < 0 {
				seg = candidate
				break
			}
		}
		sentiment := "neg"
		dist := rand.Float64()
		if dist < seg.Dist["pos"] {
			sentiment = "pos"
		} else if dist < seg.Dist["pos"]+seg.Dist["neu"] {
			sentiment = "neu"
		}
		day := seg.StartDay + rand.Intn(seg.EndDay-seg.StartDay+1)
		timestamp := start.AddDate(0, 0, day-1).Add(time.Duration(rand.Intn(24))*time.Hour + time.Duration(rand.Intn(60))*time.Minute)
		score := 0.0
		switch sentiment {
		case "pos":
			score = 0.5 + rand.Float64()*0.5
		case "neu":
			score = (rand.Float64() - 0.5) * 0.4
		case "neg":
			score = -(0.5 + rand.Float64()*0.5)
		}
		rows = append(rows, data.Comment{Content: pick(def.Templates[sentiment]), Author: pick(def.Authors), Platform: pick(def.Platforms), Timestamp: timestamp,
			Sentiment: sentiment, SentimentScore: math.Round(score*100) / 100, Topics: sample(seg.Topics[sentiment], 1+rand.Intn(2)),
			Keywords: sample(scenarioKeywords[sentiment], 2+rand.Intn(2)), Analyzed: true})
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].Timestamp.Before(rows[j].Timestamp) })
	return rows
}

func (s Server) createScenarioDataset(c *gin.Context, body createDatasetBody) {
	definitions, err := scenarios()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器内部错误"})
		return
	}
	var selected *scenarioDef
	for i := range definitions {
		if definitions[i].ID == body.ScenarioID {
			selected = &definitions[i]
			break
		}
	}
	if selected == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "场景不存在"})
		return
	}
	name := body.Name
	if name == "" {
		name = selected.Name
	}
	platform := body.Platform
	if platform == "" {
		platform = "混合来源"
	}
	rows := generateScenario(*selected)
	var dataset data.Dataset
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		dataset = data.Dataset{Name: name, Platform: platform, Type: "builtin", ScenarioID: selected.ID}
		if err := tx.Create(&dataset).Error; err != nil {
			return err
		}
		for i := range rows {
			rows[i].DatasetID = strconv.FormatUint(dataset.ID, 10)
		}
		if err := tx.CreateInBatches(rows, 500).Error; err != nil {
			return err
		}
		if s.StatsRedis != nil {
			return data.BumpDataVersion(tx, strconv.FormatUint(dataset.ID, 10))
		}
		return nil
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器内部错误"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": strconv.FormatUint(dataset.ID, 10), "count": len(rows)})
}
