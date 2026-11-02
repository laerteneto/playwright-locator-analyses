import { describe, expect, it } from 'vitest';
import { ScoreContext, gradeOf } from '../src/rules';
import { classifyClass, isGeneratedId, scoreSelector } from '../src/selector';

const ctx = new ScoreContext();
const score = (s: string) => scoreSelector(s, ctx).score;

describe('scoreSelector', () => {
  it('rates test-id attributes as robust', () => {
    expect(gradeOf(score('[data-testid="login"]'))).toBe('A');
    expect(gradeOf(score('data-testid=login'))).toBe('A');
    expect(gradeOf(score('button[data-cy=save]'))).toBe('A');
  });

  it('rates role= and text= engines', () => {
    expect(gradeOf(score('role=button[name="Save"]'))).toBe('A');
    expect(gradeOf(score('text=Sign in'))).toBe('B');
  });

  it('rates generated classes and ids as fragile', () => {
    expect(gradeOf(score('.css-1x2y3z'))).toBe('F');
    expect(gradeOf(score('.Button_primary__a1B2c'))).toBe('F');
    expect(gradeOf(score('#\\:r1\\:'))).toBe('F');
    expect(gradeOf(score('#submit'))).toBe('B');
  });

  it('penalizes nth-child and depth', () => {
    expect(score('ul li:nth-child(3)')).toBeGreaterThan(score('ul li'));
    expect(gradeOf(score('div > ul > li:nth-child(3)'))).toBe('F');
    expect(gradeOf(score('[data-testid=list] li:first-child'))).toBe('D');
  });

  it('rates XPath by length, position and absoluteness', () => {
    expect(score('/html/body/div[2]/div/form/button[1]')).toBe(100);
    expect(score('//html/body/div')).toBeGreaterThanOrEqual(95);
    expect(score('//button')).toBeLessThan(score('//div/section/form/div/button'));
    expect(score("//div[@data-testid='x']")).toBeLessThan(score("//div[@class='x']"));
  });

  it('takes the worst part of a >> chain', () => {
    expect(score('[data-testid=x] >> .css-1x2y3z')).toBeGreaterThanOrEqual(85);
  });

  it('allows overriding rule weights', () => {
    const custom = new ScoreContext({ weights: { 'class-semantic': 5 } });
    expect(scoreSelector('.btn', custom).score).toBe(5);
  });

  it('supports custom test-id attributes', () => {
    const custom = new ScoreContext({ testIdAttributes: ['data-automation'] });
    expect(scoreSelector('[data-automation=x]', custom).score).toBe(5);
  });
});

describe('heuristics', () => {
  it('classifies classes', () => {
    for (const c of ['Button_primary__a1B2c', 'sc-bdVaJa', 'kZmDGr', 'css-1x2y3z', 'jsx-12345', '_btn_1x2y3_5']) {
      expect(classifyClass(c), c).toBe('generated');
    }
    for (const c of ['mt-4', 'hover:bg-red-500', 'flex', 'w-[200px]', 'text-sm']) expect(classifyClass(c), c).toBe('utility');
    for (const c of ['card__title', 'btn-primary', 'navBar', 'version2023']) expect(classifyClass(c), c).toBe('semantic');
  });

  it('detects generated ids', () => {
    for (const id of [':r1:', 'ember123', 'mui-4521', '3f2b8c1a-1d2e-4f00-9abc-123456789abc', 'input-8f3k2a']) {
      expect(isGeneratedId(id), id).toBe(true);
    }
    for (const id of ['submit', 'step-1', 'login-form']) expect(isGeneratedId(id), id).toBe(false);
  });
});
