import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8100",
      "/auth": "http://127.0.0.1:8100",
    },
  },
  build: { chunkSizeWarningLimit: 1200 },
  test: { include: ["src/**/*.test.js"] },
});
