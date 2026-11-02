/**
 * Rule catalogue. Every rule has a default number of points.
 *
 * "base" rules describe what a locator is anchored on (the score of the
 * locator starts from the worst anchor it depends on). "penalty" rules are
 * added on top (positional selectors, long XPaths, .nth(), ...).
 *
 * Fragility score: 0 (robust) .. 100 (very likely to break).
 */
export type RuleId =
  // anchors (base)
  | 'testid'
  | 'role-named'
  | 'role-unnamed'
  | 'label'
  | 'alt-text'
  | 'placeholder'
  | 'title'
  | 'text'
  | 'id-stable'
  | 'id-generated'
  | 'aria-attr'
  | 'attr-other'
  | 'style-attr'
  | 'class-semantic'
  | 'class-utility'
  | 'class-generated'
  | 'tag-only'
  | 'tag-scoped'
  | 'universal'
  | 'xpath'
  | 'xpath-testid'
  | 'xpath-absolute'
  | 'unresolved'
  // penalties
  | 'nth-child'
  | 'nth-match'
  | 'pw-nth'
  | 'nth'
  | 'first-last'
  | 'xpath-long'
  | 'xpath-positional'
  | 'xpath-axis'
  | 'xpath-class'
  | 'deep-css'
  | 'child-combinator'
  | 'sibling-combinator'
  | 'selector-chain'
  | 'long-text'
  | 'legacy-api';

export interface RuleDef {
  kind: 'base' | 'penalty';
  points: number;
  message: string;
}

export const RULES: Record<RuleId, RuleDef> = {
  testid: { kind: 'base', points: 5, message: 'Test attribute (getByTestId / data-testid): stable, made for tests' },
  'role-named': { kind: 'base', points: 5, message: 'getByRole with name: matches what users and assistive technology see' },
  'role-unnamed': { kind: 'base', points: 15, message: 'getByRole without name: may match several elements' },
  label: { kind: 'base', points: 10, message: 'getByLabel: stable as long as the label does not change' },
  'alt-text': { kind: 'base', points: 15, message: 'getByAltText: depends on the alt text' },
  placeholder: { kind: 'base', points: 20, message: 'Placeholder: tends to change with copy tweaks' },
  title: { kind: 'base', points: 20, message: 'title attribute: tends to change with copy tweaks' },
  text: { kind: 'base', points: 25, message: 'Visible text: breaks with copy changes or translation (i18n)' },
  'id-stable': { kind: 'base', points: 20, message: 'Fixed ID: reasonable, but not a test contract' },
  'id-generated': { kind: 'base', points: 80, message: 'Auto-generated ID (hash/counter): changes between builds or renders' },
  'aria-attr': { kind: 'base', points: 20, message: 'aria/name attribute: reasonable, prefer getByRole/getByLabel' },
  'attr-other': { kind: 'base', points: 30, message: 'Generic attribute (type, href, ...): not very specific' },
  'style-attr': { kind: 'base', points: 80, message: 'style attribute: visual detail, changes at any time' },
  'class-semantic': { kind: 'base', points: 35, message: 'CSS class: a styling detail, not a test contract' },
  'class-utility': { kind: 'base', points: 50, message: 'Utility class (Tailwind/Bootstrap): changes with every visual tweak' },
  'class-generated': { kind: 'base', points: 85, message: 'Generated class (CSS Modules, styled-components, emotion...): changes on every build' },
  'tag-only': { kind: 'base', points: 55, message: 'HTML tag only: ambiguous, depends on page structure' },
  'tag-scoped': { kind: 'base', points: 30, message: 'HTML tag inside a container: depends on inner structure' },
  universal: { kind: 'base', points: 70, message: 'Universal/positional selector with no anchor' },
  xpath: { kind: 'base', points: 40, message: 'XPath: coupled to the DOM structure' },
  'xpath-testid': { kind: 'base', points: 15, message: 'XPath anchored on a test attribute (prefer getByTestId)' },
  'xpath-absolute': { kind: 'base', points: 95, message: 'Absolute XPath (/html/body/...): breaks with any layout change' },
  unresolved: { kind: 'base', points: 30, message: 'Dynamic selector: value could not be resolved statically' },

  'nth-child': { kind: 'penalty', points: 35, message: 'Positional pseudo-class (:nth-child, :first-child...): breaks when elements are reordered or inserted' },
  'nth-match': { kind: 'penalty', points: 30, message: ':nth-match(): depends on element order' },
  'pw-nth': { kind: 'penalty', points: 25, message: 'nth= in the selector: depends on element order' },
  nth: { kind: 'penalty', points: 25, message: '.nth(n): depends on element order' },
  'first-last': { kind: 'penalty', points: 15, message: '.first()/.last(): hides an ambiguous locator' },
  'xpath-long': { kind: 'penalty', points: 8, message: 'Long XPath: every extra level is another breaking point' },
  'xpath-positional': { kind: 'penalty', points: 20, message: 'Positional index in XPath ([2], last(), position())' },
  'xpath-axis': { kind: 'penalty', points: 15, message: 'Relative axis in XPath (.., following-sibling, ancestor...)' },
  'xpath-class': { kind: 'penalty', points: 15, message: 'XPath filtering by @class' },
  'deep-css': { kind: 'penalty', points: 7, message: 'Deep CSS selector: depends on DOM hierarchy' },
  'child-combinator': { kind: 'penalty', points: 5, message: '">" combinator: requires a specific direct parent' },
  'sibling-combinator': { kind: 'penalty', points: 10, message: 'Sibling combinator (+ / ~): depends on element order' },
  'selector-chain': { kind: 'penalty', points: 5, message: '">>" selector chaining' },
  'long-text': { kind: 'penalty', points: 10, message: 'Long text: more chance that some word changes' },
  'legacy-api': { kind: 'penalty', points: 10, message: 'Legacy string-based API (page.click(sel), page.$...): prefer page.locator()/getBy*' },
};

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export function gradeOf(score: number): Grade {
  if (score < 15) return 'A';
  if (score < 30) return 'B';
  if (score < 50) return 'C';
  if (score < 70) return 'D';
  return 'F';
}

