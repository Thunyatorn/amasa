import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// SPEC §9.4: the money path never imports the AI SDK. Scans every .ts file in these folders.
const ROOT = resolve(import.meta.dirname, "../../..");
const DIRS = ["packages/verifier/src", "packages/schemas/src", "packages/audit/src", "services/payments/src"];
const SELF = resolve(import.meta.filename);

// The two patterns from §9.4, plus bare side-effect imports (`import "ai"`) and dynamic imports
// (`import("ai")`), which the §9.4 patterns alone would miss.
const MODEL_IMPORT = [
  /from\s+["'](ai|@ai-sdk\/[^"']+)["']/,
  /require\(["'](ai|@ai-sdk\/[^"']+)["']\)/,
  /import\s+["'](ai|@ai-sdk\/[^"']+)["']/,
  /import\(\s*["'](ai|@ai-sdk\/[^"']+)["']\s*\)/,
];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (p.endsWith(".ts") && resolve(p) !== SELF) out.push(p);
  }
  return out;
}

describe("no-model rule (SPEC §9.4)", () => {
  it("the patterns catch every import form", () => {
    for (const line of [
      'import { generateText } from "ai";', "import type { Tool } from 'ai';",
      'import "ai";', 'const m = await import("ai");', 'const ai = require("ai");',
      'import { anthropic } from "@ai-sdk/anthropic";',
    ]) expect(MODEL_IMPORT.some((p) => p.test(line)), line).toBe(true);
    for (const line of [
      'import { z } from "zod";', 'require("@visaacceptance/agent-toolkit/ai-sdk")',
      'import { x } from "./ai";', 'import { y } from "ai-helpers";',
    ]) expect(MODEL_IMPORT.some((p) => p.test(line)), line).toBe(false);
  });

  it("no money-path file imports ai or @ai-sdk/*", () => {
    const files = DIRS.flatMap((d) => tsFiles(join(ROOT, d)));
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter((f) => MODEL_IMPORT.some((p) => p.test(readFileSync(f, "utf8"))));
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });
});
