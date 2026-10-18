import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// SPEC §4: the mock store is an external system. App code reaches it only over HTTP, and the
// store does not import app code.
const WEB = resolve(import.meta.dirname, "..");
const STORE = join(WEB, "app/api/store");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (n === "node_modules" || n === ".next") return [];
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

describe("mock store boundary (SPEC §4)", () => {
  it("no app file imports store code", () => {
    const appFiles = files(WEB).filter((f) => !f.startsWith(STORE));
    const bad = appFiles.filter((f) => /from\s+["'][^"']*api\/store[^"']*["']/.test(readFileSync(f, "utf8")));
    expect(bad.map((f) => relative(WEB, f))).toEqual([]);
  });
  it("store code imports nothing from the app's lib/", () => {
    const bad = files(STORE).filter((f) => /from\s+["'][^"']*\/lib\/[^"']*["']/.test(readFileSync(f, "utf8")));
    expect(bad.map((f) => relative(WEB, f))).toEqual([]);
  });
});
