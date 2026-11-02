import path from 'path';
import { LocatorUse, StaticTest } from './analyzer';
import { Grade, RiskLevel, riskLevelOf } from './rules';

export type Outcome = 'expected' | 'unexpected' | 'flaky' | 'skipped';

export interface TestReport {
  title: string;
  titlePath: string[];
  file: string;
  line: number;
  /** 0..100 — chance-like estimate that a UI change breaks this test's locators. */
  risk: number;
  level: RiskLevel;
  locatorCount: number;
  grades: Record<Grade, number>;
  worst?: LocatorUse;
  uses: LocatorUse[];
  /** Filled by the reporter when the tests actually ran. */
  outcome?: Outcome;
  retries?: number;
}

export interface Hotspot {
  use: LocatorUse;
  /** Number of tests that depend on this locator. */
  tests: number;
  /** score² × tests: how much fixing this locator reduces risk across the suite. */
  impact: number;
}

export interface FragilityReport {
  generatedAt: string;
  rootDir: string;
  summary: {
    tests: number;
    locators: number;
    averageRisk: number;
    grades: Record<Grade, number>;
    levels: Record<RiskLevel, number>;
  };
  tests: TestReport[];
  hotspots: Hotspot[];
}

export interface BuildReportOptions {
  rootDir?: string;
  /** Minimum locator score to be listed as a hotspot. Default 30. */
  hotspotMinScore?: number;
}

/**
 * Risk model: each locator i with fragility s_i (0..100) breaks on a UI change with
 * probability p_i = (s_i/100)². The test breaks if any of its locators breaks:
 * risk = 1 − Π(1 − p_i). Squaring keeps robust locators (A/B) near zero while a single
 * F locator already makes the test critical.
 */
export function testRisk(uses: LocatorUse[]): number {
  const survive = uses.reduce((acc, u) => acc * (1 - (u.score / 100) ** 2), 1);
  return Math.round((1 - survive) * 1000) / 10;
}

export function buildReport(tests: StaticTest[], options: BuildReportOptions = {}): FragilityReport {
  const rootDir = options.rootDir ?? process.cwd();
  const minScore = options.hotspotMinScore ?? 30;

  const reports: TestReport[] = tests.map((t) => {
    const risk = testRisk(t.uses);
    return {
      title: t.title,
      titlePath: t.titlePath,
      file: t.file,
      line: t.line,
      risk,
      level: riskLevelOf(risk),
      locatorCount: t.uses.length,
      grades: countGrades(t.uses),
      worst: t.uses[0],
      uses: t.uses,
    };
  });
  reports.sort((a, b) => b.risk - a.risk || (b.worst?.score ?? 0) - (a.worst?.score ?? 0) || b.locatorCount - a.locatorCount);

  const byId = new Map<string, { use: LocatorUse; tests: number }>();
  for (const t of tests) {
    for (const u of t.uses) {
      const entry = byId.get(u.id) ?? { use: u, tests: 0 };
      entry.tests++;
      byId.set(u.id, entry);
    }
  }
  const unique = [...byId.values()];
  const hotspots = unique
    .filter((h) => h.use.score >= minScore)
    .map((h) => ({ ...h, impact: Math.round((h.use.score / 100) ** 2 * h.tests * 100) / 100 }))
    .sort((a, b) => b.impact - a.impact || b.use.score - a.use.score);

  const levels: Record<RiskLevel, number> = { low: 0, moderate: 0, high: 0, critical: 0 };
  reports.forEach((r) => levels[r.level]++);

  return {
    generatedAt: new Date().toISOString(),
    rootDir,
    summary: {
      tests: reports.length,
      locators: unique.length,
      averageRisk: reports.length ? Math.round((reports.reduce((a, r) => a + r.risk, 0) / reports.length) * 10) / 10 : 0,
      grades: countGrades(unique.map((u) => u.use)),
      levels,
    },
    tests: reports,
    hotspots,
  };
}

function countGrades(uses: LocatorUse[]): Record<Grade, number> {
  const g: Record<Grade, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  uses.forEach((u) => g[u.grade]++);
  return g;
}

export function relative(rootDir: string, file: string): string {
  const rel = path.relative(rootDir, file);
  return rel.startsWith('..') ? file : rel;
}

/** JSON-friendly copy with paths relative to rootDir. */
export function toJSON(report: FragilityReport): unknown {
  const rel = (f: string) => relative(report.rootDir, f);
  const use = (u: LocatorUse) => ({ ...u, file: rel(u.file), id: undefined, ancestors: undefined });
  return {
    ...report,
    tests: report.tests.map((t) => ({ ...t, file: rel(t.file), worst: t.worst && use(t.worst), uses: t.uses.map(use) })),
    hotspots: report.hotspots.map((h) => ({ ...h, use: use(h.use) })),
  };
}
