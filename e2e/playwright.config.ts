import { defineConfig } from '@playwright/test';

// Runs real browser tests with the reporter, to check it end to end.
// scripts/verify-e2e-report.mjs then asserts on the JSON it writes.
export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  retries: 1,
  reporter: [
    ['list'],
    ['../dist/index.js', { outputFile: 'fragility-report.json', htmlFile: 'fragility-report.html' }],
  ],
});
