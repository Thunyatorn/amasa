import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// The repo root is the folder holding pnpm-workspace.yaml (works from apps/web and from scripts).
export function repoRoot(start: string = process.cwd()): string {
  let dir = resolve(start);
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const up = dirname(dir);
    if (up === dir) throw new Error("Could not find the repo root (pnpm-workspace.yaml)");
    dir = up;
  }
  return dir;
}