export type RiskLevel = 'low' | 'moderate' | 'high' | 'critical';

export function riskLevelOf(risk: number): RiskLevel {
  if (risk < 10) return 'low';
  if (risk < 25) return 'moderate';
  if (risk < 50) return 'high';
  return 'critical';
}

export interface Finding {
  rule: RuleId | 'inherited';
  points: number;
  message: string;
}

export interface ScoringOptions {
  /** Override points per rule, e.g. { 'nth-child': 50 }. */
  weights?: Partial<Record<RuleId, number>>;
  /** Attributes considered test ids. Defaults to data-testid, data-test-id, data-test, data-cy, data-qa. */
  testIdAttributes?: string[];
}

export const DEFAULT_TEST_ID_ATTRIBUTES = ['data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-qa', 'data-pw'];

export class ScoreContext {
  readonly testIdAttributes: string[];
  private readonly weights: Partial<Record<RuleId, number>>;

  constructor(options: ScoringOptions = {}) {
    this.weights = options.weights ?? {};
    const attrs = new Set([...(options.testIdAttributes ?? []), ...DEFAULT_TEST_ID_ATTRIBUTES]);
    this.testIdAttributes = [...attrs].map((a) => a.toLowerCase());
  }

  points(rule: RuleId): number {
    return this.weights[rule] ?? RULES[rule].points;
  }

  finding(rule: RuleId, detail?: string, multiplier = 1): Finding {
    const message = detail ? `${RULES[rule].message} — ${detail}` : RULES[rule].message;
    return { rule, points: this.points(rule) * multiplier, message };
  }
}

export function clamp(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}
