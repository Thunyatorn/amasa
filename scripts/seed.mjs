import { spawnSync } from "node:child_process";

const result = spawnSync("pnpm", ["--filter", "web", "exec", "node", "--import", "tsx", "--input-type=module", "--eval",
  'import { getDb } from "./lib/db/index.ts"; import { seed } from "./scripts/seed.ts"; const db = getDb(); try { seed(db); } finally { db.close(); }'],
{ stdio: "inherit", cwd: new URL("..", import.meta.url) });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
