package alerts

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"

	"insightscope/go-backend/internal/data"
)

const window = 20
const cooldown = time.Minute

type Publisher interface {
	Publish(context.Context, string, string, any) error
}

type Engine struct {
	DB     *gorm.DB
	Events Publisher
}

type trigger struct {
	kind, severity, message string
	value                   float64
}

func (e Engine) Check(ctx context.Context, datasetID string, cutoff *time.Time) error {
	var rules []data.AlertRule
	if err := e.DB.WithContext(ctx).Where("datasetId = ? AND enabled = ?", datasetID, true).Find(&rules).Error; err != nil {
		return err
	}
	if len(rules) == 0 {
		return nil
	}
	anchor := time.Now().UTC()
	if cutoff != nil {
		anchor = *cutoff
	}
	query := func() *gorm.DB {
		q := e.DB.WithContext(ctx).Where("datasetId = ?", datasetID)
		if cutoff != nil {
			q = q.Where("timestamp <= ?", anchor)
		}
		return q
	}
	var recent []data.Comment
	if err := query().Order("timestamp DESC").Limit(window).Find(&recent).Error; err != nil {
		return err
	}
	neg := 0
	for _, c := range recent {
		if c.Sentiment == "neg" {
			neg++
		}
	}
	negRate := 0.0
	if len(recent) > 0 {
		negRate = float64(neg) / float64(len(recent))
	}
	triggers := make([]trigger, 0, len(rules)+1)
	if len(recent) >= 5 {
		var all []data.Comment
		if err := query().Select("sentiment").Order("timestamp ASC").Find(&all).Error; err == nil {
			if msg := anomalyMessage(all); msg != "" {
				triggers = append(triggers, trigger{"negativity", "critical", msg, math.Round(negRate * 100)})
			}
		} else {
			log.Printf("[alerts] anomaly scan for %s: %v", datasetID, err)
		}
	}
	for _, rule := range rules {
		switch rule.Type {
		case "negativity":
			if len(recent) >= 5 && negRate >= rule.Threshold/100 {
				triggers = append(triggers, trigger{"negativity", "warning", fmt.Sprintf("负面率超过阈值 %s%%：当前 %.0f%%", formatNumber(rule.Threshold), math.Round(negRate*100)), math.Round(negRate * 100)})
			}
		case "keyword":
			if rule.Keyword == "" {
				continue
			}
			var hit data.Comment
			like := "%" + escapeLike(rule.Keyword) + "%"
			hitQuery := e.DB.WithContext(ctx).Where("datasetId = ? AND content LIKE ?", datasetID, like)
			if cutoff != nil {
				hitQuery = hitQuery.Where("timestamp <= ?", anchor)
			}
			err := hitQuery.Order("timestamp DESC").First(&hit).Error
			if err == nil {
				triggers = append(triggers, trigger{"keyword", "info", fmt.Sprintf("检测到敏感关键词「%s」：%s…", rule.Keyword, truncate(hit.Content, 40)), 1})
			} else if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
		case "volume":
			minutes := rule.WindowMin
			if minutes < 1 {
				minutes = 10
			}
			var count int64
			if err := e.DB.WithContext(ctx).Model(&data.Comment{}).Where("datasetId = ? AND timestamp >= ? AND timestamp <= ?", datasetID, anchor.Add(-time.Duration(minutes)*time.Minute), anchor).Count(&count).Error; err != nil {
				return err
			}
			if float64(count) >= rule.Threshold {
				triggers = append(triggers, trigger{"volume", "warning", fmt.Sprintf("最近 %d 分钟新增评论 %d 条（阈值 %s）", minutes, count, formatNumber(rule.Threshold)), float64(count)})
			}
		}
	}
	cooldowns := map[string]bool{}
	for _, item := range triggers {
		inCooldown, checked := cooldowns[item.kind]
		if !checked {
			var count int64
			if err := e.DB.WithContext(ctx).Model(&data.Alert{}).Where("datasetId = ? AND type = ? AND triggeredAt >= ?", datasetID, item.kind, time.Now().Add(-cooldown)).Count(&count).Error; err != nil {
				return err
			}
			inCooldown = count > 0
			cooldowns[item.kind] = inCooldown
		}
		if inCooldown {
			continue
		}
		alert := data.Alert{DatasetID: datasetID, Type: item.kind, Severity: item.severity, Message: item.message, Value: item.value, TriggeredAt: time.Now().UTC(), Acknowledged: false}
		if err := e.DB.WithContext(ctx).Create(&alert).Error; err != nil {
			return err
		}
		if e.Events != nil {
			payload := map[string]any{"id": strconv.FormatUint(alert.ID, 10), "datasetId": datasetID, "type": alert.Type, "severity": alert.Severity, "message": alert.Message, "value": alert.Value, "triggeredAt": alert.TriggeredAt, "acknowledged": false}
			if err := e.Events.Publish(ctx, datasetID, "alert:new", payload); err != nil {
				log.Printf("[alerts] event for %s: %v", datasetID, err)
			}
		}
	}
	return nil
}

func anomalyMessage(rows []data.Comment) string {
	if len(rows) < 21 {
		return ""
	}
	neg := 0
	seq := make([]float64, 0, (len(rows)+4)/5)
	for i := range rows {
		if rows[i].Sentiment == "neg" {
			neg++
		}
		if i >= window && rows[i-window].Sentiment == "neg" {
			neg--
		}
		if i%5 == 0 {
			denominator := i + 1
			if denominator > window+1 {
				denominator = window + 1
			}
			seq = append(seq, math.Round(float64(neg)/float64(denominator)*100)/100)
		}
	}
	if len(seq) < 5 {
		return ""
	}
	current := seq[len(seq)-1]
	baseline := seq[:len(seq)-1]
	mean := 0.0
	for _, v := range baseline {
		mean += v
	}
	mean /= float64(len(baseline))
	variance := 0.0
	for _, v := range baseline {
		variance += (v - mean) * (v - mean)
	}
	stddev := math.Sqrt(variance / float64(len(baseline)))
	if stddev < 1e-6 {
		return ""
	}
	z := (current - mean) / stddev
	if z < 2 || current <= mean {
		return ""
	}
	return fmt.Sprintf("负面率异常突增：当前 %.0f%%，基线 %.0f%%（Z=%.1f）", math.Round(current*100), math.Round(mean*100), z)
}

func escapeLike(value string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(value)
}
func truncate(value string, limit int) string {
	r := []rune(value)
	if len(r) > limit {
		return string(r[:limit])
	}
	return value
}
func formatNumber(value float64) string { return strconv.FormatFloat(value, 'f', -1, 64) }
