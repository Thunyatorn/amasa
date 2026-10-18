import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Contract, type ProgressEvent } from "@amasa/schemas";
import { modelEnv } from "../../apps/web/lib/env.ts";
import { modelsFromEnv } from "../../apps/web/lib/agent/intake.ts";
import { runAmasaCase } from "./amasa-agent.ts";
import { NAIVE_READER_INSTRUCTIONS, runNaiveAgent } from "./naive-agent.ts";
import { CONTRACT_DRAFT, caseCatalog, editedContract, loadCases, REPO, type RedTeamCase } from "./overlay.ts";
import { buildReaderSection, buildReport, withReaderSection, type CaseResult } from "./report.ts";
import { scoreRun, type AgentName, type AgentRun } from "./score.ts";
import { startEvalStore, type EvalStore } from "./store-server.ts";

// pnpm redteam [--case RT03[,RT05]] [--agent amasa|naive|naive-reader] (SPEC §18). Runs every case
// against Amasa and the SPEC baseline and prints the §18.3 table; a full run writes
// docs/REDTEAM_RESULTS.md. `--agent naive-reader` over all cases updates that file's second-baseline section.

function parseArgs(argv: readonly string[]): { cases: string[] | null; agents: AgentName[] } {
  let cases: string[] | null = null;
  let agents: AgentName[] = ["amasa", "naive"];
  const args = argv.filter((a) => a !== "--");
  for (let i = 0; i < args.length; i++) {
    const value = args[i + 1];
    if (args[i] === "--case" && value) { cases = [...(cases ?? []), ...value.toUpperCase().split(",")]; i++; }
    else if (args[i] === "--agent" && (value === "amasa" || value === "naive" || value === "naive-reader")) { agents = [value]; i++; }
    else throw new Error(`Unknown argument ${args[i]}. Use --case RT01[,RT02] and/or --agent amasa|naive|naive-reader.`);
  }
  return { cases, agents };
}

// Every host the run sends a request to (RT05: nothing may reach the attacker's host).
function trackHosts(): { hosts: Set<string>; stop: () => void } {
  const original = globalThis.fetch;
  const hosts = new Set<string>();
  globalThis.fetch = (input, init) => {
    try { hosts.add(new URL(input instanceof Request ? input.url : String(input)).hostname); } catch { /* not a URL */ }
    return original(input, init);
  };
  return { hosts, stop: () => { globalThis.fetch = original; } };
}

const storeSlice = (store: EvalStore, from: number) => {
  const entries = store.log.slice(from);
  return {
    searchedSkus: [...new Set(entries.filter((e) => e.kind === "search").flatMap((e) => e.skus))],
    pageSkus: [...new Set(entries.filter((e) => e.kind === "page").flatMap((e) => e.skus))],
  };
};

const ofType = <T extends ProgressEvent["type"]>(events: ProgressEvent[], type: T) =>
  events.filter((e): e is Extract<ProgressEvent, { type: T }> => e.type === type);

async function runAmasa(c: RedTeamCase, store: EvalStore, models: ReturnType<typeof modelsFromEnv>): Promise<{ run: AgentRun; original: Contract }> {
  const from = store.log.length;
  const tracker = trackHosts();
  try {
    const out = await runAmasaCase(c, CONTRACT_DRAFT, models);
    const options = ofType(out.events, "options")[0];
    return {
      original: out.contract,
      run: {
        agent: "amasa", caseId: c.id, paidLines: out.paidLines, secondsToPay: out.secondsToPay, paymentLinkUrl: out.paymentLinkUrl,
        flagged: ofType(out.events, "flagged").map(({ sku, reason }) => ({ sku, reason })),
        optionSkus: [...new Set(options?.options.flatMap((o) => o.lines.map((l) => l.sku)) ?? [])],
        otherSkus: options?.others.map((o) => o.sku) ?? [],
        filtered: ofType(out.events, "filtered").flatMap((e) => e.removed),
        ...storeSlice(store, from), verdictCodes: out.verdictCodes, hosts: [...tracker.hosts], error: out.error,
      },
    };
  } finally {
    tracker.stop();
  }
}

async function runNaive(c: RedTeamCase, store: EvalStore, models: ReturnType<typeof modelsFromEnv>, original: Contract,
  agent: "naive" | "naive-reader"): Promise<AgentRun> {
  const from = store.log.length;
  const tracker = trackHosts();
  const started = Date.now();
  try {
    // RT10: the naive agent keeps no record of what the user confirmed, so it simply receives the
    // edited contract. It is still scored against the original.
    const given = c.contractEdit ? editedContract(original, c.contractEdit) : original;
    const out = await runNaiveAgent(given, { model: models.planner, storeUrl: store.url,
      ...(agent === "naive-reader" ? { instructions: NAIVE_READER_INSTRUCTIONS } : {}) });
    const first = out.payCalls[0];
    return {
      agent, caseId: c.id, paidLines: out.payCalls.length ? out.payCalls.flatMap((p) => p.lines) : null,
      secondsToPay: first ? (first.at - started) / 1000 : null, paymentLinkUrl: null, flagged: [], optionSkus: [], otherSkus: [], filtered: [],
      ...storeSlice(store, from), verdictCodes: [], hosts: [...tracker.hosts],
      error: out.error ?? (out.payCalls.length ? null : `no pay call after ${out.steps} steps`),
    };
  } finally {
    tracker.stop();
  }
}

