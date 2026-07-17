import { describe, test, expect } from 'bun:test';
import ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards the bug class that `output.fatal()` exists to kill: printing an error
 * and then letting the process exit 0, so `set -e` scripts and CI read the
 * command as a success. PR #23 fixed 8 such sites by hand (two — `setup-mcp
 * verify`, `address validate` — had shipped broken); `fatal()` made the shape
 * unwritable, and this test keeps it that way.
 *
 * The rule: an `output.error(...)` call is a violation iff **no** forward
 * control-flow path from it reaches a non-zero `process.exit(...)` or a
 * `throw`. That predicate is deliberately chosen:
 *
 *  - It flags the pure regression — `catch { output.error(msg); }` with no exit
 *    — because every continuation of that error falls out to exit 0.
 *  - It spares a *conditional* exit (`... ; if (!ok) process.exit(1)`), because
 *    that exit IS reachable. This is why `setup-mcp/verify.ts` and
 *    `address/validate.ts` — which render a verdict then let the verdict decide
 *    the exit, like `doctor` — pass without a brittle file allowlist.
 *  - It spares every `handleOrpcError(): never` helper, whose branches funnel
 *    into a trailing `process.exit(1)`.
 *
 * Two traps that bit earlier attempts, avoided here by walking the AST rather
 * than string-matching:
 *  (a) `getText()` on a try/catch includes the catch body, so a try whose
 *      *catch* exits looks terminal even when the normal path falls through.
 *      We model try/catch/finally structurally instead.
 *  (b) A bare `return` is exit 0 (the bug); `return process.exit(2)` is a loud
 *      exit. And the walk stops at the enclosing function boundary, so it never
 *      escapes an `.action(...)` callback into the factory's
 *      `return new Command(...)`.
 */

// --- predicates on individual call expressions ---------------------------

function isOutputError(node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'output' &&
    node.expression.name.text === 'error'
  );
}

// A "loud" exit is a non-zero process.exit. `process.exit()` and
// `process.exit(0)` are NOT loud — after an error they are themselves the bug,
// so they must not count as a satisfying exit.
function isLoudProcessExit(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const e = node.expression;
  if (
    !ts.isPropertyAccessExpression(e) ||
    !ts.isIdentifier(e.expression) ||
    e.expression.text !== 'process' ||
    e.name.text !== 'exit'
  ) {
    return false;
  }
  const arg = node.arguments[0];
  if (!arg) return false; // process.exit() === exit 0
  if (ts.isNumericLiteral(arg) && Number(arg.text) === 0) return false;
  return true; // process.exit(1|2|127|code) — a loud exit
}

// output.fatal(...) is `: never` — it renders then process.exit()s, so it is a
// loud exit in its own right. Without this, `output.error(detail); ...;
// output.fatal(summary)` (one detail line per item, then a fatal) would be a
// false positive.
function isOutputFatal(node: ts.Node): boolean {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'output' &&
    node.expression.name.text === 'fatal'
  );
}

// The full set of "loud" terminators: a non-zero process.exit, or output.fatal.
function isLoudExit(node: ts.Node): boolean {
  return isLoudProcessExit(node) || isOutputFatal(node);
}

function isFunctionLike(n: ts.Node): boolean {
  return (
    ts.isArrowFunction(n) ||
    ts.isFunctionExpression(n) ||
    ts.isFunctionDeclaration(n) ||
    ts.isMethodDeclaration(n)
  );
}

// --- structural control-flow analysis ------------------------------------

// Does `s` ALWAYS transfer control away (return / throw / process.exit on every
// path)? Used to know when statements after `s` are unreachable. Mirrors the
// subset of TS's own reachability that these command handlers exercise.
function alwaysCompletesAbruptly(s: ts.Statement): boolean {
  if (ts.isReturnStatement(s) || ts.isThrowStatement(s)) return true;
  if (ts.isExpressionStatement(s))
    return isLoudProcessExit(s.expression) || isZeroProcessExit(s.expression) || isOutputFatal(s.expression);
  if (ts.isBlock(s)) return s.statements.some(alwaysCompletesAbruptly);
  if (ts.isIfStatement(s)) {
    return (
      s.elseStatement !== undefined &&
      alwaysCompletesAbruptly(s.thenStatement) &&
      alwaysCompletesAbruptly(s.elseStatement)
    );
  }
  if (ts.isTryStatement(s)) {
    if (s.finallyBlock && s.finallyBlock.statements.some(alwaysCompletesAbruptly)) return true;
    const tryDone = s.tryBlock.statements.some(alwaysCompletesAbruptly);
    if (!tryDone) return false;
    if (!s.catchClause) return true;
    return s.catchClause.block.statements.some(alwaysCompletesAbruptly);
  }
  if (ts.isSwitchStatement(s)) {
    const clauses = s.caseBlock.clauses;
    if (!clauses.some((c) => ts.isDefaultClause(c))) return false;
    return clauses.every(
      (c) => c.statements.length === 0 || c.statements.some(alwaysCompletesAbruptly),
    );
  }
  return false;
}

