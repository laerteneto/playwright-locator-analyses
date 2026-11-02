import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { clamp, Finding, Grade, gradeOf, RuleId, ScoreContext, ScoringOptions } from './rules';
import { scoreSelector, ScoredSelector } from './selector';

export interface LocatorUse {
  /** Unique id: absolute file path + offset. */
  id: string;
  file: string;
  line: number;
  column: number;
  /** Source snippet of the locator expression. */
  code: string;
  /** Fragility score 0 (robust) .. 100 (very fragile). */
  score: number;
  grade: Grade;
  findings: Finding[];
  /** Ids of the locators this one is built on (e.g. `form.getByRole()` derives from `form`). */
  ancestors: string[];
}

export interface StaticTest {
  title: string;
  titlePath: string[];
  file: string;
  line: number;
  column: number;
  /** Locators the test depends on (its body, hooks, page objects and helpers it calls). */
  uses: LocatorUse[];
}

export interface AnalyzeOptions extends ScoringOptions {
  /** Path to a tsconfig.json (path aliases, etc). Auto-detected from cwd if omitted. */
  tsconfig?: string;
  /** Names of the test function. Default: ['test', 'it']. */
  testFunctionNames?: string[];
  cwd?: string;
}

const LOCATOR_METHODS = new Set([
  'locator', 'getByRole', 'getByTestId', 'getByText', 'getByLabel', 'getByPlaceholder', 'getByAltText', 'getByTitle', 'frameLocator',
]);
const MODIFIER_METHODS = new Set(['nth', 'first', 'last', 'filter', 'and', 'or', 'contentFrame', 'owner', 'describe']);
const CHAIN_METHODS = new Set([...LOCATOR_METHODS, ...MODIFIER_METHODS]);

/** Legacy string-selector APIs and the minimum number of args for the "selector" form. */
const LEGACY_METHODS: Record<string, number> = {
  $: 1, $$: 1, $eval: 2, $$eval: 2, waitForSelector: 1, click: 1, dblclick: 1, tap: 1, check: 1, uncheck: 1,
  hover: 1, focus: 1, textContent: 1, innerText: 1, innerHTML: 1, isVisible: 1, isHidden: 1, isEnabled: 1,
  isDisabled: 1, isChecked: 1, isEditable: 1, inputValue: 1, fill: 2, type: 2, press: 2, selectOption: 2,
  setInputFiles: 2, getAttribute: 2, dispatchEvent: 2, setChecked: 2, dragAndDrop: 2,
};
const PAGE_LIKE_TYPES = new Set(['Page', 'Frame', 'ElementHandle']);
const IGNORE_MARKER = 'playwright-locator-analyses-ignore';
const MAX_DEPTH = 12;

type FnNode = ts.FunctionLikeDeclaration;

interface Scope {
  titles: string[];
  hooks: FnNode[];
  parent?: Scope;
}

export function analyzeFiles(files: string[], options: AnalyzeOptions = {}): StaticTest[] {
  const cwd = options.cwd ?? process.cwd();
  const rootNames = files.map((f) => path.resolve(cwd, f));
  const program = ts.createProgram({ rootNames, options: compilerOptions(cwd, options.tsconfig) });
  const analyzer = new Analyzer(program, new ScoreContext(options), options.testFunctionNames ?? ['test', 'it']);
  const tests: StaticTest[] = [];
  for (const file of rootNames) {
    const sf = program.getSourceFile(file);
    if (sf) tests.push(...analyzer.analyzeTestFile(sf));
  }
  return tests;
}

function compilerOptions(cwd: string, tsconfig?: string): ts.CompilerOptions {
  const defaults: ts.CompilerOptions = {
    allowJs: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.Preserve,
    esModuleInterop: true,
    skipLibCheck: true,
  };
  const configPath = tsconfig ? path.resolve(cwd, tsconfig) : ts.findConfigFile(cwd, fs.existsSync);
  if (configPath && fs.existsSync(configPath)) {
    const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: () => undefined,
    });
    if (parsed) return { ...defaults, ...parsed.options, allowJs: true, noEmit: true };
  }
  return { ...defaults, noEmit: true };
}

