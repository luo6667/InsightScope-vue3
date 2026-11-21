package tasks

import (
	"context"
	"fmt"

	"gorm.io/gorm"

	"insightscope/go-backend/internal/data"
)

// Recover uses MySQL as the source of truth after an API crash between commit and enqueue.
// It also removes secrets for terminal or deleted jobs.
func Recover(ctx context.Context, db *gorm.DB, queue Enqueuer) error {
	active := db.Model(&data.AnalysisJob{}).Select("id").Where("status IN ?", []string{"pending", "running", "paused"})
	if err := db.WithContext(ctx).Where("jobId NOT IN (?)", active).Delete(&data.AnalysisJobSecret{}).Error; err != nil {
		return err
	}
	var jobs []data.AnalysisJob
	if err := db.WithContext(ctx).Model(&data.AnalysisJob{}).
		Select("analysis_jobs.id").Joins("JOIN analysis_job_secrets ON analysis_job_secrets.jobId = analysis_jobs.id").
		Where("analysis_jobs.status IN ?", []string{"pending", "running"}).Find(&jobs).Error; err != nil {
		return err
	}
	for _, job := range jobs {
		if err := queue.EnqueueAnalysis(ctx, job.ID); err != nil {
			return fmt.Errorf("requeue analysis job %d: %w", job.ID, err)
		}
	}
	return nil
}
