// ─────────────────────────────────────────────────────────────
// RUCHI — store shape drift checker
// ─────────────────────────────────────────────────────────────
// Fails CI when the store's public shape and its consumers disagree:
//
//   1. a named import from `@/lib/store` is not actually exported
//   2. `RuchiState` declares a member the implementation never provides
//   3. the implementation provides a member `RuchiState` never declares
//   4. a member is declared/published twice
//   5. a screen or test reads a state member that `RuchiState` lacks
//      (`useRuchi((s) => s.x)`, `useRuchi.getState().x`, `const { x } = useRuchi()`,
//      or `const s = useRuchi.getState(); s.x`, with lexical shadowing respected)
//
// Optional interface members (`lastCookedAt?: number`) are NOT required in the
// initial-state object — TypeScript does not require them either.
//
// This is a fast AST pass (no type checking), so it pinpoints the drift in
// seconds and runs BEFORE `tsc` in CI. `tsc` remains the source of truth for
// types; this guard exists so a shape mismatch fails loudly with a precise
// ledger instead of a wall of TS2339s.
//
// Usage: node scripts/check-store-shape.mjs [--json]

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT_ARG = process.argv.find((a) => a.startsWith("--root="))?.slice("--root=".length);
const ROOT = ROOT_ARG ? resolve(ROOT_ARG) : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STORE_FILE = join(ROOT, "src", "lib", "store", "index.ts");
const STORE_MODULE = join(ROOT, "src", "lib", "store", "index");
const AS_JSON = process.argv.includes("--json");

const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "android", "ios", "out", "dist", "coverage"]);
const SOURCE_EXT = /\.(ts|tsx|mts|cts)$/;

const problems = [];

function problem(file, message) {
  problems.push({ file: relative(ROOT, file), message });
}

function parse(file) {
  const text = readFileSync(file, "utf8");
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function nameOf(node) {
  if (!node) return null;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isPrivateIdentifier(node)) return node.text;
  return null;
}

function hasExportModifier(node) {
  return Boolean(node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
}

/** Public names the store module exposes. */
function exportedNames(sf) {
  const names = new Set();
  for (const stmt of sf.statements) {
    if (ts.isExportDeclaration(stmt)) {
      if (!stmt.exportClause) {
        // `export * from ...` — nothing local to name.
        continue;
      }
      if (ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) names.add(el.name.text);
      }
      continue;
    }
    if (!hasExportModifier(stmt)) continue;

    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) names.add(decl.name.text);
        else if (ts.isObjectBindingPattern(decl.name) || ts.isArrayBindingPattern(decl.name)) {
          for (const el of decl.name.elements) {
            if (ts.isBindingElement(el) && ts.isIdentifier(el.name)) names.add(el.name.text);
          }
        }
      }
    } else if (
      ts.isFunctionDeclaration(stmt) ||
      ts.isClassDeclaration(stmt) ||
      ts.isInterfaceDeclaration(stmt) ||
      ts.isTypeAliasDeclaration(stmt) ||
      ts.isEnumDeclaration(stmt)
    ) {
      const name = nameOf(stmt.name);
      if (name) names.add(name);
    }
  }
  return names;
}

/** Member names of the single `interface RuchiState` declaration. */
function stateMembers(sf) {
  const members = [];
  for (const stmt of sf.statements) {
    if (!ts.isInterfaceDeclaration(stmt) || stmt.name.text !== "RuchiState") continue;
    for (const m of stmt.members) {
      const name = nameOf(m.name);
      if (name) {
        members.push({
          name,
          // `foo?: T` — TypeScript does not require optional properties to be
          // present, so the initial state may legitimately omit them.
          optional: Boolean(m.questionToken),
          line: sf.getLineAndCharacterOfPosition(m.name.getStart(sf)).line + 1,
        });
      }
    }
  }
  return members;
}

function objectKeys(objLiteral, sf) {
  const keys = [];
  for (const prop of objLiteral.properties) {
    const name = nameOf(prop.name);
    if (name) keys.push({ name, line: sf.getLineAndCharacterOfPosition(prop.name.getStart(sf)).line + 1 });
  }
  return keys;
}

/**
 * The store's initial-state object: the object literal returned by the
 * `(set, get) => ({ ... })` initializer inside `create<RuchiState>()(persist(...))`.
 */
