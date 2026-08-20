import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3107";
const webServer = process.env.PLAYWRIGHT_BASE_URL
  ? undefined
  : {
      command: "npm run build && npm run start -- --port 3107",
      url: baseURL,
      reuseExistingServer: false,
      timeout: 120_000,
    };

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: {
    timeout: 45_000,
  },
  workers: 1,
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