class Analyzer {
  private readonly checker: ts.TypeChecker;
  private readonly chainCache = new Map<ts.Node, LocatorUse | null>();
  private readonly declCache = new Map<ts.Node, LocatorUse | null>();
  private readonly fnCache = new Map<ts.Node, LocatorUse[]>();
  private readonly inProgress = new Set<ts.Node>();

  constructor(
    private readonly program: ts.Program,
    private readonly ctx: ScoreContext,
    private readonly testNames: string[],
  ) {
    this.checker = program.getTypeChecker();
  }

  // -------------------------------------------------------------------------
  // Test discovery
  // -------------------------------------------------------------------------

  analyzeTestFile(sf: ts.SourceFile): StaticTest[] {
    const tests: StaticTest[] = [];
    this.scanScope(sf, { titles: [], hooks: [] }, tests);
    return tests;
  }

  private scanScope(container: ts.Node, scope: Scope, tests: StaticTest[]): void {
    const pending: Array<() => void> = [];
    const walk = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const kind = this.classifyCall(n);
        if (kind?.type === 'hook') {
          scope.hooks.push(kind.fn);
          return;
        }
        if (kind?.type === 'describe') {
          const child: Scope = { titles: kind.title ? [...scope.titles, kind.title] : scope.titles, hooks: [], parent: scope };
          pending.push(() => this.scanScope(kind.fn, child, tests));
          return;
        }
        if (kind?.type === 'test') {
          pending.push(() => tests.push(this.buildTest(n, kind.title, kind.fn, scope)));
          return;
        }
      }
      ts.forEachChild(n, walk);
    };
    // For describe callbacks walk the body only, so the callback itself is not re-classified.
    if (ts.isFunctionLike(container) && (container as FnNode).body) walk((container as FnNode).body!);
    else walk(container);
    // Hooks apply to every test of the scope regardless of declaration order, so build tests afterwards.
    pending.forEach((fn) => fn());
  }

  private classifyCall(call: ts.CallExpression):
    | { type: 'test'; title: string; fn: FnNode }
    | { type: 'describe'; title: string; fn: FnNode }
    | { type: 'hook'; fn: FnNode }
    | undefined {
    const name = dottedName(call.expression);
    if (!name) return undefined;
    const [head, ...rest] = name.split('.');
    const fn = [...call.arguments].reverse().find((a): a is ts.ArrowFunction | ts.FunctionExpression =>
      ts.isArrowFunction(a) || ts.isFunctionExpression(a));
    if (!fn) return undefined;
    const title = call.arguments.length > 0 ? titleOf(call.arguments[0]) : undefined;
    const hookNames = new Set(['beforeEach', 'beforeAll', 'afterEach', 'afterAll', 'before', 'after']);

    if (this.testNames.includes(head)) {
      if (rest.length === 0 || (rest.length === 1 && ['only', 'skip', 'fixme', 'fail', 'slow'].includes(rest[0]))) {
        return title !== undefined ? { type: 'test', title, fn } : undefined;
      }
      if (rest[0] === 'describe') return { type: 'describe', title: title ?? '', fn };
      if (rest.length === 1 && hookNames.has(rest[0])) return { type: 'hook', fn };
      return undefined;
    }
    if (head === 'describe' || head === 'context') return { type: 'describe', title: title ?? '', fn };
    if (rest.length === 0 && hookNames.has(head)) return { type: 'hook', fn };
    return undefined;
  }

  private buildTest(call: ts.CallExpression, title: string, fn: FnNode, scope: Scope): StaticTest {
    const sf = call.getSourceFile();
    const { line, character } = sf.getLineAndCharacterOfPosition(call.getStart());
    const found = new Map<string, LocatorUse>();
    this.collect(fn, found, 0);
    for (let s: Scope | undefined = scope; s; s = s.parent) {
      for (const hook of s.hooks) this.collect(hook, found, 0);
    }
    // A locator that is only the base of a more specific one is already counted through it.
    const all = [...found.values()];
    const bases = new Set(all.flatMap((u) => u.ancestors));
    const uses = all.filter((u) => !bases.has(u.id)).sort((a, b) => b.score - a.score);
    return {
      title,
      titlePath: [...scope.titles, title],
      file: path.resolve(sf.fileName),
      line: line + 1,
      column: character + 1,
      uses,
    };
  }

  // -------------------------------------------------------------------------
  // Collecting locator uses reachable from a node
  // -------------------------------------------------------------------------

  private collect(root: ts.Node, out: Map<string, LocatorUse>, depth: number): void {
    const add = (u: LocatorUse | null | undefined) => {
      if (u) out.set(u.id, u);
    };
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        if (isChainCall(n)) {
          if (isOutermostChainCall(n)) add(this.chainFrom(n));
        } else if (this.isLegacyCall(n)) {
          add(this.legacyUse(n));
        } else if (depth < MAX_DEPTH) {
          for (const u of this.followCall(n, depth + 1)) add(u);
        }
      } else if ((ts.isPropertyAccessExpression(n) || (ts.isIdentifier(n) && isValueReference(n))) && !isCallee(n)) {
        const decl = this.declarationOf(n);
        if (decl) add(this.locatorOfDeclaration(decl));
      }
      ts.forEachChild(n, visit);
    };
    visit(root);
  }

  /** Locator uses inside a function/method that is called from a test (page objects, helpers). */
  private followCall(call: ts.CallExpression, depth: number): LocatorUse[] {
    const fn = this.functionOf(call);
    if (!fn?.body) return [];
    const cached = this.fnCache.get(fn);
    if (cached) return cached;
    if (this.inProgress.has(fn)) return [];
    this.inProgress.add(fn);
    const out = new Map<string, LocatorUse>();
    this.collect(fn.body, out, depth);
    this.inProgress.delete(fn);
    const list = [...out.values()];
    this.fnCache.set(fn, list);
    return list;
  }

  private functionOf(call: ts.CallExpression): FnNode | undefined {
    let decl: ts.Node | undefined;
    try {
      decl = this.checker.getResolvedSignature(call)?.declaration;
    } catch {
      decl = undefined;
    }
    if (!decl || ts.isJSDocSignature(decl)) decl = this.declarationOf(call.expression);
    if (!decl || this.isExternal(decl)) return undefined;
    if (ts.isVariableDeclaration(decl) || ts.isPropertyDeclaration(decl) || ts.isPropertyAssignment(decl)) {
      const init = decl.initializer && unwrap(decl.initializer);
      decl = init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? init : undefined;
    }
    if (decl && ts.isFunctionLike(decl) && (decl as FnNode).body) return decl as FnNode;
    return undefined;
  }

  // -------------------------------------------------------------------------
  // Resolving names to locators (variables, page object properties, getters)
  // -------------------------------------------------------------------------

  private declarationOf(expr: ts.Node): ts.Declaration | undefined {
    const target = ts.isPropertyAccessExpression(expr) ? expr.name : expr;
    let sym = this.checker.getSymbolAtLocation(target);
    if (sym && sym.flags & ts.SymbolFlags.Alias) {
      try {
        sym = this.checker.getAliasedSymbol(sym);
      } catch {
        return undefined;
      }
    }
    const decl = sym?.valueDeclaration ?? sym?.declarations?.[0];
    if (!decl || this.isExternal(decl)) return undefined;
    return decl;
  }

  private locatorOfDeclaration(decl: ts.Node): LocatorUse | null {
    if (this.declCache.has(decl)) return this.declCache.get(decl)!;
    if (this.inProgress.has(decl)) return null;
    this.inProgress.add(decl);
    let result: LocatorUse | null = null;

    if ((ts.isVariableDeclaration(decl) || ts.isPropertyAssignment(decl)) && decl.initializer) {
      result = this.locatorOfExpression(decl.initializer);
    } else if (ts.isPropertyDeclaration(decl)) {
      result = decl.initializer
        ? this.locatorOfExpression(decl.initializer)
        : this.locatorFromConstructor(decl);
    } else if (ts.isGetAccessorDeclaration(decl) || ts.isMethodDeclaration(decl) || ts.isFunctionDeclaration(decl)) {
      // Only getters are "values"; methods are handled when called.
      if (ts.isGetAccessorDeclaration(decl)) result = this.returnedLocator(decl);
    } else if (ts.isPropertyAccessExpression(decl) && ts.isBinaryExpression(decl.parent) &&
      decl.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      // JS: this.button = page.locator(...)
      result = this.locatorOfExpression(decl.parent.right);
    }

    this.inProgress.delete(decl);
    this.declCache.set(decl, result);
    return result;
  }

  private locatorFromConstructor(prop: ts.PropertyDeclaration): LocatorUse | null {
    const cls = prop.parent;
    if (!ts.isClassLike(cls) || !prop.name || !ts.isIdentifier(prop.name)) return null;
    const name = prop.name.text;
    const ctor = cls.members.find(ts.isConstructorDeclaration);
    if (!ctor?.body) return null;
    let found: ts.Expression | undefined;
    const visit = (n: ts.Node): void => {
      if (found) return;
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(n.left) && n.left.expression.kind === ts.SyntaxKind.ThisKeyword &&
        n.left.name.text === name) {
        found = n.right;
        return;
      }
      ts.forEachChild(n, visit);
    };
    visit(ctor.body);
    return found ? this.locatorOfExpression(found) : null;
  }

  private returnedLocator(fn: FnNode): LocatorUse | null {
    if (!fn.body) return null;
    if (!ts.isBlock(fn.body)) return this.locatorOfExpression(fn.body);
    let result: LocatorUse | null = null;
    const visit = (n: ts.Node): void => {
      if (result || (ts.isFunctionLike(n) && n !== fn)) return;
      if (ts.isReturnStatement(n) && n.expression) result = this.locatorOfExpression(n.expression);
      else ts.forEachChild(n, visit);
    };
    visit(fn.body);
    return result;
  }

  private locatorOfExpression(expression: ts.Expression): LocatorUse | null {
    const expr = unwrap(expression);
    if (ts.isCallExpression(expr)) {
      if (isChainCall(expr)) return this.chainFrom(expr);
      if (this.isLegacyCall(expr)) return this.legacyUse(expr);
      const fn = this.functionOf(expr);
      if (fn && !this.inProgress.has(fn)) {
        this.inProgress.add(fn);
        const r = this.returnedLocator(fn);
        this.inProgress.delete(fn);
        return r;
      }
      return null;
    }
    if (ts.isIdentifier(expr) || ts.isPropertyAccessExpression(expr)) {
      const decl = this.declarationOf(expr);
      return decl ? this.locatorOfDeclaration(decl) : null;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Scoring locator chains
  // -------------------------------------------------------------------------

  private chainFrom(call: ts.CallExpression): LocatorUse | null {
    if (this.chainCache.has(call)) return this.chainCache.get(call)!;
    this.chainCache.set(call, null); // cycle guard

    const parts: ts.CallExpression[] = [];
    let cur: ts.Expression = call;
    for (;;) {
      const u = unwrapNoAwait(cur);
      if (ts.isCallExpression(u) && isChainCall(u)) {
        parts.unshift(u);
        cur = (u.expression as ts.PropertyAccessExpression).expression;
        continue;
      }
      break;
    }

    const hasLocator = parts.some((p) => LOCATOR_METHODS.has(methodName(p)!));
    const base = this.locatorOfExpression(cur);
    if ((!hasLocator && !base) || this.isIgnored(call)) return null;

    let score = base?.score ?? 0;
    let extra = 0;
    const findings: Finding[] = [];
    if (base) {
      findings.push({ rule: 'inherited', points: 0, message: `Derived from ${base.code} (${path.basename(base.file)}:${base.line})` });
      findings.push(...base.findings.filter((f) => f.rule !== 'inherited'));
    }
    for (const part of parts) {
      const r = this.scoreChainPart(part);
      if (r.modifier) extra += r.score;
      else score = Math.max(score, r.score);
      findings.push(...r.findings);
    }

    const use = this.makeUse(call, clamp(score + extra), findings, base ? [base.id, ...base.ancestors] : []);
    this.chainCache.set(call, use);
    return use;
  }

  private scoreChainPart(call: ts.CallExpression): ScoredSelector & { modifier?: boolean } {
    const name = methodName(call)!;
    const [arg0, arg1] = call.arguments;
    const ctx = this.ctx;
    const one = (rule: RuleId, detail?: string): ScoredSelector => {
      const f = ctx.finding(rule, detail);
      return { score: f.points, findings: [f] };
    };

    switch (name) {
      case 'getByTestId':
        return one('testid');
      case 'getByRole': {
        const named = arg1 !== undefined && (!ts.isObjectLiteralExpression(arg1) ||
          arg1.properties.some((p) => p.name !== undefined && ts.isIdentifier(p.name) && p.name.text === 'name'));
        const role = arg0 ? this.resolveString(arg0) : undefined;
        return one(named ? 'role-named' : 'role-unnamed', role ? `role "${role}"` : undefined);
      }
      case 'getByLabel':
        return one('label');
      case 'getByPlaceholder':
        return one('placeholder');
      case 'getByAltText':
        return one('alt-text');
      case 'getByTitle':
        return one('title');
      case 'getByText': {
        const text = arg0 ? this.resolveString(arg0) : undefined;
        const findings = [ctx.finding('text')];
        if (text && text.length > 40) findings.push(ctx.finding('long-text', `${text.length} characters`));
        return { score: findings.reduce((a, f) => a + f.points, 0), findings };
      }
      case 'locator':
      case 'frameLocator': {
        if (!arg0) return one('unresolved');
        const selector = this.resolveString(arg0);
        if (selector !== undefined) return scoreSelector(selector, ctx);
        const inner = this.locatorOfExpression(arg0);
        if (inner) return { score: inner.score, findings: inner.findings };
        return one('unresolved', arg0.getText());
      }
      case 'nth': {
        const f = ctx.finding('nth', `.nth(${arg0?.getText() ?? ''})`);
        return { score: f.points, findings: [f], modifier: true };
      }
      case 'first':
      case 'last': {
        const f = ctx.finding('first-last', `.${name}()`);
        return { score: f.points, findings: [f], modifier: true };
      }
      default:
        return { score: 0, findings: [], modifier: true };
    }
  }

  private isLegacyCall(call: ts.CallExpression): boolean {
    const name = methodName(call);
    if (!name || !(name in LEGACY_METHODS)) return false;
    if (call.arguments.length < LEGACY_METHODS[name]) return false;
    const arg0 = call.arguments[0];
    if (!this.isStringish(arg0)) return false;
    return this.isPageLike((call.expression as ts.PropertyAccessExpression).expression);
  }

  private legacyUse(call: ts.CallExpression): LocatorUse | null {
    if (this.chainCache.has(call)) return this.chainCache.get(call)!;
    if (this.isIgnored(call)) {
      this.chainCache.set(call, null);
      return null;
    }
    const selectors = methodName(call) === 'dragAndDrop' ? call.arguments.slice(0, 2) : call.arguments.slice(0, 1);
    let score = 0;
    const findings: Finding[] = [];
    for (const arg of selectors) {
      const value = this.resolveString(arg);
      const r = value !== undefined ? scoreSelector(value, this.ctx) : { score: this.ctx.points('unresolved'), findings: [this.ctx.finding('unresolved')] };
      score = Math.max(score, r.score);
      findings.push(...r.findings);
    }
    const legacy = this.ctx.finding('legacy-api', `${methodName(call)}()`);
    findings.push(legacy);
    const use = this.makeUse(call, clamp(score + legacy.points), findings, []);
    this.chainCache.set(call, use);
    return use;
  }

  private makeUse(node: ts.Node, score: number, findings: Finding[], ancestors: string[]): LocatorUse {
    const sf = node.getSourceFile();
    const start = node.getStart();
    const { line, character } = sf.getLineAndCharacterOfPosition(start);
    const file = path.resolve(sf.fileName);
    return {
      id: `${file}:${start}`,
      file,
      line: line + 1,
      column: character + 1,
      code: snippet(node),
      score,
      grade: gradeOf(score),
      findings: dedupeFindings(findings),
      ancestors,
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private resolveString(expression: ts.Expression, depth = 0): string | undefined {
    if (depth > 8) return undefined;
    const expr = unwrap(expression);
    if (ts.isStringLiteralLike(expr)) return expr.text;
    if (ts.isRegularExpressionLiteral(expr)) return expr.text;
    if (ts.isTemplateExpression(expr)) {
      let out = expr.head.text;
      let staticText = expr.head.text;
      for (const span of expr.templateSpans) {
        const v = this.resolveString(span.expression, depth + 1);
        out += (v ?? 'X') + span.literal.text;
        staticText += (v ?? '') + span.literal.text;
      }
      return staticText.trim() ? out : undefined;
    }
    if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const l = this.resolveString(expr.left, depth + 1);
      const r = this.resolveString(expr.right, depth + 1);
      if (l === undefined && r === undefined) return undefined;
      return (l ?? 'X') + (r ?? 'X');
    }
    if (ts.isIdentifier(expr) || ts.isPropertyAccessExpression(expr) || ts.isElementAccessExpression(expr)) {
      const target = ts.isElementAccessExpression(expr) ? expr.argumentExpression : expr;
      const decl = ts.isElementAccessExpression(expr) ? this.elementDeclaration(expr) : this.declarationOf(target);
      if (decl && (ts.isVariableDeclaration(decl) || ts.isPropertyAssignment(decl) || ts.isPropertyDeclaration(decl) ||
        ts.isEnumMember(decl)) && decl.initializer) {
        return this.resolveString(decl.initializer, depth + 1);
      }
    }
    return undefined;
  }

  private elementDeclaration(expr: ts.ElementAccessExpression): ts.Declaration | undefined {
    if (!ts.isStringLiteralLike(expr.argumentExpression)) return undefined;
    const type = this.checker.getTypeAtLocation(expr.expression);
    const prop = type.getProperty(expr.argumentExpression.text);
    const decl = prop?.valueDeclaration ?? prop?.declarations?.[0];
    return decl && !this.isExternal(decl) ? decl : undefined;
  }

  private isStringish(expr: ts.Expression | undefined): boolean {
    if (!expr) return false;
    const e = unwrap(expr);
    if (ts.isStringLiteralLike(e) || ts.isTemplateExpression(e)) return true;
    if (ts.isObjectLiteralExpression(e) || ts.isNumericLiteral(e) || ts.isArrowFunction(e) || ts.isFunctionExpression(e)) return false;
    const type = this.checker.getTypeAtLocation(e);
    return (type.flags & ts.TypeFlags.StringLike) !== 0;
  }

  private isPageLike(expr: ts.Expression): boolean {
    const type = this.checker.getTypeAtLocation(expr);
    const name = type.aliasSymbol?.getName() ?? type.getSymbol()?.getName();
    if (name && PAGE_LIKE_TYPES.has(name)) return true;
    const unknown = !name || (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0;
    return unknown && /(?:^|\.)(?:page|frame|\w*Page|\w*Frame)$/.test(expr.getText().replace(/\s+/g, ''));
  }

  private isExternal(node: ts.Node): boolean {
    const sf = node.getSourceFile();
    return sf.isDeclarationFile || this.program.isSourceFileFromExternalLibrary(sf) || /[\\/]node_modules[\\/]/.test(sf.fileName);
  }

  private isIgnored(node: ts.Node): boolean {
    const sf = node.getSourceFile();
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
    const lines = sf.text.split(/\r?\n/);
    return (lines[line]?.includes(IGNORE_MARKER) ?? false) || (line > 0 && (lines[line - 1]?.includes(IGNORE_MARKER) ?? false));
  }
}

// ---------------------------------------------------------------------------
// AST utilities
// ---------------------------------------------------------------------------

function methodName(call: ts.CallExpression): string | undefined {
  return ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : undefined;
}

function isChainCall(call: ts.CallExpression): boolean {
  const name = methodName(call);
  return name !== undefined && CHAIN_METHODS.has(name);
}

/** True unless this call is the receiver of another chain call (`<call>.nth(1)`). */
function isOutermostChainCall(call: ts.CallExpression): boolean {
  let node: ts.Node = call;
  while (ts.isParenthesizedExpression(node.parent) || ts.isNonNullExpression(node.parent)) node = node.parent;
  const parent = node.parent;
  return !(ts.isPropertyAccessExpression(parent) && CHAIN_METHODS.has(parent.name.text) &&
    ts.isCallExpression(parent.parent) && parent.parent.expression === parent);
}

function isCallee(node: ts.Node): boolean {
  return ts.isCallExpression(node.parent) && node.parent.expression === node;
}

function isValueReference(id: ts.Identifier): boolean {
  const p = id.parent;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return false;
  if ((ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isBindingElement(p) || ts.isPropertyDeclaration(p) ||
    ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isFunctionDeclaration(p) || ts.isClassDeclaration(p) ||
    ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isGetAccessorDeclaration(p)) && p.name === id) return false;
  if (ts.isTypeReferenceNode(p) || ts.isQualifiedName(p)) return false;
  return true;
}

function unwrapNoAwait(e: ts.Expression): ts.Expression {
  let cur = e;
  while (ts.isParenthesizedExpression(cur) || ts.isNonNullExpression(cur) || ts.isAsExpression(cur) ||
    ts.isTypeAssertionExpression(cur) || ts.isSatisfiesExpression(cur)) {
    cur = cur.expression;
  }
  return cur;
}

function unwrap(e: ts.Expression): ts.Expression {
  let cur = unwrapNoAwait(e);
  while (ts.isAwaitExpression(cur)) cur = unwrapNoAwait(cur.expression);
  return cur;
}

function dottedName(e: ts.Expression): string | undefined {
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) {
    const left = dottedName(e.expression);
    return left ? `${left}.${e.name.text}` : undefined;
  }
  return undefined;
}

function titleOf(e: ts.Expression): string | undefined {
  if (ts.isStringLiteralLike(e)) return e.text;
  if (ts.isTemplateExpression(e)) return e.getText().slice(1, -1);
  return undefined;
}

function snippet(node: ts.Node): string {
  const text = node.getText().replace(/\s+/g, ' ').replace(/^await /, '');
  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
}

function dedupeFindings(findings: Finding[]): Finding[] {
  const seen = new Map<string, Finding>();
  for (const f of findings) {
    const key = `${f.rule}|${f.message}`;
    const prev = seen.get(key);
    if (!prev || f.points > prev.points) seen.set(key, f);
  }
  const list = [...seen.values()];
  const inherited = list.filter((f) => f.rule === 'inherited');
  return [...list.filter((f) => f.rule !== 'inherited').sort((a, b) => b.points - a.points), ...inherited];
}
