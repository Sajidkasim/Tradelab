import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:8111",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: `${process.env.PRIMUSLAB_TEST_PYTHON || "../.venv/bin/python"} ../tools/run_site_preview.py 8119`,
      url: "http://127.0.0.1:8119/health",
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: `${process.env.PRIMUSLAB_TEST_PYTHON || "../.venv/bin/python"} ../tools/run_web_google_tests.py`,
      url: "http://127.0.0.1:8114/health",
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: `${process.env.PRIMUSLAB_TEST_PYTHON || "../.venv/bin/python"} ../tools/run_web_tests.py`,
      url: "http://127.0.0.1:8111/health",
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: `${process.env.PRIMUSLAB_TEST_PYTHON || "../.venv/bin/python"} ../tools/run_web_password_tests.py`,
      url: "http://127.0.0.1:8112/health",
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});
