// Checks the JSON written by the reporter during the e2e run (npm run e2e).
import assert from 'node:assert/strict';
import fs from 'node:fs';

const file = process.argv[2] ?? 'e2e/fragility-report.json';
const report = JSON.parse(fs.readFileSync(file, 'utf8'));
const byTitle = Object.fromEntries(report.tests.map((t) => [t.title, t]));

assert.equal(report.summary.tests, 3, 'expected 3 tests in the report');

const robust = byTitle['submits the form with robust locators'];
assert.equal(robust.outcome, 'expected');
assert.equal(robust.level, 'low');

const positional = byTitle['reads a result by position'];
assert.equal(positional.outcome, 'expected');
assert.equal(positional.level, 'critical');
assert.equal(positional.worst.grade, 'F');

const flaky = byTitle['is flaky on the first attempt'];
assert.equal(flaky.outcome, 'flaky', 'the retried test must be reported as flaky');
assert.equal(flaky.retries, 1);
assert.match(flaky.uses.map((u) => u.code).join('\n'), /\/\/html\/body\/ul\/li\[3\]/);

assert.equal(report.tests.at(-1).title, robust.title, 'the robust test must rank last');
assert.equal(report.hotspots[0].use.grade, 'F', 'the top locator worth fixing must be an F');

console.log(`e2e report OK (${report.tests.length} tests, ${report.summary.locators} locators)`);
