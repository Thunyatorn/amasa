import { spawnSync } from "node:child_process";

// pnpm seed            → groceries shows the level-1 offer (SPEC §17.3)
// pnpm seed -- level2  → groceries at level 1 shows the level-2 offer
const variant = process.argv[2] === "level2" ? "level2" : "default";
const result = spawnSync("pnpm", ["--filter", "web", "exec", "node", "--import", "tsx", "--input-type=module", "--eval",
  `import { getDb } from "./lib/db/index.ts"; import { seed } from "./scripts/seed.ts"; const db = getDb(); try { seed(db, ${JSON.stringify(variant)}); console.log("Seeded (${variant})."); } finally { db.close(); }`],
{ stdio: "inherit", cwd: new URL("..", import.meta.url) });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
