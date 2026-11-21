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
	ID        uint64 `gorm:"column:id;primaryKey"`
	DatasetID string `gorm:"column:datasetId"`
	Analyzed  bool   `gorm:"column:analyzed"`
}

func (Comment) TableName() string { return "comments" }
