package migrations

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"strings"
)

//go:embed sql/*.sql
var scripts embed.FS

func Apply(ctx context.Context, db *sql.DB) error {
	conn, err := db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	var locked int
	if err := conn.QueryRowContext(ctx, "SELECT GET_LOCK('insightscope_go_migrate', 30)").Scan(&locked); err != nil {
		return err
	}
	if locked != 1 {
		return errors.New("could not acquire migration lock")
	}
	defer conn.ExecContext(context.Background(), "SELECT RELEASE_LOCK('insightscope_go_migrate')")
	if _, err := conn.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(128) NOT NULL PRIMARY KEY,
      appliedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); err != nil {
		return err
	}
	entries, err := fs.Glob(scripts, "sql/*.sql")
	if err != nil {
		return err
	}
	for _, name := range entries {
		version := strings.TrimPrefix(name, "sql/")
		var exists int
		if err := conn.QueryRowContext(ctx, "SELECT COUNT(*) FROM schema_migrations WHERE version = ?", version).Scan(&exists); err != nil {
			return err
		}
		if exists != 0 {
			continue
		}
		statement, err := scripts.ReadFile(name)
		if err != nil {
			return err
		}
		if _, err := conn.ExecContext(ctx, string(statement)); err != nil {
			return fmt.Errorf("migration %s: %w", version, err)
		}
		if _, err := conn.ExecContext(ctx, "INSERT INTO schema_migrations (version) VALUES (?)", version); err != nil {
			return fmt.Errorf("record migration %s: %w", version, err)
		}
	}
	return nil
}
