package config

import (
	"errors"
	"strconv"
	"strings"
)

func CheckProduction(getenv func(string) string) error {
	if getenv("NODE_ENV") != "production" && getenv("GO_ENV") != "production" {
		return nil
	}
	var problems []string
	if password := getenv("MYSQL_PASSWORD"); password == "" || password == "1234" {
		problems = append(problems, "MYSQL_PASSWORD 必须显式设置（禁止使用默认密码 1234）")
	}
	if strings.TrimSpace(getenv("CORS_ORIGIN")) == "" {
		problems = append(problems, "CORS_ORIGIN 必须设置")
	}
	limit, err := strconv.Atoi(getenv("RATE_LIMIT_PER_MIN"))
	if err != nil || limit <= 0 {
		problems = append(problems, "RATE_LIMIT_PER_MIN 必须大于 0")
	}
	if token := strings.TrimSpace(getenv("ACCESS_TOKEN")); len(token) < 16 {
		problems = append(problems, "ACCESS_TOKEN 长度必须至少 16 位")
	}
	if len(problems) > 0 {
		return errors.New(strings.Join(problems, "; "))
	}
	return nil
}
