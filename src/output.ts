import fs from 'fs';
import path from 'path';
import { formatConsole } from './format/console';
import { formatHtml } from './format/html';
import { FragilityReport, TestReport, toJSON } from './report';

export interface OutputOptions {
  /** Write the full report as JSON. */
  outputFile?: string;
  /** Write a standalone HTML report. */
  htmlFile?: string;
  /** Number of tests shown in the console ranking. Default 10. */
  top?: number;
  /** Number of "locators worth fixing" shown in the console. Default 5. */
  topLocators?: number;
  /** Do not print to the console. */
  quiet?: boolean;
  /** Fail (exit code 1 / failed run) when any test's risk is >= this value (0..100). */
  failOnRisk?: number;
}

export interface EmitResult {
  failed: boolean;
  offenders: TestReport[];
}

export function emitReport(report: FragilityReport, options: OutputOptions, log: (s: string) => void = console.log): EmitResult {
  if (!options.quiet) log(formatConsole(report, { top: options.top, topLocators: options.topLocators }));

  if (options.outputFile) {
    const file = path.resolve(report.rootDir, options.outputFile);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(toJSON(report), null, 2));
    if (!options.quiet) log(`JSON report: ${file}`);
  }
  if (options.htmlFile) {
    const file = path.resolve(report.rootDir, options.htmlFile);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, formatHtml(report));
    if (!options.quiet) log(`HTML report: ${file}`);
  }

  const threshold = options.failOnRisk;
  const offenders = threshold === undefined ? [] : report.tests.filter((t) => t.risk >= threshold);
  if (offenders.length > 0) {
    log(`\n${offenders.length} test(s) with risk >= ${threshold}. Failing because of failOnRisk.`);
  }
  return { failed: offenders.length > 0, offenders };
}
