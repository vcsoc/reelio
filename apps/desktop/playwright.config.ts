import { defineConfig } from "@playwright/test";
const port = Number(process.env.REELIO_E2E_PORT || 1420);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid REELIO_E2E_PORT");
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL,
    headless: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 960 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
  ],
});
