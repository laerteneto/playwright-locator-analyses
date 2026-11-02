// Generates the README screenshots from the example project.
// Usage: npm run build && npm run docs:images
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import lib from '../dist/index.js';

const { analyzeFiles, buildReport, formatConsole, formatHtml } = lib;
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const exampleDir = path.join(root, 'example');
const outDir = path.join(root, 'docs', 'images');
fs.mkdirSync(outDir, { recursive: true });

const testsDir = path.join(exampleDir, 'tests');
const files = fs.readdirSync(testsDir).filter((f) => f.endsWith('.spec.ts')).map((f) => path.join(testsDir, f));
const report = buildReport(analyzeFiles(files, { cwd: exampleDir }), { rootDir: exampleDir });

// ANSI colors used by the console formatter -> terminal-like HTML.
const COLORS = { 1: 'font-weight:bold', 2: 'opacity:.7', 31: 'color:#ff6b6b', 32: 'color:#5fd068', 33: 'color:#f5c84c', 35: 'color:#d78cff', 36: 'color:#56c8e8', 90: 'color:#8b949e' };
const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ansiToHtml = (text) =>
  escape(text).replace(/\x1b\[(\d+)m([\s\S]*?)\x1b\[0m/g, (_, code, inner) => `<span style="${COLORS[code] ?? ''}">${inner}</span>`);

const consoleText = formatConsole(report, { color: true, width: 128, top: 10, topLocators: 3 }).trim();
const terminal = `<!DOCTYPE html><html><body style="margin:0;background:#0d1117;padding:24px;display:inline-block">
  <div style="background:#161b22;border:1px solid #30363d;border-radius:10px;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,.4)">
    <div style="padding:10px 14px;background:#21262d;display:flex;gap:8px">
      <span style="width:12px;height:12px;border-radius:50%;background:#ff5f56"></span>
      <span style="width:12px;height:12px;border-radius:50%;background:#ffbd2e"></span>
      <span style="width:12px;height:12px;border-radius:50%;background:#27c93f"></span>
    </div>
    <pre id="term" style="margin:0;padding:16px 20px;color:#e6edf3;font:13px/1.45 Menlo,'SF Mono',Consolas,monospace;white-space:pre"><span style="color:#56c8e8">$</span> npx locator-fragility tests/
${ansiToHtml(consoleText)}</pre>
  </div></body></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1400, height: 900 } });
  await page.setContent(terminal);
  await page.locator('body').screenshot({ path: path.join(outDir, 'console.png') });

  const htmlPage = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1200, height: 1050 }, colorScheme: 'light' });
  await htmlPage.setContent(formatHtml(report));
  await htmlPage.locator('details.test').first().evaluate((d) => { d.open = true; });
  // Crop after the fifth test so the image ends on a clean edge.
  const fifth = await htmlPage.locator('details.test').nth(4).boundingBox();
  await htmlPage.screenshot({
    path: path.join(outDir, 'html-report.png'),
    fullPage: true,
    clip: { x: 0, y: 0, width: 1200, height: Math.ceil(fifth.y + fifth.height + 4) },
  });
} finally {
  await browser.close();
}
console.log(`Screenshots written to ${path.relative(root, outDir)}/`);
