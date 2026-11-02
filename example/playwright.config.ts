import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  reporter: [
    ['list'],
    // In a real project: ['playwright-locator-analyses', { ... }]
    ['../dist/index.js', { htmlFile: 'fragility-report.html', outputFile: 'fragility-report.json', top: 10 }],
  ],
});
