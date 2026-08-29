import { defineConfig, devices } from '@playwright/test';

// Reproducible desktop + mobile viewport smoke test of the primary journey
// (landing -> login/registration -> one core action). Run via:
//   npm run test:e2e:smoke
//
// Points at the already-running dev server (see the "Start application"
// workflow / `npm run dev`) rather than starting a second instance, since
// the app is expected to already be up in this environment. Never submits
// the login/register forms (that would call the real Firebase project) -
// the "core action" exercised here is fully client-side (live password
// strength feedback).
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  timeout: 30_000,
  use: {
    baseURL: process.env.SMOKE_BASE_URL || 'http://localhost:5000',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'Desktop Chrome',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      // Mobile Chrome (Pixel 5) rather than a WebKit device: only the
      // Chromium browser is provisioned in this environment, and this still
      // exercises the real mobile viewport + touch layout.
      name: 'Mobile Chrome (Pixel 5)',
      use: { ...devices['Pixel 5'] },
    },
  ],
});
