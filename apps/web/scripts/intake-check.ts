// M3 acceptance check against the live model (BUILD_ORDER M3). Makes two model calls.
// Run with `pnpm check:intake` after setting the model variables in apps/web/.env.local
// (anthropic: MODEL_PROVIDER, ANTHROPIC_API_KEY, MODEL_PLANNER; ollama: MODEL_PROVIDER,
// MODEL_PLANNER). It uses an empty profile, so every value comes from the goal itself.
import { modelFromEnv, runIntake } from "../lib/agent/intake.ts";

const today = new Date().toISOString().slice(0, 10);
const model = modelFromEnv();
let failed = false;

function check(label: string, ok: boolean): void {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failed = true;
}

async function run(goal: string) {
  console.log(`\nGoal: "${goal}"`);
  const result = await runIntake({ goal, profile: [], today }, model);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

const full = await run("an Oscar-winning actor, under 300 VU, must be refundable");
const has = (key: string, op: string, value: string) =>
  full.draft.mustHave.some((rule) => rule.key === key && rule.op === op && String(rule.value).toLowerCase() === value);
check("category is actors", full.draft.category === "actors");
check("budgetCapCents is 30000", full.draft.budgetCapCents === 30000);
check("oscar eq yes", has("oscar", "eq", "yes"));
check("minReturnDays is at least 14", full.draft.minReturnDays >= 14);

const noBudget = await run("an Oscar-winning actor, must be refundable");
check("budgetCapCents is null", noBudget.draft.budgetCapCents === null);
check("a question is asked", typeof noBudget.draft.question === "string" && noBudget.draft.question.length > 0);

console.log(failed ? "\ncheck:intake FAILED" : "\ncheck:intake passed");
process.exitCode = failed ? 1 : 0;