function findImplementationObject(sf) {
  let found = null;
  const visit = (node) => {
    if (found) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "useRuchi" && node.initializer) {
      const obj = findStateObjectLiteral(node.initializer);
      if (obj) {
        found = obj;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function findStateObjectLiteral(node) {
  if (ts.isObjectLiteralExpression(node)) return node;
  if (ts.isParenthesizedExpression(node)) return findStateObjectLiteral(node.expression);
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return findStateObjectLiteral(node.body);
  if (ts.isCallExpression(node)) {
    for (const arg of node.arguments) {
      const hit = findStateObjectLiteral(arg);
      if (hit) return hit;
    }
  }
  return null;
}

/** Does this module specifier point at the store module? */
function resolvesToStore(spec, fromFile) {
  if (spec === "@/lib/store" || spec === "@/lib/store/index") return true;
  if (!spec.startsWith(".")) return false;
  const base = resolve(dirname(fromFile), spec).replace(/\.(ts|tsx|mts|cts)$/, "");
  return base === STORE_MODULE;
}

function walkSourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkSourceFiles(full, out);
    else if (SOURCE_EXT.test(entry) && !entry.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

/**
 * Members read off the store state, by pattern:
 *   useRuchi((s) => s.x) · useRuchi.getState().x · const { x } = useRuchi()[.getState()]
 *   const s = useRuchi.getState(); s.x
 *
 * The captured form is tracked with a lexical scope stack: a declaration binds
 * a name in its enclosing scope, a function parameter or any other declaration
 * shadows it as "other", and a property read resolves to the nearest binding.
 */
function consumedStateMembers(sf, localNames) {
  const consumed = [];

  // name → "state" | "other", one map per lexical scope
  const scopes = [new Map()];
  const declare = (name, kind) => scopes[scopes.length - 1].set(name, kind);
  const declareBinding = (name, kind) => {
    if (ts.isIdentifier(name)) {
      declare(name.text, kind);
    } else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
      for (const el of name.elements) {
        if (ts.isBindingElement(el) && ts.isIdentifier(el.name)) declare(el.name.text, "other");
      }
    }
  };
  const kindOf = (name) => {
    for (let i = scopes.length - 1; i >= 0; i--) {
      const kind = scopes[i].get(name);
      if (kind) return kind;
    }
    return null;
  };

  const collectFromSelector = (fn) => {
    const param = fn.parameters[0];
    if (!param || fn.parameters.length !== 1 || !ts.isIdentifier(param.name)) return;
    const pname = param.name.text;
    const visit = (node, nested) => {
      if (ts.isFunctionLike(node) && node !== fn) {
        ts.forEachChild(node, (c) => visit(c, true));
        return;
      }
      if (
        !nested &&
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === pname
      ) {
        consumed.push({ name: node.name.text, line: sf.getLineAndCharacterOfPosition(node.name.getStart(sf)).line + 1 });
      }
      ts.forEachChild(node, (c) => visit(c, nested));
    };
    visit(fn.body, false);
  };

  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && localNames.has(node.expression.text)) {
      const arg = node.arguments[0];
      if (arg && (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg))) collectFromSelector(arg);
    }

    // `<hook>.getState()`
    const isGetStateCall = (n) =>
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === "getState" &&
      ts.isIdentifier(n.expression.expression) &&
      localNames.has(n.expression.expression.text) &&
      n.arguments.length === 0;

    // `<hook>.getState().member`
    if (ts.isPropertyAccessExpression(node) && isGetStateCall(node.expression)) {
      consumed.push({ name: node.name.text, line: sf.getLineAndCharacterOfPosition(node.name.getStart(sf)).line + 1 });
    }

    // `const { a, b } = <hook>()` or `= <hook>.getState()`
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer) {
      const init = node.initializer;
      const fromHook =
        (ts.isCallExpression(init) && ts.isIdentifier(init.expression) && localNames.has(init.expression.text)) ||
        isGetStateCall(init);
      if (fromHook) {
        for (const el of node.name.elements) {
          if (!ts.isBindingElement(el)) continue;
          const name = el.propertyName ? nameOf(el.propertyName) : ts.isIdentifier(el.name) ? el.name.text : null;
          if (name) consumed.push({ name, line: sf.getLineAndCharacterOfPosition(el.getStart(sf)).line + 1 });
        }
      }
    }

    const isScope = ts.isFunctionLike(node) || ts.isBlock(node) || ts.isSourceFile(node);
    if (isScope) scopes.push(new Map());
    if (ts.isFunctionLike(node)) {
      for (const p of node.parameters) declareBinding(p.name, "other");
    }

    // `const s = <hook>.getState()` classifies `s` as store state for the
    // remainder of its scope; every other declaration shadows it as "other".
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const kind = isGetStateCall(node.initializer) ? "state" : "other";
      declareBinding(node.name, kind);
    }

    // `s.member` where `s` is a captured state object.
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && kindOf(node.expression.text) === "state") {
      consumed.push({ name: node.name.text, line: sf.getLineAndCharacterOfPosition(node.name.getStart(sf)).line + 1 });
    }

    ts.forEachChild(node, visit);
    if (isScope) scopes.pop();
  };
  visit(sf);
  return consumed;
}

