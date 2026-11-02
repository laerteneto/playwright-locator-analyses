#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { analyzeFiles } from './analyzer';
import { emitReport } from './output';
import { buildReport } from './report';

const HELP = `Usage: locator-fragility [paths...] [options]

Scores the locators used by Playwright tests and ranks the tests most likely to break.
Paths can be files or directories (default: current directory).

Options:
  --json <file>                Write the full report as JSON
  --html <file>                Write an HTML report
  --top <n>                    Number of tests in the ranking (default 10)
  --top-locators <n>           Number of "locators worth fixing" to show (default 5)
  --fail-on-risk <0-100>       Exit with code 1 if any test has risk >= n
  --tsconfig <file>            tsconfig used to resolve imports (auto-detected)
  --test-id-attribute <attr>   Custom test id attribute (e.g. data-qa)
  --pattern <regex>            Test file regex (default: \\.(spec|test)\\.[cm]?[jt]sx?$)
  --quiet                      Do not print to the console
  -h, --help                   Show this help
`;

function main(argv: string[]): number {
  const paths: string[] = [];
  const opts: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      console.log(HELP);
      return 0;
    }
    if (a === '--quiet') opts.quiet = true;
    else if (a.startsWith('--')) {
      const [key, inline] = a.slice(2).split('=', 2);
      const value = inline ?? argv[++i];
      if (value === undefined) throw new Error(`Missing value for --${key}`);
      opts[key] = value;
    } else paths.push(a);
  }

  const cwd = process.cwd();
  const pattern = new RegExp(String(opts.pattern ?? '\\.(spec|test)\\.[cm]?[jt]sx?$'));
  const files = collectFiles(paths.length ? paths : ['.'], pattern, cwd);
  if (files.length === 0) {
    console.error('No test files found.');
    return 2;
  }

  const num = (k: string) => (opts[k] === undefined ? undefined : Number(opts[k]));
  const tests = analyzeFiles(files, {
    cwd,
    tsconfig: opts.tsconfig as string | undefined,
    testIdAttributes: opts['test-id-attribute'] ? [String(opts['test-id-attribute'])] : undefined,
  });
  const report = buildReport(tests, { rootDir: cwd });
  const { failed } = emitReport(report, {
    outputFile: opts.json as string | undefined,
    htmlFile: opts.html as string | undefined,
    top: num('top'),
    topLocators: num('top-locators'),
    failOnRisk: num('fail-on-risk'),
    quiet: Boolean(opts.quiet),
  });
  return failed ? 1 : 0;
}

function collectFiles(inputs: string[], pattern: RegExp, cwd: string): string[] {
  const out = new Set<string>();
  const walk = (p: string) => {
    const stat = fs.statSync(p);
    if (stat.isFile()) {
      out.add(p);
      return;
    }
    for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(p, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (pattern.test(entry.name)) out.add(full);
    }
  };
  for (const input of inputs) walk(path.resolve(cwd, input));
  return [...out].sort();
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}
