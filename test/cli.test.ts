import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

// Runs the compiled CLI (npm test builds first via "pretest").
const root = path.join(__dirname, '..');
const cli = path.join(root, 'dist', 'cli.js');
const run = (...args: string[]) =>
  spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });

describe('cli', () => {
  it('prints help', () => {
    const r = run('--help');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Usage: locator-fragility');
  });

  it('ranks the example tests', () => {
    const r = run('example/tests');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Tests most likely to break');
    expect(r.stdout).toContain('Checkout › applies a discount coupon');
    expect(r.stdout).toContain('Locators most worth fixing');
  });

  it('exits with 1 when a test reaches --fail-on-risk', () => {
    const r = run('example/tests', '--quiet', '--fail-on-risk', '90');
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('Failing because of failOnRisk');
    expect(run('example/tests', '--quiet', '--fail-on-risk', '101').status).toBe(0);
  });

  it('writes JSON and HTML reports', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'locator-fragility-'));
    const json = path.join(dir, 'report.json');
    const html = path.join(dir, 'report.html');
    expect(run('example/tests', '--quiet', '--json', json, '--html', html).status).toBe(0);
    const report = JSON.parse(fs.readFileSync(json, 'utf8'));
    expect(report.tests).toHaveLength(10);
    expect(report.tests[0].file).toBe('example/tests/checkout.spec.ts');
    expect(fs.readFileSync(html, 'utf8')).toContain('<h1>Locator fragility</h1>');
  });

  it('exits with 2 when there are no test files', () => {
    const r = run('src');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('No test files found.');
  });
});
