import path from 'path';
import type { FullConfig, FullResult, Reporter, Suite, TestCase } from '@playwright/test/reporter';
import { analyzeFiles, AnalyzeOptions } from './analyzer';
import { emitReport, OutputOptions } from './output';
import { buildReport, Outcome } from './report';

export interface LocatorFragilityReporterOptions extends AnalyzeOptions, OutputOptions {
  /** Minimum locator score to be listed as "worth fixing". Default 30. */
  hotspotMinScore?: number;
}

/**
 * Playwright reporter. Statically analyzes the locators used by every test in the run
 * (including page objects and helpers) and prints a ranking of the tests most likely to break.
 *
 *   reporter: [['list'], ['playwright-locator-analyses', { htmlFile: 'fragility.html' }]]
 */
export default class LocatorFragilityReporter implements Reporter {
  private config?: FullConfig;
  private suite?: Suite;

  constructor(private readonly options: LocatorFragilityReporterOptions = {}) {}

  onBegin(config: FullConfig, suite: Suite): void {
    this.config = config;
    this.suite = suite;
  }

  async onEnd(_result: FullResult): Promise<{ status?: FullResult['status'] } | undefined> {
    if (!this.config || !this.suite) return undefined;
    const cases = this.suite.allTests();
    const files = [...new Set(cases.map((t) => path.resolve(t.location.file)))];
    if (files.length === 0) return undefined;

    const rootDir = this.config.configFile ? path.dirname(this.config.configFile) : this.config.rootDir;
    const configured = this.config.projects
      .map((p) => (p.use as { testIdAttribute?: string } | undefined)?.testIdAttribute)
      .filter((a): a is string => Boolean(a));

    let report;
    try {
      const tests = analyzeFiles(files, {
        ...this.options,
        cwd: this.options.cwd ?? rootDir,
        testIdAttributes: [...(this.options.testIdAttributes ?? []), ...configured],
      });
      report = buildReport(tests, { rootDir, hotspotMinScore: this.options.hotspotMinScore });
    } catch (error) {
      console.error('[locator-fragility] Failed to analyze tests:', error);
      return undefined;
    }

    // Attach what actually happened in this run (flaky / failed) to each static test.
    const byLocation = new Map<string, TestCase[]>();
    for (const t of cases) {
      const key = `${path.resolve(t.location.file)}:${t.location.line}`;
      byLocation.set(key, [...(byLocation.get(key) ?? []), t]);
    }
    for (const t of report.tests) {
      const ran = (byLocation.get(`${t.file}:${t.line}`) ?? []).filter((c) => c.results.length > 0);
      if (ran.length === 0) continue;
      t.outcome = worstOutcome(ran.map((c) => c.outcome()));
      t.retries = Math.max(...ran.map((c) => c.results.length - 1));
    }

    const { failed } = emitReport(report, this.options);
    return failed ? { status: 'failed' } : undefined;
  }

  printsToStdio(): boolean {
    return !this.options.quiet;
  }
}

function worstOutcome(outcomes: Outcome[]): Outcome {
  for (const o of ['unexpected', 'flaky', 'expected'] as Outcome[]) if (outcomes.includes(o)) return o;
  return 'skipped';
}
