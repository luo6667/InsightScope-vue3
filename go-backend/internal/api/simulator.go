package api

import (
	"context"
	"encoding/json"
	"log"
	"math"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"

	"insightscope/go-backend/internal/alerts"
	"insightscope/go-backend/internal/analysis"
	"insightscope/go-backend/internal/data"
)

type simulation struct {
	index      int
	speed      float64
	generation string
	cancel     context.CancelFunc
}

type Simulator struct {
	DB      *gorm.DB
	Events  analysis.EventPublisher
	Alerts  *alerts.Engine
	Redis   *redis.Client
	mu      sync.Mutex
	running map[uint64]*simulation
}

func (s *Simulator) emit(ctx context.Context, id uint64, name string, payload any) {
	if s.Events == nil {
		return
	}
	if err := s.Events.Publish(ctx, strconv.FormatUint(id, 10), name, payload); err != nil {
		log.Printf("[simulate] event %s for %d: %v", name, id, err)
	}
}

func (s *Simulator) stop(id uint64) error {
	if s.Redis != nil {
		if err := s.Redis.Del(context.Background(), simKey(id)).Err(); err != nil {
			return err
		}
	}
	s.mu.Lock()
	if sim := s.running[id]; sim != nil {
		sim.cancel()
	}
	delete(s.running, id)
	s.mu.Unlock()
	s.emit(context.Background(), id, "sim:status", gin.H{"running": false})
	return nil
}

func (s *Simulator) current(id uint64, sim *simulation) (int, float64, bool) {
	s.mu.Lock()
	if s.running[id] != sim {
		s.mu.Unlock()
		return 0, 0, false
	}
	index, speed := sim.index, sim.speed
	s.mu.Unlock()
	if s.Redis != nil {
		return s.currentRedis(id, sim)
	}
	return index, speed, true
}

