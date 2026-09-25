import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run build && npm run start -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    // A fresh in-memory database, seeded with the Example course on first
    // request. `next start` runs as production, so Auth.js needs a secret and
    // to trust localhost.
    env: {
      PGLITE_DIR: "memory://",
      DATABASE_URL: "",
      AUTH_SECRET: "e2e-only-secret",
      AUTH_TRUST_HOST: "true",
    },
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
});
