package realtime

import (
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"testing"

	sio "github.com/zishang520/socket.io/servers/socket/v3"
	"github.com/zishang520/socket.io/v3/pkg/types"
)

func TestExistingSocketIOClientCompatibility(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("Node.js is needed for the existing client compatibility test")
	}
	if _, err := os.Stat("../../../web/node_modules/socket.io-client"); err != nil {
		t.Skip("install web dependencies to run the existing client compatibility test")
	}
	opts := sio.DefaultServerOptions()
	opts.SetCors(&types.Cors{Origin: []string{"http://localhost:5175"}, Methods: []string{"GET", "POST"}})
	server := sio.NewServer(nil, opts)
	server.Use(func(socket *sio.Socket, next func(*sio.ExtendedError)) {
		if socket.Handshake().Auth["token"] != "secret" {
			next(sio.NewExtendedError("unauthorized", nil))
			return
		}
		next(nil)
	})
	_ = server.On("connection", func(clients ...any) {
		socket := clients[0].(*sio.Socket)
		_ = socket.On("join-dataset", func(args ...any) {
			datasetID := args[0].(string)
			socket.Join(sio.Room("dataset:" + datasetID))
			_ = socket.Emit("joined")
		})
		_ = socket.On("leave-dataset", func(args ...any) {
			datasetID := args[0].(string)
			socket.Leave(sio.Room("dataset:" + datasetID))
			_ = socket.Emit("left")
		})
		_ = socket.On("trigger", func(_ ...any) {
			server.To(sio.Room("dataset:8")).Emit("analysis:progress", map[string]string{"datasetId": "8"})
		})
	})
	mux := http.NewServeMux()
	mux.Handle("/socket.io/", server.ServeHandler(nil))
	httpServer := httptest.NewServer(mux)
	defer httpServer.Close()
	defer server.Close(nil)
	cmd := exec.Command("node", "testdata/socket-client.cjs", httpServer.URL)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("socket.io-client 4.x failed: %v\n%s", err, output)
	}
}
