// pnpm redteam (SPEC §18): runs evals/src/redteam.ts with the web app's environment (verifier key
// and model settings from apps/web/.env.local). Arguments pass through, e.g. --case RT03 --agent naive.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync(process.execPath,
  ["--env-file-if-exists=../apps/web/.env.local", "--import", "tsx", "src/redteam.ts", ...process.argv.slice(2)],
  { cwd: join(root, "evals"), stdio: "inherit" });
process.exit(result.status ?? 1);
