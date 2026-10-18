// ─────────────────────────────────────────────────────────────
// RUCHI — regression tests for scripts/check-store-shape.mjs
// ─────────────────────────────────────────────────────────────
// The checker has no in-process API: it is a CLI that reads a repository
// root. These tests build a miniature repo in a temp directory (a store
// module plus one consumer), run the real script with `--root=`, and assert
// on its exit status and ledger. That exercises the shipped code path rather
// than a reimplementation of it.
//
// Covered:
//   • optional RuchiState members may be absent from the initial state
//   • required members are still required
//   • `const s = useRuchi.getState(); s.x` is checked (valid + undeclared)
//   • lexical shadowing (parameter, inner const) is respected

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CHECKER = fileURLToPath(new URL("../../../../scripts/check-store-shape.mjs", import.meta.url));

const storeSource = (members: string, initial: string) => `interface RuchiState {
${members}
}

export const useRuchi = {
${initial}
};
`;

const CONSUMER = `import { useRuchi } from "@/lib/store";

export function readCount(): number {
  const s = useRuchi.getState();
  return s.count;
}
`;

type Run = { status: number; output: string };

function runChecker(files: Record<string, string>): Run {
  const root = mkdtempSync(join(tmpdir(), "ruchi-shape-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = join(root, rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content, "utf8");
    }
    try {
      const stdout = execFileSync(process.execPath, [CHECKER, `--root=${root}`], {
        encoding: "utf8",
        stdio: "pipe",
      });
      return { status: 0, output: stdout };
    } catch (error) {
      const failure = error as { status?: number; stdout?: string; stderr?: string };
      return {
        status: failure.status ?? 1,
        output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
      };
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const base = (members: string, initial: string, consumer = CONSUMER) => ({
  "src/lib/store/index.ts": storeSource(members, initial),
  "src/consumer.ts": consumer,
});

describe("optional RuchiState members", () => {
  it("may be omitted from the initial state without a false positive", () => {
    const run = runChecker(
      base(
        "  count: number;\n  lastCookedAt?: number;\n  cloudSyncAt?: number;",
        "  count: 0,",
      ),
    );
    expect(run.output).toContain("no drift detected");
    expect(run.status).toBe(0);
  });

  it("required members are still required", () => {
    const run = runChecker(base("  count: number;\n  syncError: boolean;", "  count: 0,"));
    expect(run.status).toBe(1);
    expect(run.output).toContain('declares "syncError" but the implementation never provides it');
  });
});

describe("captured getState() reads", () => {
  it("accepts a declared member read through a captured state object", () => {
    const run = runChecker(base("  count: number;", "  count: 0,"));
    expect(run.output).toContain("no drift detected");
    expect(run.status).toBe(0);
  });

  it("reports an undeclared member with file and line", () => {
    const consumer = `import { useRuchi } from "@/lib/store";

export function read(): number {
  const s = useRuchi.getState();
  return s.missing;
}
`;
    const run = runChecker(base("  count: number;", "  count: 0,", consumer));
    expect(run.status).toBe(1);
    expect(run.output).toContain('src/consumer.ts: reads state member "missing"');
    expect(run.output).toMatch(/src\/consumer\.ts: reads state member "missing".*line 5/);
  });

  it("does not apply the outer classification to a shadowing parameter", () => {
    const consumer = `import { useRuchi } from "@/lib/store";

const s = useRuchi.getState();

export function pick(s: { missing: number }): number {
  return s.missing;
}
`;
    const run = runChecker(base("  count: number;", "  count: 0,", consumer));
    expect(run.output).toContain("no drift detected");
    expect(run.status).toBe(0);
  });

  it("does not apply the outer classification to a shadowing inner const", () => {
    const consumer = `import { useRuchi } from "@/lib/store";

const s = useRuchi.getState();

export function pick(): number {
  const s = { missing: 1 };
  return s.missing;
}
`;
    const run = runChecker(base("  count: number;", "  count: 0,", consumer));
    expect(run.output).toContain("no drift detected");
    expect(run.status).toBe(0);
  });

  it("still checks the outer variable after a nested scope closes", () => {
    const consumer = `import { useRuchi } from "@/lib/store";

const s = useRuchi.getState();

export function pick(): number {
  const inner = { missing: 1 };
  return inner.missing + s.missing;
}
`;
    const run = runChecker(base("  count: number;", "  count: 0,", consumer));
    expect(run.status).toBe(1);
    expect(run.output).toContain('reads state member "missing"');
  });
});