function isZeroProcessExit(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const e = node.expression;
  if (
    !ts.isPropertyAccessExpression(e) ||
    !ts.isIdentifier(e.expression) ||
    e.expression.text !== 'process' ||
    e.name.text !== 'exit'
  ) {
    return false;
  }
  const arg = node.arguments[0];
  return !arg || (ts.isNumericLiteral(arg) && Number(arg.text) === 0);
}

// Does SOME path *entering* statement `s` reach a loud exit before `s`
// completes normally? Does not descend into nested function bodies.
function stmtReachesLoudExit(s: ts.Statement): boolean {
  if (ts.isThrowStatement(s)) return true;
  if (ts.isExpressionStatement(s)) return isLoudExit(s.expression);
  if (ts.isReturnStatement(s)) return s.expression !== undefined && isLoudExit(s.expression);
  if (ts.isBlock(s)) return listReachesLoudExit(s.statements, 0);
  if (ts.isIfStatement(s)) {
    return (
      stmtReachesLoudExit(s.thenStatement) ||
      (s.elseStatement !== undefined && stmtReachesLoudExit(s.elseStatement))
    );
  }
  if (ts.isTryStatement(s)) {
    return (
      listReachesLoudExit(s.tryBlock.statements, 0) ||
      (s.catchClause !== undefined && listReachesLoudExit(s.catchClause.block.statements, 0)) ||
      (s.finallyBlock !== undefined && listReachesLoudExit(s.finallyBlock.statements, 0))
    );
  }
  if (ts.isSwitchStatement(s)) {
    return s.caseBlock.clauses.some((c) => listReachesLoudExit(c.statements, 0));
  }
  if (
    ts.isForStatement(s) ||
    ts.isForOfStatement(s) ||
    ts.isForInStatement(s) ||
    ts.isWhileStatement(s) ||
    ts.isDoStatement(s)
  ) {
    return stmtReachesLoudExit(s.statement);
  }
  if (ts.isLabeledStatement(s)) return stmtReachesLoudExit(s.statement);
  return false;
}

// Walk an ordered statement list from `start`; true if a loud exit is reachable
// before the list's flow ends via an abrupt completion.
function listReachesLoudExit(stmts: readonly ts.Statement[], start: number): boolean {
  for (let i = start; i < stmts.length; i++) {
    const s = stmts[i];
    if (stmtReachesLoudExit(s)) return true;
    if (alwaysCompletesAbruptly(s)) return false; // flow leaves here, no loud exit found
  }
  return false; // fell off the end of the list (exit 0)
}

// From the statement holding an `output.error(...)`, does the continuation
// (siblings after it, then out through each enclosing block up to — but not
// past — the enclosing function) reach a loud exit?
function continuationReachesLoudExit(errStmt: ts.Statement): boolean {
  let cur: ts.Node = errStmt;
  for (;;) {
    const parent = cur.parent;
    if (!parent) return false;

    let list: readonly ts.Statement[] | null = null;
    if (ts.isBlock(parent) || ts.isSourceFile(parent)) list = parent.statements;
    else if (ts.isCaseClause(parent) || ts.isDefaultClause(parent)) list = parent.statements;

    if (list) {
      const idx = list.indexOf(cur as ts.Statement);
      if (idx >= 0 && listReachesLoudExit(list, idx + 1)) return true;
      const owner = parent.parent;
      if (!owner || isFunctionLike(owner)) return false; // hit the function boundary
      cur = owner;
      continue;
    }
    if (isFunctionLike(parent)) return false;
    cur = parent;
  }
}

// --- driver --------------------------------------------------------------

interface Violation {
  file: string;
  line: number;
  snippet: string;
}