function duplicateNames(entries) {
  const seen = new Map();
  const dupes = [];
  for (const e of entries) {
    if (seen.has(e.name)) dupes.push(e);
    else seen.set(e.name, e);
  }
  return dupes;
}

function main() {
  const started = performance.now();
  const storeSf = parse(STORE_FILE);
  const exports = exportedNames(storeSf);
  const declared = stateMembers(storeSf);
  const implObject = findImplementationObject(storeSf);

  if (declared.length === 0) problem(STORE_FILE, "no `interface RuchiState` declaration found");
  if (!implObject) problem(STORE_FILE, "could not locate the `useRuchi` initial-state object literal");

  for (const dup of duplicateNames(declared)) {
    problem(STORE_FILE, `RuchiState declares "${dup.name}" more than once (line ${dup.line})`);
  }

  const implemented = implObject ? objectKeys(implObject, storeSf) : [];
  for (const dup of duplicateNames(implemented)) {
    problem(STORE_FILE, `initial state publishes "${dup.name}" more than once (line ${dup.line})`);
  }

  const declaredNames = new Set(declared.map((m) => m.name));
  const implementedNames = new Set(implemented.map((m) => m.name));

  for (const m of declared) {
    if (m.optional) continue; // optional members may be omitted by design
    if (!implementedNames.has(m.name)) {
      problem(STORE_FILE, `RuchiState declares "${m.name}" but the implementation never provides it (line ${m.line})`);
    }
  }
  for (const m of implemented) {
    if (!declaredNames.has(m.name)) {
      problem(STORE_FILE, `implementation publishes "${m.name}" but RuchiState does not declare it (line ${m.line})`);
    }
  }

  const files = walkSourceFiles(ROOT);
  let importCount = 0;
  let consumptionCount = 0;

  for (const file of files) {
    const sf = parse(file);

    // ── named imports / re-exports from the store ──
    const hookLocals = new Set();
    for (const stmt of sf.statements) {
      let spec = null;
      let bindings = null;
      if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier) && stmt.importClause) {
        spec = stmt.moduleSpecifier.text;
        if (stmt.importClause.namedBindings && ts.isNamedImports(stmt.importClause.namedBindings)) {
          bindings = stmt.importClause.namedBindings.elements;
        }
      } else if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
        spec = stmt.moduleSpecifier.text;
        if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) bindings = stmt.exportClause.elements;
      }
      if (spec === null || !resolvesToStore(spec, file)) continue;

      for (const el of bindings ?? []) {
        const imported = nameOf(el.propertyName) ?? nameOf(el.name);
        if (!imported) continue;
        importCount++;
        if (!exports.has(imported)) {
          problem(file, `imports "${imported}" from "${spec}" but the store does not export it`);
        }
        if (imported === "useRuchi") hookLocals.add(el.name.text);
      }
    }

    // ── state members read by this file ──
    if (hookLocals.size > 0) {
      for (const used of consumedStateMembers(sf, hookLocals)) {
        consumptionCount++;
        if (!declaredNames.has(used.name)) {
          problem(file, `reads state member "${used.name}", which RuchiState does not declare (line ${used.line})`);
        }
      }
    }
  }

  const elapsed = Math.round(performance.now() - started);

  if (AS_JSON) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: problems.length === 0,
          exports: exports.size,
          stateMembers: declared.size,
          consumedMembers: consumptionCount,
          imports: importCount,
          files: files.length,
          elapsedMs: elapsed,
          problems,
        },
        null,
        2,
      ) + "\n",
    );
  } else {
    console.log("RUCHI store shape check");
    console.log(`  store module  : ${relative(ROOT, STORE_FILE)}`);
    console.log(`  exports       : ${exports.size}`);
    console.log(`  state members : ${declaredNames.size}`);
    console.log(`  consumers     : ${files.length} files, ${importCount} store imports, ${consumptionCount} state reads`);
    console.log(`  duration      : ${elapsed} ms`);
    console.log("");
    if (problems.length === 0) {
      console.log("✔ no drift detected — imports, RuchiState and the implementation agree");
    } else {
      console.log(`✖ ${problems.length} shape problem${problems.length === 1 ? "" : "s"}`);
      for (const p of problems) console.log(`  - ${p.file}: ${p.message}`);
    }
  }

  process.exit(problems.length === 0 ? 0 : 1);
}

main();
