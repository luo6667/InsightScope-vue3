package api

import (
	"context"
	"log"
	"time"

	"insightscope/go-backend/internal/data"
)

// RunFeedScheduler resumes running feeds after an API restart and checks due feeds each minute.
// The Redis lock in fetchFeed prevents overlapping pulls across API instances and manual requests.
func (s Server) RunFeedScheduler(ctx context.Context) {
	lastAttempt := make(map[uint64]time.Time)
	check := func() {
		var datasets []data.Dataset
		if err := s.DB.WithContext(ctx).Where("feedRunning = ?", true).Find(&datasets).Error; err != nil {
			log.Printf("[feed] scheduler query: %v", err)
			return
		}
		now := time.Now().UTC()
		for _, ds := range datasets {
			if ds.FeedURL == "" {
				if err := s.DB.WithContext(ctx).Model(&ds).Update("feedRunning", false).Error; err != nil {
					log.Printf("[feed] stop invalid dataset %d: %v", ds.ID, err)
				}
				continue
			}
			if !feedReady(ds, lastAttempt[ds.ID], now) {
				continue
			}
			lastAttempt[ds.ID] = now
			go func(id uint64) {
				pullCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
				defer cancel()
				if _, _, err := s.fetchFeed(pullCtx, id); err != nil {
					log.Printf("[feed] scheduled pull %d: %v", id, err)
				}
			}(ds.ID)
		}
	}
	check()
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			check()
		}
	}
}

func feedReady(ds data.Dataset, lastAttempt, now time.Time) bool {
	interval := ds.FeedIntervalMin
	if interval < 1 {
		interval = 5
	}
	if interval > 1440 {
		interval = 1440
	}
	window := time.Duration(interval) * time.Minute
	if !lastAttempt.IsZero() && now.Sub(lastAttempt) < window {
		return false
	}
	if ds.FeedLastAt != nil && now.Sub(*ds.FeedLastAt) < window {
		return false
	}
	return true
}
