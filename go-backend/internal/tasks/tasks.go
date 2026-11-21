package tasks

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"time"

	"github.com/hibiken/asynq"
)

const AnalysisType = "analysis:run"
const FeedType = "feed:pull"

type AnalysisPayload struct {
	JobID uint64 `json:"jobId"`
}
type FeedPayload struct {
	DatasetID uint64 `json:"datasetId"`
}

func Analysis(jobID uint64) (*asynq.Task, error) {
	if jobID == 0 {
		return nil, errors.New("job ID is required")
	}
	data, err := json.Marshal(AnalysisPayload{JobID: jobID})
	if err != nil {
		return nil, err
	}
	return asynq.NewTask(AnalysisType, data), nil
}

func Feed(datasetID uint64) (*asynq.Task, error) {
	if datasetID == 0 {
		return nil, errors.New("dataset ID is required")
	}
	data, err := json.Marshal(FeedPayload{DatasetID: datasetID})
	if err != nil {
		return nil, err
	}
	return asynq.NewTask(FeedType, data), nil
}

type Enqueuer interface {
	EnqueueAnalysis(context.Context, uint64) error
}

type FeedEnqueuer interface {
	EnqueueFeed(context.Context, uint64) error
}

type Client struct{ Queue *asynq.Client }

func (c Client) EnqueueAnalysis(ctx context.Context, jobID uint64) error {
	task, err := Analysis(jobID)
	if err != nil {
		return err
	}
	_, err = c.Queue.EnqueueContext(ctx, task, asynq.Queue("analysis"), asynq.MaxRetry(3), asynq.TaskID("analysis-"+strconv.FormatUint(jobID, 10)))
	if errors.Is(err, asynq.ErrTaskIDConflict) {
		return nil
	}
	return err
}

func (c Client) EnqueueFeed(ctx context.Context, datasetID uint64) error {
	task, err := Feed(datasetID)
	if err != nil {
		return err
	}
	_, err = c.Queue.EnqueueContext(ctx, task, asynq.Queue("feed"), asynq.MaxRetry(3), asynq.Unique(55*time.Second))
	if errors.Is(err, asynq.ErrDuplicateTask) {
		return nil
	}
	return err
}
