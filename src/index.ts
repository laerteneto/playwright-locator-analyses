import LocatorFragilityReporter from './reporter';

export default LocatorFragilityReporter;
export type { LocatorFragilityReporterOptions } from './reporter';
export { analyzeFiles } from './analyzer';
export type { AnalyzeOptions, LocatorUse, StaticTest } from './analyzer';
export { buildReport, testRisk, toJSON } from './report';
export type { FragilityReport, TestReport, Hotspot } from './report';
export { scoreSelector, classifyClass, isGeneratedId } from './selector';
export { RULES, ScoreContext, gradeOf } from './rules';
export type { RuleId, Grade, Finding, ScoringOptions } from './rules';
export { formatConsole } from './format/console';
export { formatHtml } from './format/html';
export { emitReport } from './output';
