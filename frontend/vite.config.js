import { defineConfig } from "vite";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const require = createRequire(import.meta.url);
const languageFile = "assets/chart-ocr-eng-v1/eng.traineddata.gz";
function chartLanguageAsset() {
  const read = () => readFileSync(require.resolve("@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz"));
  return {
    name: "primus-chart-language",
    generateBundle() {
      this.emitFile({type: "asset", fileName: languageFile, source: read()});
    },
    configureServer(server) {
      server.middlewares.use(`/${languageFile}`, (_request, response) => {
        response.setHeader("Content-Type", "application/gzip");
        response.end(read());
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), chartLanguageAsset()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8100",
      "/auth": "http://127.0.0.1:8100",
    },
  },
  build: { chunkSizeWarningLimit: 1200 },
  test: { include: ["src/**/*.test.js"] },
});