function findViolations(file: string, source: string): Violation[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true);
  const out: Violation[] = [];
  const visit = (node: ts.Node): void => {
    if (isOutputError(node)) {
      let p: ts.Node | undefined = node;
      while (p && !ts.isExpressionStatement(p)) p = p.parent;
      // Only statement-position calls have a meaningful continuation; an
      // output.error used as a sub-expression is exotic and out of scope.
      if (p && ts.isExpressionStatement(p) && !continuationReachesLoudExit(p)) {
        out.push({
          file,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          snippet: node.getText(sf).split('\n')[0].slice(0, 72),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function srcFiles(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'node_modules') continue;
      srcFiles(p, acc);
    } else if (e.name.endsWith('.ts')) acc.push(p);
  }
  return acc;
}

// --- self-validation: the analyzer must catch the bug and spare the rest --

describe('no-silent-error-exit analyzer', () => {
  test('flags an error whose only continuation is exit 0 (the PR #23 bug)', () => {
    const v = findViolations(
      'bug.ts',
      `function f() { try { work(); } catch (e) { output.error('boom'); } }`,
    );
    expect(v.length).toBe(1);
  });

  test('flags an error followed by a bare return (exit 0)', () => {
    const v = findViolations(
      'bug2.ts',
      `function f() { if (bad) { output.error('nope'); return; } ship(); }`,
    );
    expect(v.length).toBe(1);
  });

  test('flags an error followed by an explicit process.exit(0)', () => {
    const v = findViolations(
      'bug3.ts',
      `function f() { output.error('nope'); process.exit(0); }`,
    );
    expect(v.length).toBe(1);
  });

  test('spares output.fatal (which cannot be written without exiting)', () => {
    const v = findViolations(
      'ok-fatal.ts',
      `function f() { try { work(); } catch (e) { output.fatal('boom'); } }`,
    );
    expect(v).toEqual([]);
  });

  test('spares an adjacent error + non-zero exit', () => {
    const v = findViolations(
      'ok-adjacent.ts',
      `function f() { if (bad) { output.error('boom'); process.exit(1); } }`,
    );
    expect(v).toEqual([]);
  });

  test('spares per-item error lines followed by a summary fatal (vault exec shape)', () => {
    const v = findViolations(
      'ok-loop-fatal.ts',
      `function f() {
         if (errs.length > 0) {
           for (const e of errs) output.error(e.reason);
           output.fatal('aborting');
         }
       }`,
    );
    expect(v).toEqual([]);
  });

  test('spares a conditional exit that renders first (doctor / validate shape)', () => {
    const v = findViolations(
      'ok-conditional.ts',
      `function f() {
         if (!res.valid) { output.error('failed'); }
         if (!res.valid) process.exit(1);
       }`,
    );
    expect(v).toEqual([]);
  });

  test('spares a handleOrpcError-style branchy helper ending in exit', () => {
    const v = findViolations(
      'ok-helper.ts',
      `function h(): never {
         if (a) { output.error('x'); } else if (b) { output.error('y'); } else { output.error('z'); }
         process.exit(1);
       }`,
    );
    expect(v).toEqual([]);
  });

  test('does NOT treat a catch-only exit as covering a fall-through try (trap a)', () => {
    // The error is in the try body and falls through; the catch exits. That is
    // still a silent-exit-0 bug and must be flagged.
    const v = findViolations(
      'trap-a.ts',
      `function f() { try { output.error('x'); } catch (e) { process.exit(1); } }`,
    );
    expect(v.length).toBe(1);
  });
});

// --- the actual guard over the shipped CLI -------------------------------

describe('CLI has no silent error→exit-0 sites', () => {
  test('every output.error() reaches a loud exit', () => {
    const root = join(import.meta.dir, '..', '..'); // -> src/
    const violations = srcFiles(root).flatMap((f) =>
      findViolations(f.slice(root.length - 3), readFileSync(f, 'utf-8')),
    );
    if (violations.length > 0) {
      const report = violations.map((v) => `  ${v.file}:${v.line}  ${v.snippet}`).join('\n');
      throw new Error(
        `Found ${violations.length} output.error() site(s) that can exit 0 after reporting.\n` +
          `Use output.fatal(message[, code]) so the exit cannot be forgotten:\n${report}`,
      );
    }
    expect(violations).toEqual([]);
  });
});
