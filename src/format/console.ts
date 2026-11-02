import { LocatorUse } from '../analyzer';
import { FragilityReport, relative, TestReport } from '../report';
import { Grade, RiskLevel } from '../rules';

export interface ConsoleOptions {
  /** How many tests to list. Default 10. */
  top?: number;
  /** How many hotspots to list. Default 5. */
  topLocators?: number;
  color?: boolean;
  width?: number;
}

const CODES = { reset: 0, bold: 1, dim: 2, red: 31, green: 32, yellow: 33, magenta: 35, cyan: 36, gray: 90 } as const;
type Color = keyof typeof CODES;

export function formatConsole(report: FragilityReport, options: ConsoleOptions = {}): string {
  const useColor = options.color ?? defaultColor();
  const c = (color: Color, s: string) => (useColor ? `\x1b[${CODES[color]}m${s}\x1b[0m` : s);
  const width = Math.max(100, options.width ?? process.stdout.columns ?? 120);
  const top = options.top ?? 10;
  const topLocators = options.topLocators ?? 5;
  const rel = (f: string, line: number) => `${relative(report.rootDir, f)}:${line}`;
  const gradeColor = (g: Grade): Color => (g === 'A' || g === 'B' ? 'green' : g === 'C' ? 'yellow' : 'red');
  const levelColor = (l: RiskLevel): Color => (l === 'low' ? 'green' : l === 'moderate' ? 'yellow' : l === 'high' ? 'magenta' : 'red');
  const grade = (u: LocatorUse) => c(gradeColor(u.grade), `${u.grade} ${String(u.score).padStart(3)}`);

  const s = report.summary;
  const out: string[] = [];
  out.push('');
  out.push(c('bold', 'Locator fragility analysis'));
  out.push(c('gray', `${s.tests} tests · ${s.locators} unique locators · average risk ${s.averageRisk.toFixed(1)}`));
  out.push(
    'Locators by grade: ' +
      (['A', 'B', 'C', 'D', 'F'] as Grade[]).map((g) => c(gradeColor(g), `${g} ${s.grades[g]}`)).join('  ') +
      c('gray', '   |   Tests by risk: ') +
      (['critical', 'high', 'moderate', 'low'] as RiskLevel[]).map((l) => c(levelColor(l), `${l} ${s.levels[l]}`)).join('  '),
  );

  if (report.tests.length === 0) {
    out.push('', 'No tests found.');
    return out.join('\n');
  }

  out.push('', c('bold', `Tests most likely to break (top ${Math.min(top, report.tests.length)})`));
  const shown = report.tests.slice(0, top);
  const titleW = Math.min(48, Math.max(5, ...shown.map((t) => t.titlePath.join(' › ').length + (t.outcome ? 9 : 0))));
  const locW = Math.min(40, Math.max(5, ...shown.map((t) => rel(t.file, t.line).length)));
  const codeW = Math.max(30, width - (2 + 4 + 15 + titleW + 1 + locW + 1 + 7));
  out.push(c('gray', `  ${pad('#', 3)} ${pad('Risk', 14)} ${pad('Test', titleW)} ${pad('Location', locW)} Worst locator`));
  shown.forEach((t: TestReport, i) => {
    const risk = c(levelColor(t.level), pad(`${t.risk.toFixed(1)} ${t.level}`, 14));
    const tag = t.outcome === 'flaky' ? ' [flaky]' : t.outcome === 'unexpected' ? ' [failed]' : '';
    const titleText = trunc(t.titlePath.join(' › '), titleW - tag.length);
    const title = titleText + (tag ? c(t.outcome === 'flaky' ? 'yellow' : 'red', tag) : '') +
      ' '.repeat(Math.max(0, titleW - titleText.length - tag.length));
    const worst = t.worst ? `${grade(t.worst)}  ${trunc(t.worst.code, codeW)}` : c('gray', '(no locators)');
    out.push(`  ${pad(String(i + 1), 3)} ${risk} ${title} ${c('cyan', pad(trunc(rel(t.file, t.line), locW), locW))} ${worst}`);
  });

  if (report.hotspots.length > 0) {
    out.push('', c('bold', 'Locators most worth fixing'));
    report.hotspots.slice(0, topLocators).forEach((h, i) => {
      const used = h.tests === 1 ? 'used by 1 test' : `used by ${h.tests} tests`;
      out.push(`  ${i + 1}. ${grade(h.use)}  ${c('cyan', rel(h.use.file, h.use.line))}  ${c('gray', used)}`);
      out.push(`     ${trunc(h.use.code, width - 5)}`);
      for (const f of h.use.findings.filter((f) => f.rule !== 'inherited' && f.points >= 10).slice(0, 4)) {
        out.push(c('gray', `     ↳ ${trunc(`(+${f.points}) ${f.message}`, width - 7)}`));
      }
    });
  }

  out.push('', c('gray', 'Grades: A (robust) → F (fragile). Risk = estimated chance that a UI change breaks the test.'));
  out.push('');
  return out.join('\n');
}

function defaultColor(): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true;
  return Boolean(process.stdout.isTTY);
}

function trunc(s: string, n: number): string {
  if (n <= 1) return '';
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function pad(s: string, n: number): string {
  return s.padEnd(n);
}
