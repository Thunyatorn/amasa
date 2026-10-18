import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// Shared by the store's catalog and its market-price reader.

export class StoreNotReady extends Error {}

export function repoRootFrom(start: string = process.cwd()): string {
  let dir = resolve(start);
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const up = dirname(dir);
    if (up === dir) throw new Error("store: could not find the repo root");
    dir = up;
  }
  return dir;
}
