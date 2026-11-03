import path from 'path';
import { describe, expect, it } from 'vitest';
import { analyzeFiles } from '../src/analyzer';
import { buildReport, testRisk } from '../src/report';

const fixture = path.join(__dirname, 'fixtures', 'cart.spec.ts');
const tests = analyzeFiles([fixture], { cwd: path.join(__dirname, '..') });
const byTitle = (t: string) => tests.find((x) => x.title === t)!;
const codes = (t: string) => byTitle(t).uses.map((u) => u.code);

describe('analyzeFiles', () => {
  it('finds tests with describe title paths', () => {
    expect(tests.map((t) => t.titlePath.join(' > '))).toEqual([
      'Cart > checkout via page object',
      'Cart > robust test',
      'Cart > nested > uses getter and constant',
      'outside describe has no hook',
    ]);
    expect(byTitle('checkout via page object').line).toBe(9);
  });

  it('applies beforeEach hooks of enclosing describes', () => {
    expect(codes('robust test')).toContain("page.locator('xpath=/html/body/div[3]/button')");
    expect(codes('uses getter and constant')).toContain("page.locator('xpath=/html/body/div[3]/button')");
    expect(codes('outside describe has no hook')).toEqual(["page.getByTestId('ok')"]);
  });

  it('follows page object methods and constructor-assigned locators', () => {
    const use = byTitle('checkout via page object').uses.find((u) => u.file.endsWith('cart.page.ts'))!;
    expect(use.code).toContain('#app > div:nth-child(2)');
    expect(use.grade).toBe('F');
  });

  it('resolves getters, inherited chains and constants', () => {
    const c = codes('uses getter and constant');
    expect(c).toContain("this.list.getByRole('listitem').first()");
    // The base `this.page.getByTestId('cart-list')` is folded into the derived locator.
    expect(c).not.toContain("this.page.getByTestId('cart-list')");
    expect(c).toContain('this.page.locator(SELECTORS.promo)');
    const promo = byTitle('uses getter and constant').uses.find((u) => u.code.includes('SELECTORS'))!;
    expect(promo.findings.some((f) => f.message.includes('.promo-banner'))).toBe(true);
  });

  it('honours the ignore comment', () => {
    expect(codes('uses getter and constant').some((c) => c.includes('btn-legacy'))).toBe(false);
  });

  it('ranks fragile tests first', () => {
    const report = buildReport(tests);
    const rank = (t: string) => report.tests.findIndex((x) => x.title === t);
    expect(rank('checkout via page object')).toBeLessThan(rank('robust test'));
    expect(rank('uses getter and constant')).toBeLessThan(rank('robust test'));
    expect(report.tests.at(-1)!.title).toBe('outside describe has no hook');
    expect(report.hotspots[0].tests).toBe(3); // the beforeEach XPath affects 3 tests
  });
});

describe('testRisk', () => {
  const u = (score: number) => ({ score }) as never;
  it('is ~0 for robust locators and high for a single F', () => {
    expect(testRisk([u(5), u(5), u(10)])).toBeLessThan(2);
    expect(testRisk([u(90)])).toBeGreaterThan(80);
    expect(testRisk([])).toBe(0);
  });
});

describe('page objects with constructor assignments', () => {
  it('resolves locators and selectors assigned in a JavaScript constructor', () => {
    const [test] = analyzeFiles([path.join(__dirname, 'fixtures', 'login.spec.js')], { cwd: path.join(__dirname, '..') });
    expect(test.uses.map((u) => [u.code, u.score])).toEqual([
      ["page.locator('form > div:nth-child(3) > button')", 100],
      ['this.page.fill(this.emailInput, email)', 30], // #email (20) + legacy API (10)
    ]);
  });

  it('resolves selector strings assigned in a TypeScript constructor', () => {
    const [test] = analyzeFiles([path.join(__dirname, 'fixtures', 'search.spec.ts')], { cwd: path.join(__dirname, '..') });
    const [use] = test.uses;
    expect(use.code).toBe('this.page.locator(this.queryInput)');
    expect(use.findings.some((f) => f.message.includes('.search-box'))).toBe(true);
  });
});

describe('JavaScript projects', () => {
  it('follows import aliases from the nearest jsconfig.json', () => {
    const dir = path.join(__dirname, 'fixtures', 'js-project');
    const [test] = analyzeFiles([path.join(dir, 'checkout.spec.js')], { cwd: dir });
    expect(test.uses.map((u) => [u.code, u.grade])).toEqual([["page.locator('.css-1x2y3z')", 'F']]);
  });
});
