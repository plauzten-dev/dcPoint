import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173';
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/dcpoint';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 30_000,
  use: { baseURL, trace: 'off', viewport: { width: 1440, height: 860 } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 860 } } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: 'cargo run --release',
          cwd: '../server',
          url: 'http://127.0.0.1:8080/api/v1/health',
          reuseExistingServer: true,
          timeout: 600_000,
          env: { DATABASE_URL: databaseUrl, AUTH_RATE_LIMIT_PER_MIN: '0', MESSAGE_RATE_LIMIT: '0', BIND_ADDR: '127.0.0.1:8080' },
        },
        {
          // Test the production bundle (what Docker ships), not the dev server.
          command: 'npm run build && npx vite preview --host 127.0.0.1 --port 5173 --strictPort',
          cwd: '../web',
          url: baseURL,
          reuseExistingServer: true,
          timeout: 120_000,
        },
      ],
});
