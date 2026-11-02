import { clamp, Finding, RuleId, ScoreContext } from './rules';

export interface ScoredSelector {
  score: number;
  findings: Finding[];
}

/**
 * Scores a Playwright selector string (CSS, XPath, text=, role=, chained with >>).
 */
export function scoreSelector(selector: string, ctx: ScoreContext): ScoredSelector {
  const parts = splitTopLevel(selector, '>>').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { score: ctx.points('unresolved'), findings: [ctx.finding('unresolved', 'empty selector')] };

  let base = 0;
  let extra = 0;
  const findings: Finding[] = [];
  for (const part of parts) {
    const r = scorePart(part, ctx);
    if (r.modifier) extra += r.score;
    else base = Math.max(base, r.score);
    findings.push(...r.findings);
  }
  if (parts.length > 1) {
    const f = ctx.finding('selector-chain', undefined, parts.length - 1);
    extra += f.points;
    findings.push(f);
  }
  return { score: clamp(base + extra), findings: dedupe(findings) };
}

const ENGINE_RE = /^(xpath|css|text|role|id|nth|internal:[\w-]+|data-[\w-]+)\s*=\s*([\s\S]*)$/i;

function scorePart(part: string, ctx: ScoreContext): ScoredSelector & { modifier?: boolean } {
  const m = ENGINE_RE.exec(part);
  const engine = m?.[1].toLowerCase();
  const body = m ? m[2] : part;

  if (engine === 'nth') return { score: ctx.points('pw-nth'), findings: [ctx.finding('pw-nth')], modifier: true };
  if (engine === 'xpath' || (!engine && /^\(*\.{0,2}\//.test(part))) return scoreXPath(body, ctx);
  if (engine === 'text' || engine === 'internal:text' || (!engine && /^["']/.test(part))) return scoreText(unquote(body), ctx);
  if (engine === 'role' || engine === 'internal:role') {
    const named = /\[\s*name\s*=/.test(body);
    return single(ctx, named ? 'role-named' : 'role-unnamed', body);
  }
  if (engine === 'internal:testid' || (engine && ctx.testIdAttributes.includes(engine))) return single(ctx, 'testid');
  if (engine === 'internal:label') return single(ctx, 'label');
  if (engine === 'internal:attr') {
    if (/placeholder/i.test(body)) return single(ctx, 'placeholder');
    if (/\[\s*alt/i.test(body)) return single(ctx, 'alt-text');
    if (/\[\s*title/i.test(body)) return single(ctx, 'title');
    return single(ctx, 'attr-other');
  }
  if (engine === 'id') return scoreId(unquote(body), ctx);
  if (engine && engine.startsWith('internal:')) return { score: 0, findings: [], modifier: true };
  return scoreCss(body, ctx);
}

function single(ctx: ScoreContext, rule: RuleId, detail?: string): ScoredSelector {
  const f = ctx.finding(rule, detail);
  return { score: f.points, findings: [f] };
}

function scoreText(text: string, ctx: ScoreContext): ScoredSelector {
  const findings = [ctx.finding('text')];
  if (text.length > 40) findings.push(ctx.finding('long-text', `${text.length} characters`));
  return { score: sum(findings), findings };
}

function scoreId(id: string, ctx: ScoreContext): ScoredSelector {
  return isGeneratedId(id) ? single(ctx, 'id-generated', `#${id}`) : single(ctx, 'id-stable', `#${id}`);
}

// ---------------------------------------------------------------------------
// XPath
// ---------------------------------------------------------------------------

export function scoreXPath(xpath: string, ctx: ScoreContext): ScoredSelector {
  const x = xpath.trim();
  const findings: Finding[] = [];
  const absolute = /^\(*\/(?!\/)/.test(x) || /^\(*\/\/html\b/i.test(x);
  const usesTestId = ctx.testIdAttributes.some((a) => x.toLowerCase().includes(`@${a}`));

  let baseRule: RuleId = 'xpath';
  if (absolute) baseRule = 'xpath-absolute';
  else if (usesTestId) baseRule = 'xpath-testid';
  findings.push(ctx.finding(baseRule));

  const steps = splitTopLevel(x, '/').map((s) => s.trim()).filter((s) => s && s !== '(' && s !== ')');
  if (steps.length > 3) findings.push(ctx.finding('xpath-long', `${steps.length} levels`, steps.length - 3));

  const positional = (x.match(/\[\s*\d+\s*\]|position\(\)|last\(\)/g) ?? []).length;
  if (positional > 0) findings.push(ctx.finding('xpath-positional', undefined, positional));

  const axes = (x.match(/(?:following|preceding)(?:-sibling)?::|parent::|ancestor(?:-or-self)?::|(?:^|\/)\.\.(?=\/|$)/g) ?? []).length;
  if (axes > 0) findings.push(ctx.finding('xpath-axis', undefined, axes));

  if (/@class\b/.test(x)) findings.push(ctx.finding('xpath-class'));

  return { score: clamp(sum(findings)), findings };
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

type Simple =
  | { type: 'tag'; name: string }
  | { type: 'universal' }
  | { type: 'id'; name: string }
  | { type: 'class'; name: string }
  | { type: 'attr'; name: string; op?: string; value?: string }
  | { type: 'pseudo'; name: string; arg?: string };

const STRUCTURAL_PSEUDOS = new Set([
  'nth-child', 'nth-of-type', 'nth-last-child', 'nth-last-of-type',
  'first-child', 'last-child', 'first-of-type', 'last-of-type', 'only-child', 'only-of-type',
]);
const TEXT_PSEUDOS = new Set(['has-text', 'text', 'text-is', 'text-matches']);
const NESTED_PSEUDOS = new Set(['has', 'is', 'where']);

export function scoreCss(selector: string, ctx: ScoreContext): ScoredSelector {
  // Selector lists ("a, b"): be conservative and take the worst alternative.
  const alternatives = splitTopLevel(selector, ',').map((s) => s.trim()).filter(Boolean);
  if (alternatives.length > 1) {
    const scored = alternatives.map((a) => scoreCss(a, ctx));
    return scored.reduce((a, b) => (b.score > a.score ? b : a));
  }

  const { compounds, combinators } = splitCompounds(selector.trim());
  const parsed = compounds.map(parseCompound);
  const strongAnchor = parsed.some((simples) =>
    simples.some(
      (s) =>
        (s.type === 'attr' && ctx.testIdAttributes.includes(s.name.toLowerCase())) ||
        (s.type === 'id' && !isGeneratedId(s.name)),
    ),
  );

  let base = 0;
  const baseFindings: Finding[] = [];
  const penalties: Finding[] = [];
  let structural = 0;

  parsed.forEach((simples, index) => {
    const r = scoreCompound(simples, ctx, strongAnchor && index > 0);
    structural += r.structural;
    penalties.push(...r.penalties);
    if (r.score > base) base = r.score;
    baseFindings.push(...r.findings);
  });

  if (structural > 0) {
    penalties.push({ ...ctx.finding('nth-child'), points: ctx.points('nth-child') + (structural - 1) * 15 });
  }
  if (compounds.length > 2) penalties.push(ctx.finding('deep-css', `${compounds.length} levels`, compounds.length - 2));
  const child = combinators.filter((c) => c === '>').length;
  if (child > 0) penalties.push(ctx.finding('child-combinator', undefined, child));
  const sibling = combinators.filter((c) => c === '+' || c === '~').length;
  if (sibling > 0) penalties.push(ctx.finding('sibling-combinator', undefined, sibling));

  // Keep only the base findings that matter (the worst anchor, and anything else fragile).
  const relevantBase = baseFindings.filter((f) => f.points === base || f.points >= 35);
  return { score: clamp(base + sum(penalties)), findings: dedupe([...relevantBase, ...penalties]) };
}

function scoreCompound(simples: Simple[], ctx: ScoreContext, scoped: boolean) {
  const anchors: Finding[] = [];
  const penalties: Finding[] = [];
  let structural = 0;
  let hasTag = false;
  let universal = false;

  for (const s of simples) {
    switch (s.type) {
      case 'tag':
        hasTag = true;
        break;
      case 'universal':
        universal = true;
        break;
      case 'id':
        anchors.push(isGeneratedId(s.name) ? ctx.finding('id-generated', `#${s.name}`) : ctx.finding('id-stable', `#${s.name}`));
        break;
      case 'class':
        anchors.push(classFinding(s.name, ctx));
        break;
      case 'attr':
        anchors.push(attrFinding(s, ctx));
        break;
      case 'pseudo':
        if (STRUCTURAL_PSEUDOS.has(s.name)) structural++;
        else if (s.name === 'nth-match') penalties.push(ctx.finding('nth-match'));
        else if (TEXT_PSEUDOS.has(s.name)) {
          const t = unquote(s.arg ?? '');
          anchors.push(ctx.finding('text'));
          if (t.length > 40) penalties.push(ctx.finding('long-text', `${t.length} characters`));
        } else if (NESTED_PSEUDOS.has(s.name) && s.arg) {
          const inner = scoreCss(s.arg, ctx);
          anchors.push({ ...inner.findings[0], points: inner.score });
        }
        break;
    }
  }

  if (anchors.length === 0) {
    const tag = simples.find((s): s is Extract<Simple, { type: 'tag' }> => s.type === 'tag');
    const f = hasTag && !universal ? ctx.finding(scoped ? 'tag-scoped' : 'tag-only', tag?.name) : ctx.finding('universal');
    anchors.push(f);
  }

  // A compound is a conjunction: every part must keep matching, so it is as fragile as its worst part.
  const score = Math.max(...anchors.map((a) => a.points));
  return { score, findings: anchors, penalties, structural };
}

function attrFinding(s: Extract<Simple, { type: 'attr' }>, ctx: ScoreContext): Finding {
  const name = s.name.toLowerCase();
  const value = s.value ?? '';
  if (ctx.testIdAttributes.includes(name)) return ctx.finding('testid');
  if (name === 'id') {
    if (s.op === '=' && value) return isGeneratedId(value) ? ctx.finding('id-generated', value) : ctx.finding('id-stable', value);
    return ctx.finding('attr-other', `[id${s.op ?? ''}...]`);
  }
  if (name === 'class') {
    const classes = value.split(/\s+/).filter(Boolean);
    if (classes.length === 0) return ctx.finding('class-semantic');
    return classes.map((c) => classFinding(c, ctx)).reduce((a, b) => (b.points > a.points ? b : a));
  }
  if (name === 'style') return ctx.finding('style-attr');
  if (name === 'placeholder') return ctx.finding('placeholder');
  if (name === 'title') return ctx.finding('title');
  if (name === 'alt') return ctx.finding('alt-text');
  if (name.startsWith('aria-') || name === 'name' || name === 'role' || name === 'for') return ctx.finding('aria-attr', `[${name}]`);
  return ctx.finding('attr-other', `[${name}]`);
}

function classFinding(name: string, ctx: ScoreContext): Finding {
  const kind = classifyClass(name);
  if (kind === 'generated') return ctx.finding('class-generated', `.${name}`);
  if (kind === 'utility') return ctx.finding('class-utility', `.${name}`);
  return ctx.finding('class-semantic', `.${name}`);
}

// ---------------------------------------------------------------------------
// Heuristics for generated / utility names
// ---------------------------------------------------------------------------

/** Tokens like "a1B2c", "1x2y3z", "3kd9f": letters and digits interleaved. */
export function isHashLike(token: string): boolean {
  if (token.length < 5) return false;
  if (!/^[a-zA-Z0-9]+$/.test(token) || !/\d/.test(token) || !/[a-zA-Z]/.test(token)) return false;
  let transitions = 0;
  for (let i = 1; i < token.length; i++) {
    if (/\d/.test(token[i]) !== /\d/.test(token[i - 1])) transitions++;
  }
  return transitions >= 2;
}

const GENERATED_CLASS_PATTERNS = [
  /^css-[a-z0-9]{4,}/i, // emotion
  /^sc-[a-zA-Z0-9]+/, // styled-components
  /^jsx-\d+/, // styled-jsx
  /^svelte-[a-z0-9]+$/, // svelte
  /^makeStyles-/, /^jss\d+/, // material-ui v4
  /^ng-tns-/, // angular animations
  /^Mui[A-Za-z]+-root-\d+/,
];

export function classifyClass(name: string): 'generated' | 'utility' | 'semantic' {
  if (GENERATED_CLASS_PATTERNS.some((re) => re.test(name))) return 'generated';
  // styled-components hashes like "kZmDGr", "bdVaJa"
  if (/^[a-zA-Z]{5,6}$/.test(name) && (name.slice(1).match(/[A-Z]/g) ?? []).length >= 2) return 'generated';
  // CSS modules: Button_primary__a1B2c, _button_1x2y3_5, any hash-like segment
  if (name.split(/[-_]+/).some(isHashLike)) return 'generated';
  if (isUtilityClass(name)) return 'utility';
  return 'semantic';
}

const UTILITY_EXACT = new Set([
  'flex', 'grid', 'hidden', 'block', 'inline', 'inline-block', 'inline-flex', 'absolute', 'relative', 'fixed',
  'sticky', 'container', 'truncate', 'uppercase', 'lowercase', 'capitalize', 'italic', 'underline', 'sr-only',
  'visible', 'invisible', 'shadow', 'rounded', 'border', 'grow', 'shrink',
]);
const UTILITY_PREFIX =
  /^-?(?:[mp][trblxyse]?|text|bg|border|font|flex|grid|gap|w|h|min-w|min-h|max-w|max-h|size|rounded|shadow|items|justify|content|self|place|space-[xy]|leading|tracking|opacity|z|top|left|right|bottom|inset|overflow|cursor|col|row|order|basis|grow|shrink|d|align|float|translate|scale|rotate|transition|duration|ease|ring|outline|divide|fill|stroke|decoration|whitespace|break|aspect|object)-/;

export function isUtilityClass(name: string): boolean {
  if (/^(?:[a-z0-9-]+:)+/.test(name)) return true; // hover:, md:, dark:
  if (/\[.*\]/.test(name)) return true; // w-[200px]
  return UTILITY_EXACT.has(name) || UTILITY_PREFIX.test(name);
}

const GENERATED_ID_PATTERNS = [
  /^:r[0-9a-z]*:$/i, // React useId
  /^:[a-z0-9]+:$/i,
  /[0-9a-f]{8}-[0-9a-f]{4}-/i, // uuid
  /^(?:ember|mui-|headlessui-|radix-|react-select-|downshift-|rc-|ext-gen|yui_|gwt-uid|j_id|ui-id-|select2-)/i,
  /\d{3,}/, // long counters: input-1234, field_5521
];

export function isGeneratedId(id: string): boolean {
  if (GENERATED_ID_PATTERNS.some((re) => re.test(id))) return true;
  return id.split(/[-_:.]+/).some(isHashLike);
}

// ---------------------------------------------------------------------------
// Tiny CSS tokenizer
// ---------------------------------------------------------------------------

/** Splits on a separator only at depth 0 (outside quotes, (), []). */
export function splitTopLevel(input: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '\\') { i++; continue; }
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    else if (depth === 0 && input.startsWith(sep, i)) {
      out.push(input.slice(start, i));
      i += sep.length - 1;
      start = i + 1;
    }
  }
  out.push(input.slice(start));
  return out;
}

function splitCompounds(selector: string): { compounds: string[]; combinators: string[] } {
  const compounds: string[] = [];
  const combinators: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  let pendingCombinator: string | null = null;

  const flush = () => {
    if (!current) return;
    if (compounds.length > 0) combinators.push(pendingCombinator ?? ' ');
    compounds.push(current);
    current = '';
    pendingCombinator = null;
  };

  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (ch === '\\') { current += ch + (selector[i + 1] ?? ''); i++; continue; }
    if (quote) { current += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === '>' || ch === '+' || ch === '~')) {
      flush();
      pendingCombinator = ch;
      continue;
    }
    if (depth === 0 && /\s/.test(ch)) { flush(); continue; }
    current += ch;
  }
  flush();
  return { compounds, combinators };
}

function readIdent(s: string, start: number): { ident: string; end: number } {
  let i = start;
  let ident = '';
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\\' && i + 1 < s.length) { ident += s[i + 1]; i += 2; continue; }
    if (/[\w-]/.test(ch) || ch.charCodeAt(0) > 127) { ident += ch; i++; continue; }
    break;
  }
  return { ident, end: i };
}

function findClosing(s: string, start: number, open: string, close: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\') { i++; continue; }
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === open) depth++;
    else if (ch === close && --depth === 0) return i;
  }
  return s.length;
}

function parseCompound(c: string): Simple[] {
  const out: Simple[] = [];
  let i = 0;
  while (i < c.length) {
    const ch = c[i];
    if (ch === '#' || ch === '.') {
      const { ident, end } = readIdent(c, i + 1);
      if (ident) out.push({ type: ch === '#' ? 'id' : 'class', name: ident });
      i = Math.max(end, i + 1);
    } else if (ch === '[') {
      const end = findClosing(c, i, '[', ']');
      const inner = c.slice(i + 1, end);
      const m = /^\s*([\w:-]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]*)))?/.exec(inner);
      if (m) out.push({ type: 'attr', name: m[1], op: m[2], value: m[3] ?? m[4] ?? m[5] });
      i = end + 1;
    } else if (ch === ':') {
      let j = i + 1;
      if (c[j] === ':') j++;
      const { ident, end } = readIdent(c, j);
      i = Math.max(end, j);
      let arg: string | undefined;
      if (c[i] === '(') {
        const close = findClosing(c, i, '(', ')');
        arg = c.slice(i + 1, close);
        i = close + 1;
      }
      out.push({ type: 'pseudo', name: ident.toLowerCase(), arg });
    } else if (ch === '*') {
      out.push({ type: 'universal' });
      i++;
    } else {
      const { ident, end } = readIdent(c, i);
      if (ident) out.push({ type: 'tag', name: ident.toLowerCase() });
      i = Math.max(end, i + 1);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------

function unquote(s: string): string {
  const t = s.trim().replace(/[is]$/, (m) => (/^["'].*["'][is]$/.test(s.trim()) ? '' : m));
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
}

function sum(findings: Finding[]): number {
  return findings.reduce((acc, f) => acc + f.points, 0);
}

function dedupe(findings: Finding[]): Finding[] {
  const seen = new Map<string, Finding>();
  for (const f of findings) {
    const key = `${f.rule}|${f.message}`;
    const prev = seen.get(key);
    if (!prev || f.points > prev.points) seen.set(key, f);
  }
  return [...seen.values()].sort((a, b) => b.points - a.points);
}
