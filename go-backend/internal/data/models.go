package data

import "time"

// Explicit column mappings preserve Sequelize's camelCase MySQL columns.
type Dataset struct {
	ID              uint64     `gorm:"column:id;primaryKey"`
	Name            string     `gorm:"column:name"`
	Platform        string     `gorm:"column:platform"`
	Type            string     `gorm:"column:type"`
	ScenarioID      string     `gorm:"column:scenarioId"`
	FeedURL         string     `gorm:"column:feedUrl"`
	FeedIntervalMin int        `gorm:"column:feedIntervalMin"`
	FeedRunning     bool       `gorm:"column:feedRunning"`
	FeedLastAt      *time.Time `gorm:"column:feedLastAt"`
	FeedLastCount   int        `gorm:"column:feedLastCount"`
	FeedLastError   string     `gorm:"column:feedLastError"`
	CreatedAt       time.Time  `gorm:"column:createdAt"`
	UpdatedAt       time.Time  `gorm:"column:updatedAt"`
}

func (Dataset) TableName() string { return "datasets" }

type Comment struct {
	ID             uint64    `gorm:"column:id;primaryKey"`
	DatasetID      string    `gorm:"column:datasetId"`
	Content        string    `gorm:"column:content"`
	Author         string    `gorm:"column:author"`
	Platform       string    `gorm:"column:platform"`
	Timestamp      time.Time `gorm:"column:timestamp"`
	Sentiment      string    `gorm:"column:sentiment"`
	SentimentScore float64   `gorm:"column:sentimentScore"`
	Topics         []string  `gorm:"column:topics;serializer:json"`
	Keywords       []string  `gorm:"column:keywords;serializer:json"`
	Analyzed       bool      `gorm:"column:analyzed"`
	SourceID       string    `gorm:"column:sourceId"`
	CreatedAt      time.Time `gorm:"column:createdAt"`
	UpdatedAt      time.Time `gorm:"column:updatedAt"`
}

func (Comment) TableName() string { return "comments" }

type AlertRule struct {
	ID        uint64  `gorm:"column:id;primaryKey"`
	DatasetID string  `gorm:"column:datasetId"`
	Type      string  `gorm:"column:type"`
	Threshold float64 `gorm:"column:threshold"`
	Keyword   string  `gorm:"column:keyword"`
	WindowMin int     `gorm:"column:windowMin"`
	Enabled   bool    `gorm:"column:enabled"`
}

func (AlertRule) TableName() string { return "alert_rules" }

type Alert struct {
	ID           uint64    `gorm:"column:id;primaryKey"`
	DatasetID    string    `gorm:"column:datasetId"`
	Type         string    `gorm:"column:type"`
	Severity     string    `gorm:"column:severity"`
	Message      string    `gorm:"column:message"`
	Value        float64   `gorm:"column:value"`
	TriggeredAt  time.Time `gorm:"column:triggeredAt"`
	Acknowledged bool      `gorm:"column:acknowledged"`
}

func (Alert) TableName() string { return "alerts" }