async function main(): Promise<void> {
  const { cases: only, agents } = parseArgs(process.argv.slice(2));
  const cases = loadCases().filter((c) => !only || only.includes(c.id));
  if (!cases.length) throw new Error(`No red-team case matches ${only?.join(", ")}.`);

  // Amasa runs with its own database and the eval store; both are read lazily, so set them first.
  const store = await startEvalStore(caseCatalog(null));
  process.env.STORE_BASE_URL = store.url;
  process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "amasa-redteam-")), "redteam.db");
  const config = modelEnv();
  const models = modelsFromEnv();
  const modelText = `${config.MODEL_PROVIDER}, planner \`${config.MODEL_PLANNER}\`, reader \`${config.MODEL_READER ?? config.MODEL_PLANNER}\``;
  if (agents.includes("amasa")) {
    const payments = process.env.PAYMENTS_URL || "http://127.0.0.1:4100";
    const ok = await fetch(`${payments}/health`).then((r) => r.ok, () => false);
    if (!ok) throw new Error(`The payments service is not running at ${payments}. Start it with: pnpm --filter payments dev`);
  }
  console.log(`pnpm redteam: ${cases.length} case(s), agents: ${agents.join(" + ")}, models: ${modelText}`);
  console.log(`store ${store.url}, database ${process.env.DATABASE_PATH}\n`);

  const results: CaseResult[] = [];
  const started = Date.now();
  const at = () => `${((Date.now() - started) / 1000).toFixed(0)}s`.padStart(6);
  try {
    for (const c of cases) {
      const catalog = caseCatalog(c);
      store.setCatalog(catalog);
      const result: CaseResult = { redTeamCase: c, catalog, runs: {} };
      const { question: _question, ...terms } = CONTRACT_DRAFT;
      let original = Contract.parse({ ...terms, id: randomUUID(), confirmedAt: new Date().toISOString() });
      console.log(`${at()}  ${c.id}  ${c.attack} (${c.where})`);
      if (agents.includes("amasa")) {
        const amasa = await runAmasa(c, store, models);
        original = amasa.original;
        result.runs.amasa = { run: amasa.run, score: scoreRun(c, amasa.run, original, catalog, Date.now()) };
        const s = result.runs.amasa.score;
        console.log(`${at()}        amasa: ${s.attackSucceeded ? "ATTACK SUCCEEDED" : "attack failed"}, ${s.taskSucceeded ? "task done" : "task not done"}, defense ${s.defense}` +
          `${amasa.run.paymentLinkUrl ? `, link ${amasa.run.paymentLinkUrl.slice(0, 60)}…` : ""}${amasa.run.error ? `, ${amasa.run.error}` : ""}`);
      }
      for (const agent of (["naive", "naive-reader"] as const).filter((a) => agents.includes(a))) {
        const run = await runNaive(c, store, models, original, agent);
        const entry = { run, score: scoreRun(c, run, original, catalog, Date.now()) };
        result.runs[agent] = entry;
        const s = entry.score;
        console.log(`${at()}        ${agent}: ${s.attackSucceeded ? "ATTACK SUCCEEDED" : "attack failed"}, ${s.taskSucceeded ? "task done" : "task not done"}` +
          `${run.paidLines ? `, paid ${run.paidLines.map((l) => l.sku).join(" + ")}` : ""}, read ${run.pageSkus.length} page(s): ${run.pageSkus.join(" ") || "none"}` +
          `${run.error ? `, ${run.error}` : ""}`);
      }
      results.push(result);
    }
  } finally {
    await store.close();
  }

  const full = !only && agents.length === 2;
  const report = buildReport(results, { date: new Date().toISOString().slice(0, 10), models: modelText, full });
  console.log(`\n${report}`);
  const file = join(REPO, "docs", "REDTEAM_RESULTS.md");
  if (full) {
    // Keep a second-baseline section from an earlier run; the rest is this run's report.
    const previous = existsSync(file) ? readFileSync(file, "utf8") : "";
    const kept = /<!-- page-reading baseline: start -->[\s\S]*<!-- page-reading baseline: end -->/.exec(previous)?.[0];
    writeFileSync(file, kept ? withReaderSection(report, kept) : report);
    console.log("Saved docs/REDTEAM_RESULTS.md");
  } else if (!only && agents.length === 1 && agents[0] === "naive-reader") {
    const section = buildReaderSection(results, { date: new Date().toISOString().slice(0, 10), models: modelText });
    writeFileSync(file, withReaderSection(existsSync(file) ? readFileSync(file, "utf8") : "", section));
    console.log(`\n${section}\nSaved the second-baseline section of docs/REDTEAM_RESULTS.md`);
  }
}

main().catch((error: unknown) => {
  console.error(`\npnpm redteam failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
