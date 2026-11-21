package realtime

import (
	"crypto/subtle"
	"errors"
	"strconv"
	"strings"

	sio "github.com/zishang520/socket.io/servers/socket/v3"
	"github.com/zishang520/socket.io/v3/pkg/types"
	"gorm.io/gorm"

	"insightscope/go-backend/internal/data"
)

// NewServer keeps the existing Socket.IO protocol, token handshake, and dataset rooms.
func NewServer(db *gorm.DB, accessToken string, origins []string) *sio.Server {
	options := sio.DefaultServerOptions()
	options.SetCors(&types.Cors{Origin: origins, Methods: []string{"GET", "POST"}})
	server := sio.NewServer(nil, options)
	server.Use(func(client *sio.Socket, next func(*sio.ExtendedError)) {
		if accessToken != "" {
			candidate, _ := client.Handshake().Auth["token"].(string)
			if subtle.ConstantTimeCompare([]byte(candidate), []byte(accessToken)) != 1 {
				next(sio.NewExtendedError("unauthorized", nil))
				return
			}
		}
		next(nil)
	})
	_ = server.On("connection", func(args ...any) {
		client := args[0].(*sio.Socket)
		_ = client.On("join-dataset", func(values ...any) {
			if len(values) == 0 {
				return
			}
			datasetID, ok := values[0].(string)
			if !ok {
				return
			}
			id, err := strconv.ParseUint(datasetID, 10, 64)
			if err != nil || strings.TrimSpace(datasetID) == "" {
				_ = client.Emit("join-error", map[string]string{"datasetId": datasetID, "error": "无效的数据集 id"})
				return
			}
			var dataset data.Dataset
			if err := db.Select("id").First(&dataset, id).Error; err != nil {
				message := "无效的数据集 id"
				if errors.Is(err, gorm.ErrRecordNotFound) {
					message = "数据集不存在"
				}
				_ = client.Emit("join-error", map[string]string{"datasetId": datasetID, "error": message})
				return
			}
			client.Join(sio.Room("dataset:" + datasetID))
		})
		_ = client.On("leave-dataset", func(values ...any) {
			if len(values) == 0 {
				return
			}
			datasetID, ok := values[0].(string)
			if ok {
				client.Leave(sio.Room("dataset:" + datasetID))
			}
		})
	})
	return server
}