func (s *Simulator) advance(id uint64, sim *simulation) bool {
	if s.Redis != nil {
		return s.advanceRedis(id, sim)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.running[id] != sim {
		return false
	}
	sim.index++
	return true
}

func (s *Simulator) discard(id uint64, sim *simulation) {
	s.mu.Lock()
	if s.running[id] == sim {
		delete(s.running, id)
		sim.cancel()
	}
	s.mu.Unlock()
}

func (s *Simulator) run(ctx context.Context, id uint64, sim *simulation) {
	for ctx.Err() == nil {
		index, speed, active := s.current(id, sim)
		if !active {
			s.discard(id, sim)
			return
		}
		var total int64
		if err := s.DB.WithContext(ctx).Model(&data.Comment{}).Where("datasetId = ?", strconv.FormatUint(id, 10)).Count(&total).Error; err != nil {
			log.Printf("[simulate] count %d: %v", id, err)
			return
		}
		if int64(index) >= total {
			s.stopIfCurrent(id, sim)
			return
		}
		var comment data.Comment
		err := s.DB.WithContext(ctx).Where("datasetId = ?", strconv.FormatUint(id, 10)).Order("timestamp ASC").Offset(index).First(&comment).Error
		if err != nil {
			if ctx.Err() == nil {
				log.Printf("[simulate] comment %d: %v", id, err)
			}
			s.stopIfCurrent(id, sim)
			return
		}
		if !s.advance(id, sim) {
			s.discard(id, sim)
			return
		}
		s.emit(ctx, id, "comment:stream", gin.H{"id": strconv.FormatUint(comment.ID, 10), "content": comment.Content, "author": comment.Author, "platform": comment.Platform, "timestamp": comment.Timestamp, "sentiment": comment.Sentiment, "sentimentScore": comment.SentimentScore, "topics": comment.Topics})
		if s.Alerts != nil {
			if err := s.Alerts.Check(ctx, strconv.FormatUint(id, 10), &comment.Timestamp); err != nil && ctx.Err() == nil {
				log.Printf("[simulate] alert check %d: %v", id, err)
			}
		}
		_, speed, active = s.current(id, sim)
		if !active {
			s.discard(id, sim)
			return
		}
		delay := time.Duration(math.Max(30, math.Round(1000/speed))) * time.Millisecond
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

func (s *Simulator) stopIfCurrent(id uint64, sim *simulation) {
	s.mu.Lock()
	if s.running[id] != sim {
		s.mu.Unlock()
		return
	}
	if s.Redis != nil {
		owned, err := s.stopIfCurrentRedis(id, sim)
		if err != nil {
			log.Printf("[simulate] stop Redis state %d: %v", id, err)
		}
		if !owned {
			delete(s.running, id)
			sim.cancel()
			s.mu.Unlock()
			return
		}
	}
	delete(s.running, id)
	sim.cancel()
	s.mu.Unlock()
	s.emit(context.Background(), id, "sim:status", gin.H{"running": false})
}

func simulationSpeed(c *gin.Context) (float64, bool) {
	var body struct {
		Speed json.RawMessage `json:"speed"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(400, gin.H{"error": "参数校验失败"})
		return 0, false
	}
	if len(body.Speed) == 0 {
		return 5, true
	}
	var speed float64
	if json.Unmarshal(body.Speed, &speed) != nil {
		var text string
		if json.Unmarshal(body.Speed, &text) != nil {
			c.JSON(400, gin.H{"error": "参数校验失败"})
			return 0, false
		}
		parsed, err := strconv.ParseFloat(text, 64)
		if err != nil {
			c.JSON(400, gin.H{"error": "参数校验失败"})
			return 0, false
		}
		speed = parsed
	}
	if math.IsNaN(speed) || math.IsInf(speed, 0) || speed < 1 || speed > 20 {
		c.JSON(400, gin.H{"error": "参数校验失败"})
		return 0, false
	}
	return speed, true
}

func (s Server) startSimulation(c *gin.Context) {
	id, ok := feedID(c)
	if !ok {
		return
	}
	speed, ok := simulationSpeed(c)
	if !ok {
		return
	}
	if s.Simulator == nil {
		c.JSON(503, gin.H{"error": "模拟服务暂不可用"})
		return
	}
	var count int64
	if err := s.DB.WithContext(c.Request.Context()).Model(&data.Comment{}).Where("datasetId = ?", strconv.FormatUint(id, 10)).Count(&count).Error; err != nil {
		c.JSON(500, gin.H{"error": "服务器内部错误"})
		return
	}
	if count == 0 {
		c.JSON(400, gin.H{"error": "数据集没有评论"})
		return
	}
	if err := s.Simulator.stop(id); err != nil {
		c.JSON(503, gin.H{"error": "模拟服务暂不可用"})
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	sim := &simulation{speed: speed, cancel: cancel}
	if s.Simulator.Redis != nil {
		generation, err := s.Simulator.startRedis(c.Request.Context(), id, speed)
		if err != nil {
			cancel()
			c.JSON(503, gin.H{"error": "模拟服务暂不可用"})
			return
		}
		sim.generation = generation
	}
	s.Simulator.mu.Lock()
	if s.Simulator.running == nil {
		s.Simulator.running = map[uint64]*simulation{}
	}
	s.Simulator.running[id] = sim
	s.Simulator.mu.Unlock()
	s.Simulator.emit(c.Request.Context(), id, "sim:status", gin.H{"running": true, "speed": speed, "total": count})
	go s.Simulator.run(ctx, id, sim)
	c.JSON(http.StatusOK, gin.H{"ok": true, "total": count, "speed": speed})
}

func (s Server) stopSimulation(c *gin.Context) {
	id, ok := feedID(c)
	if !ok {
		return
	}
	if s.Simulator != nil {
		if err := s.Simulator.stop(id); err != nil {
			c.JSON(503, gin.H{"error": "模拟服务暂不可用"})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (s Server) changeSimulationSpeed(c *gin.Context) {
	id, ok := feedID(c)
	if !ok {
		return
	}
	speed, ok := simulationSpeed(c)
	if !ok {
		return
	}
	if s.Simulator == nil {
		c.JSON(404, gin.H{"error": "模拟未在运行"})
		return
	}
	if s.Simulator.Redis != nil {
		exists, err := s.Simulator.changeSpeedRedis(c.Request.Context(), id, speed)
		if err != nil {
			c.JSON(503, gin.H{"error": "模拟服务暂不可用"})
			return
		}
		if !exists {
			c.JSON(404, gin.H{"error": "模拟未在运行"})
			return
		}
		s.Simulator.mu.Lock()
		if sim := s.Simulator.running[id]; sim != nil {
			sim.speed = speed
		}
		s.Simulator.mu.Unlock()
		c.JSON(http.StatusOK, gin.H{"ok": true, "speed": speed})
		return
	}
	s.Simulator.mu.Lock()
	sim := s.Simulator.running[id]
	if sim != nil {
		sim.speed = speed
	}
	s.Simulator.mu.Unlock()
	if sim == nil {
		c.JSON(404, gin.H{"error": "模拟未在运行"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "speed": speed})
}
