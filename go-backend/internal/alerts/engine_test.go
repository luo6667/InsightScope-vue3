package alerts

import (
	"context"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"

	"insightscope/go-backend/internal/data"
)

func TestVolumeRuleCreatesAlertOnlyOutsideCooldown(t *testing.T) {
	sqlDB, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	db, err := gorm.Open(mysql.New(mysql.Config{Conn: sqlDB, SkipInitializeWithVersion: true}), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectQuery("SELECT .* FROM `alert_rules`").WillReturnRows(sqlmock.NewRows([]string{"id", "datasetId", "type", "threshold", "windowMin", "enabled"}).AddRow(1, "8", "volume", 2, 10, true))
	mock.ExpectQuery("SELECT .* FROM `comments`").WillReturnRows(sqlmock.NewRows([]string{"id", "sentiment"}))
	mock.ExpectQuery("SELECT count.* FROM `comments`").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(3))
	mock.ExpectQuery("SELECT count.* FROM `alerts`").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	mock.ExpectBegin()
	mock.ExpectExec("INSERT INTO `alerts`").WillReturnResult(sqlmock.NewResult(71, 1))
	mock.ExpectCommit()
	if err := (Engine{DB: db}).Check(context.Background(), "8", nil); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAnomalyMessageDetectsPositiveSpikeAndNoFlatBaseline(t *testing.T) {
	rows := make([]data.Comment, 100)
	for i := range rows {
		if i%19 == 0 || i >= 80 {
			rows[i].Sentiment = "neg"
		}
	}
	if message := anomalyMessage(rows); !strings.Contains(message, "负面率异常突增") {
		t.Fatalf("message: %q", message)
	}
	flat := make([]data.Comment, 50)
	if message := anomalyMessage(flat); message != "" {
		t.Fatalf("flat baseline: %q", message)
	}
}

func TestEscapeLikeTreatsKeywordWildcardsAsText(t *testing.T) {
	if got := escapeLike(`a%b_c`); got != `a\%b\_c` {
		t.Fatalf("escaped: %q", got)
	}
}
