package analysis

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strconv"
	"time"

	"github.com/hibiken/asynq"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"insightscope/go-backend/internal/data"
	"insightscope/go-backend/internal/tasks"
)

type EventPublisher interface {
	Publish(context.Context, string, string, any) error
}

type Worker struct {
	DB          *gorm.DB
	Credentials Credentials
	Model       LLM
	Events      EventPublisher
	Locks       LockStore
}

func (w Worker) emit(ctx context.Context, job data.AnalysisJob, status string) {
	if w.Events == nil {
		return
	}
	payload := map[string]any{"jobId": strconv.FormatUint(job.ID, 10), "status": status, "processed": job.Processed, "total": job.Total, "failed": job.Failed}
	if err := w.Events.Publish(ctx, job.DatasetID, "analysis:progress", payload); err != nil {
		log.Printf("[analysis] progress event failed for job %d: %v", job.ID, err)
	}
}

func (w Worker) loadJob(ctx context.Context, id uint64) (data.AnalysisJob, error) {
	var job data.AnalysisJob
	err := w.DB.WithContext(ctx).First(&job, id).Error
	return job, err
}

func (w Worker) finish(ctx context.Context, id uint64, status string) error {
	var finished data.AnalysisJob
	err := w.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&finished, id).Error; err != nil {
			return err
		}
		if finished.Status != "running" && finished.Status != "pending" {
			return nil
		}
		var remaining int64
		if err := tx.Model(&data.Comment{}).Where("datasetId = ? AND analyzed = ?", finished.DatasetID, false).Count(&remaining).Error; err != nil {
			return err
		}
		finished.Failed = int(remaining)
		finished.Status = status
		if err := tx.Model(&finished).Updates(map[string]any{"status": status, "failed": finished.Failed}).Error; err != nil {
			return err
		}
		return tx.Where("jobId = ?", id).Delete(&data.AnalysisJobSecret{}).Error
	})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err == nil && finished.Status == status {
		w.emit(ctx, finished, status)
	}
	return err
}

func (w Worker) processBatch(ctx context.Context, id uint64, items []data.Comment, results []*Result) (data.AnalysisJob, error) {
	var job data.AnalysisJob
	err := w.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&job, id).Error; err != nil {
			return err
		}
		if job.Status != "running" {
			return nil
		}
		written := 0
		for i, item := range items {
			if results[i] == nil {
				continue
			}
			result := results[i]
			change := map[string]any{"sentiment": result.Sentiment, "sentimentScore": result.Score, "topics": result.Topics, "keywords": result.Keywords, "analyzed": true}
			updated := tx.Model(&data.Comment{}).Where("id = ? AND datasetId = ? AND analyzed = ?", item.ID, job.DatasetID, false).Updates(change)
			if updated.Error != nil {
				return updated.Error
			}
			written += int(updated.RowsAffected)
		}
		job.Processed += written
		if err := tx.Model(&job).Update("processed", job.Processed).Error; err != nil {
			return err
		}
		return nil
	})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return job, nil
	}
	return job, err
}

func (w Worker) Handle(ctx context.Context, task *asynq.Task) error {
	if task.Type() != tasks.AnalysisType {
		return fmt.Errorf("unexpected task type %q", task.Type())
	}
	var payload tasks.AnalysisPayload
	if err := json.Unmarshal(task.Payload(), &payload); err != nil || payload.JobID == 0 {
		return asynq.SkipRetry
	}
	if w.Locks != nil {
		lease, err := w.Locks.Acquire(ctx, payload.JobID)
		if err != nil {
			return err
		}
		leaseCtx, cancel := context.WithCancel(ctx)
		ctx = leaseCtx
		defer func() {
			cancel()
			releaseCtx, releaseCancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer releaseCancel()
			if err := lease.Release(releaseCtx); err != nil {
				log.Printf("[analysis] lock release failed for job %d: %v", payload.JobID, err)
			}
		}()
		go func() {
			ticker := time.NewTicker(20 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-leaseCtx.Done():
					return
				case <-ticker.C:
					renewCtx, stop := context.WithTimeout(leaseCtx, 3*time.Second)
					valid, err := lease.Renew(renewCtx)
					stop()
					if err != nil || !valid {
						cancel()
						return
					}
				}
			}
		}()
	}
	job, err := w.loadJob(ctx, payload.JobID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if job.Status != "pending" && job.Status != "running" {
		return nil
	}
	var secret data.AnalysisJobSecret
	if err := w.DB.WithContext(ctx).Where("jobId = ?", job.ID).First(&secret).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if finishErr := w.finish(ctx, job.ID, "failed"); finishErr != nil {
				return finishErr
			}
			return asynq.SkipRetry
		}
		return err
	}
	config, err := w.Credentials.Decrypt(job.ID, secret.Nonce, secret.Ciphertext)
	if err != nil {
		if finishErr := w.finish(ctx, job.ID, "failed"); finishErr != nil {
			return finishErr
		}
		return asynq.SkipRetry
	}
	var remaining int64
	if err := w.DB.WithContext(ctx).Model(&data.Comment{}).Where("datasetId = ? AND analyzed = ?", job.DatasetID, false).Count(&remaining).Error; err != nil {
		return err
	}
	updated := w.DB.WithContext(ctx).Model(&data.AnalysisJob{}).Where("id = ? AND status IN ?", job.ID, []string{"pending", "running"}).Updates(map[string]any{"status": "running", "total": job.Processed + int(remaining), "failed": 0})
	if updated.Error != nil {
		return updated.Error
	}
	if updated.RowsAffected == 0 {
		return nil
	}
	job.Status = "running"
	job.Total = job.Processed + int(remaining)
	job.Failed = 0
	lastID := uint64(0)
	failures := 0
	for {
		current, err := w.loadJob(ctx, job.ID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		if current.Status != "running" {
			return nil
		}
		var items []data.Comment
		if err := w.DB.WithContext(ctx).Select("id", "content").Where("datasetId = ? AND analyzed = ? AND id > ?", job.DatasetID, false, lastID).Order("id ASC").Limit(8).Find(&items).Error; err != nil {
			return err
		}
		if len(items) == 0 {
			break
		}
		lastID = items[len(items)-1].ID
		contents := make([]string, len(items))
		for i := range items {
			contents[i] = items[i].Content
		}
		results := w.Model.Analyze(ctx, config, contents)
		for _, result := range results {
			if result == nil {
				failures++
			}
		}
		current, err = w.processBatch(ctx, job.ID, items, results)
		if err != nil {
			return err
		}
		if current.Status != "running" {
			return nil
		}
		w.emit(ctx, current, "running")
	}
	if failures > 0 {
		retry, ok := asynq.GetRetryCount(ctx)
		if ok && retry < 3 {
			return fmt.Errorf("analysis job %d has %d model failures", job.ID, failures)
		}
	}
	return w.finish(ctx, job.ID, "done")
}
