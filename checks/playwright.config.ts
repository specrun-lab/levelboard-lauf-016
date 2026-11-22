import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  retries: 0,
  timeout: 15000,
  workers: 1,
  reporter: [
    ['list'],
    ['json', { outputFile: '.out/playwright.json' }],
  ],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:8080',
  },
});
