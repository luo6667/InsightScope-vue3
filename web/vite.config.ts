import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5175,
    proxy: {
      "/api": { target: "http://localhost:5176", changeOrigin: true },
      "/socket.io": { target: "http://localhost:5176", ws: true },
    },
  },
});
