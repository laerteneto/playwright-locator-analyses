import { LocatorUse } from '../analyzer';
import { FragilityReport, relative } from '../report';
import { Grade, RiskLevel } from '../rules';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const GRADE_CLASS: Record<Grade, string> = { A: 'good', B: 'good', C: 'warn', D: 'bad', F: 'crit' };
const LEVEL_CLASS: Record<RiskLevel, string> = { low: 'good', moderate: 'warn', high: 'bad', critical: 'crit' };

export function formatHtml(report: FragilityReport): string {
  const rel = (f: string, line: number) => esc(`${relative(report.rootDir, f)}:${line}`);
  const s = report.summary;

  const locatorRow = (u: LocatorUse) => `
      <tr>
        <td><span class="pill ${GRADE_CLASS[u.grade]}">${u.grade} ${u.score}</span></td>
        <td><code>${esc(u.code)}</code><div class="loc">${rel(u.file, u.line)}</div></td>
        <td><ul>${u.findings
          .filter((f) => f.rule === 'inherited' || f.points > 0)
          .map((f) => `<li>${f.rule === 'inherited' ? '' : `<b>+${f.points}</b> `}${esc(f.message)}</li>`)
          .join('')}</ul></td>
      </tr>`;

  const testRows = report.tests
    .map((t, i) => `
    <details class="test">
      <summary>
        <span class="rank">${i + 1}</span>
        <span class="pill ${LEVEL_CLASS[t.level]}">${t.risk.toFixed(1)} ${t.level}</span>
        <span class="title">${esc(t.titlePath.join(' › '))}${t.outcome === 'flaky' ? ' <span class="pill warn">flaky</span>' : ''}${t.outcome === 'unexpected' ? ' <span class="pill crit">failed</span>' : ''}</span>
        <span class="loc">${rel(t.file, t.line)}</span>
        <span class="grades">${(['A', 'B', 'C', 'D', 'F'] as Grade[]).filter((g) => t.grades[g]).map((g) => `<span class="pill ${GRADE_CLASS[g]}">${t.grades[g]}×${g}</span>`).join(' ')}</span>
      </summary>
      ${t.uses.length ? `<table><thead><tr><th>Grade</th><th>Locator</th><th>Reasons</th></tr></thead><tbody>${t.uses.map(locatorRow).join('')}</tbody></table>` : '<p class="muted">No locators found.</p>'}
    </details>`)
    .join('');

  const hotspotRows = report.hotspots
    .slice(0, 20)
    .map((h) => locatorRow(h.use).replace('<td><code>', `<td><span class="muted">${h.tests === 1 ? '1 test' : `${h.tests} tests`}</span><br><code>`))
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Locator fragility</title>
<style>
  :root { --bg:#fff; --fg:#1d2327; --muted:#6b7280; --line:#e5e7eb; --card:#f8fafc;
    --good:#15803d; --good-bg:#dcfce7; --warn:#a16207; --warn-bg:#fef9c3; --bad:#b45309; --bad-bg:#ffedd5; --crit:#b91c1c; --crit-bg:#fee2e2; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0f1115; --fg:#e5e7eb; --muted:#9ca3af; --line:#262b33; --card:#161a20;
    --good:#4ade80; --good-bg:#14301f; --warn:#facc15; --warn-bg:#332b0b; --bad:#fb923c; --bad-bg:#3a210d; --crit:#f87171; --crit-bg:#3b1414; } }
  body { font: 14px/1.5 system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--fg); margin: 0 auto; max-width: 1200px; padding: 24px; }
  h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 32px 0 8px; }
  .muted, .loc { color: var(--muted); } .loc { font-size: 12px; font-family: ui-monospace, monospace; }
  .cards { display: flex; gap: 12px; flex-wrap: wrap; margin: 16px 0; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px; min-width: 120px; }
  .card b { display: block; font-size: 20px; }
  .pill { display: inline-block; border-radius: 999px; padding: 0 8px; font-size: 12px; font-weight: 600; white-space: nowrap; }
  .good { color: var(--good); background: var(--good-bg); } .warn { color: var(--warn); background: var(--warn-bg); }
  .bad { color: var(--bad); background: var(--bad-bg); } .crit { color: var(--crit); background: var(--crit-bg); }
  details.test { border: 1px solid var(--line); border-radius: 8px; margin: 6px 0; background: var(--card); }
  details.test summary { display: grid; grid-template-columns: 32px 130px 1fr auto; gap: 10px; align-items: center; padding: 8px 12px; cursor: pointer; }
  details.test summary .grades { grid-column: 3 / 5; }
  .rank { color: var(--muted); text-align: right; }
  table { border-collapse: collapse; width: 100%; background: var(--bg); }
  th, td { text-align: left; vertical-align: top; padding: 6px 10px; border-top: 1px solid var(--line); }
  th { font-size: 12px; color: var(--muted); font-weight: 600; }
  code { font-family: ui-monospace, monospace; font-size: 12px; word-break: break-all; }
  ul { margin: 0; padding-left: 16px; } li { font-size: 12px; }
</style>
</head>
<body>
  <h1>Locator fragility</h1>
  <div class="muted">Generated ${esc(new Date(report.generatedAt).toLocaleString('en-US'))}</div>
  <div class="cards">
    <div class="card"><b>${s.tests}</b>tests</div>
    <div class="card"><b>${s.locators}</b>unique locators</div>
    <div class="card"><b>${s.averageRisk.toFixed(1)}</b>average risk</div>
    <div class="card"><b>${s.levels.critical}</b>critical tests</div>
    <div class="card"><b>${(['A', 'B', 'C', 'D', 'F'] as Grade[]).map((g) => `<span class="pill ${GRADE_CLASS[g]}">${g} ${s.grades[g]}</span>`).join(' ')}</b>locators by grade</div>
  </div>

  <h2>Ranking: tests most likely to break</h2>
  <p class="muted">Risk = estimated chance that a UI change breaks one of the test's locators. Click a test to see its locators.</p>
  ${testRows || '<p class="muted">No tests found.</p>'}

  ${hotspotRows ? `<h2>Locators most worth fixing</h2>
  <p class="muted">Sorted by impact: fragility × number of tests that depend on the locator.</p>
  <table><thead><tr><th>Grade</th><th>Locator</th><th>Reasons</th></tr></thead><tbody>${hotspotRows}</tbody></table>` : ''}
</body>
</html>
`;
}
