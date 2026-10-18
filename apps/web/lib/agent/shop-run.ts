import { randomUUID } from "node:crypto";
import { sha256, type Contract, type Option, type ProductPage, type ProfileEntry, type ProgressEvent, type ReaderFacts, type StoreListing } from "@amasa/schemas";
import { readPage, sanitizeListing, scan, type PlannerListing } from "@amasa/reader";
import { getDb, type Db } from "../db/index.ts";
import { getContract } from "../db/contracts.ts";
import { saveOptions } from "../db/options.ts";
import { confirmedProfile } from "../db/profile.ts";
import { runLimits, type RunLimits } from "../env.ts";
import { ApiError } from "../http.ts";
import { STORE_PRICING } from "../merchants.ts";
import { fetchPage, searchListings } from "../store-client.ts";
import { buildOptions, compareTable, type Proposal } from "../shop/compare.ts";
import { buildDetails, otherSurvivors, type Checked } from "../shop/details.ts";
import { prefilter } from "../shop/prefilter.ts";
import { modelsFromEnv, type IntakeModel } from "./intake.ts";
import { createPlanner, PlannerError, type SurvivorForPlanner } from "./planner.ts";
import { RunBudget } from "./run-budget.ts";

// SPEC §7.4: one shopping run, streamed as ProgressEvents (§6). Every step text is written here,
// never by a model. Money and must-have decisions use store fields only.

export const MAX_CANDIDATES = 12;
const READ_CONCURRENCY = 4;
const PROGRESS_INTERVAL_MS = 500;

export const FLAG_REASONS = {
  listing: "The listing text contains instructions or links",
  review: "A review contains instructions to AI agents",
  description: "The product description contains instructions or links",
  reader: "The page tries to instruct AI shoppers",
  unreadable: "We couldn't read this product page",
} as const;

export type ShopDeps = {
  db: Db;
  models: { planner: IntakeModel; reader: IntakeModel };
  limits: RunLimits;
  store: {
    search: (query: string, category: Contract["category"], signal: AbortSignal) => Promise<unknown[]>;
    page: (sku: string, signal: AbortSignal) => Promise<ProductPage | null>;
  };
  now: () => number;
  log: (line: string) => void;
  runId: string;
  // Level 1/2 preparation (SPEC §5), injected by the route so this model-calling module never imports
  // money code. Called after the options are saved, before `done`.
  prepare?: (contract: Contract, options: readonly Option[], emit: (event: ProgressEvent) => void, signal: AbortSignal) => Promise<void>;
};

const ERROR_MESSAGES = {
  PLANNER_INVALID_SKU: "The shopping assistant picked a product that wasn't on the checked list, so the run was stopped.",
  PLANNER_FAILED: "The shopping assistant didn't finish choosing. Please try again.",
  RUN_BUDGET_EXCEEDED: "This search reached its usage limit before finishing. Please try again.",
  SHOP_FAILED: "Something went wrong while shopping. Please try again.",
} as const;

const plainQuery = (query: string) => query.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 60);

function configuredDeps(overrides: Partial<ShopDeps>): ShopDeps {
  let models = overrides.models;
  if (!models) {
    try {
      models = modelsFromEnv();
    } catch (error) {
      console.error(error instanceof Error ? error.message : "model configuration error");
      throw new ApiError(503, "MODEL_NOT_CONFIGURED", "Amasa can't shop right now. Please try again later.");
    }
  }
  return {
    db: overrides.db ?? getDb(),
    models,
    limits: overrides.limits ?? runLimits(),
    store: overrides.store ?? { search: searchListings, page: fetchPage },
    now: overrides.now ?? Date.now,
    log: overrides.log ?? ((line) => console.info(line)),
    runId: overrides.runId ?? randomUUID().slice(0, 8),
    ...(overrides.prepare ? { prepare: overrides.prepare } : {}),
  };
}

async function inPool<T>(items: readonly T[], size: number, signal: AbortSignal, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      signal.throwIfAborted();
      await work(items[next++]!);
    }
  }));
}

export async function runShop(contractId: string, emit: (event: ProgressEvent) => void, signal: AbortSignal,
  overrides: Partial<ShopDeps> = {}): Promise<void> {
  let deps: ShopDeps;
  try {
    deps = configuredDeps(overrides);
  } catch (error) {
    if (error instanceof ApiError) emit({ type: "error", code: error.code, message: error.message });
    else emit({ type: "error", code: "SHOP_FAILED", message: ERROR_MESSAGES.SHOP_FAILED });
    return;
  }
  const { db, models, store, log, runId } = deps;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal.addEventListener("abort", onAbort);
  if (signal.aborted) controller.abort();
  const run = controller.signal;
  const budget = new RunBudget(deps.limits, controller, log, runId);
  log(`shop ${runId} started contract ${contractId}`);

  try {
    // 1. The contract, checked against its stored hash, and the confirmed profile for its category.
    const stored = getContract(db, contractId);
    if (!stored) throw new ApiError(404, "CONTRACT_NOT_FOUND", "That contract was not found.");
    const { contract } = stored;
    if (sha256(contract) !== stored.contractHash) {
      throw new ApiError(409, "CONTRACT_TAMPERED", "This contract no longer matches what you confirmed. Please start again.");
    }
    const profile: ProfileEntry[] = confirmedProfile(db).filter((e) => e.category === contract.category || e.category === "all");
    emit({ type: "step", text: "Reading your contract" });

    // 2–3. Planner turn 1: searches, sanitized; the first 12 unique unflagged SKUs become candidates.
    const listings = new Map<string, StoreListing>();
    const order: string[] = [];
    const flagged = new Set<string>();
    const seen = new Set<string>();
    const flag = (sku: string, reason: string) => {
      if (flagged.has(sku)) return;
      flagged.add(sku);
      emit({ type: "flagged", sku, reason });
    };
    const planner = createPlanner(contract, profile, {
      model: models.planner, budget, signal: run,
      search: async ({ merchant, query }) => {
        emit({ type: "step", text: `Searching ${merchant} for "${plainQuery(query)}"` });
        const visible: PlannerListing[] = [];
        for (const raw of await store.search(query, contract.category, run)) {
          const result = sanitizeListing(raw);
          if (!result.ok) {
            if (result.sku) seen.add(result.sku);
            if (result.reason === "flagged" && result.sku) flag(result.sku, FLAG_REASONS.listing);
            continue;
          }
          seen.add(result.listing.sku);
          if (!listings.has(result.listing.sku)) {
            listings.set(result.listing.sku, { ...result.listing, sponsored: result.sponsored });
            order.push(result.listing.sku);
          }
          visible.push(result.listing);
        }
        return visible;
      },
    });
    await planner.search();
    const candidates = order.filter((sku) => !flagged.has(sku)).slice(0, MAX_CANDIDATES);
    emit({ type: "step", text: `Found ${seen.size} ${seen.size === 1 ? "product" : "products"}` });

    // 4. Pages: scanner, then the tool-less reader. Anything suspicious or unreadable is excluded.
    const checked = new Map<string, Checked>();
    let done = 0;
    let lastProgress = 0;
    const progress = () => {
      const now = Date.now();
      if (done === candidates.length || now - lastProgress >= PROGRESS_INTERVAL_MS) {
        lastProgress = now;
        emit({ type: "step", text: `Reading product pages (${done} of ${candidates.length})` });
      }
    };
    await inPool(candidates, READ_CONCURRENCY, run, async (sku) => {
      const page = await store.page(sku, run);
      let facts: ReaderFacts | null = null;
      if (!page) flag(sku, FLAG_REASONS.unreadable);
      else if (page.reviews.some((review) => scan(review.text).length)) flag(sku, FLAG_REASONS.review);
      else if (scan(page.description).length) flag(sku, FLAG_REASONS.description);
      else {
        const read = await readPage(page, { ...models.reader, signal: run });
        budget.addReaderTokens(sku, read.tokens);
        if (!read.ok) flag(sku, FLAG_REASONS.unreadable);
        else if (read.facts.injectionSuspected) flag(sku, FLAG_REASONS.reader);
        else facts = read.facts;
      }
      if (facts && page) {
        checked.set(sku, { listing: listings.get(sku)!, facts, reviewQuotes: page.reviews.slice(0, 2).map((r) => r.text.slice(0, 200)) });
      }
      done += 1;
      progress();
    });

    // 5. Deterministic prefilter on store fields, with the verifier's own rules.
    const readable = candidates.filter((sku) => checked.has(sku)).map((sku) => checked.get(sku)!);
    const { survivors, removed } = prefilter(contract, readable, STORE_PRICING, deps.now());
    emit({ type: "filtered", removed });
    emit({ type: "step", text: `Comparing ${survivors.length} ${survivors.length === 1 ? "product" : "products"} against your profile` });

    // 6. Planner turn 2 with store fields and typed reader facts only (no page text: I4).
    let proposals: Proposal[] = [];
    if (survivors.length) {
      const forPlanner: SurvivorForPlanner[] = survivors.map(({ listing, facts }) => {
        const { sponsored: _sponsored, ...visible } = listing;
        return { ...visible, readerFacts: { praise: facts.praise, complaints: facts.complaints } };
      });
      const seenOptions = new Set<string>();
      proposals = (await planner.propose(forPlanner)).filter((option) => {
        const key = JSON.stringify([...option.lines].sort((a, b) => a.sku.localeCompare(b.sku)).map((l) => [l.sku, l.qty]));
        const quantityOk = option.lines.reduce((sum, l) => sum + l.qty, 0) === contract.quantity;
        if (!quantityOk || seenOptions.has(key)) return false;
        seenOptions.add(key);
        return true;
      });
    }

    // 7–8. Code-written options, compare table and details; saved for /api/carts and /api/verify.
    const byListing = new Map([...checked.values()].map((c) => [c.listing.sku, c.listing] as const));
    const options = buildOptions(proposals, byListing, STORE_PRICING);
    saveOptions(db, contractId, options, [...flagged], new Date(deps.now()).toISOString());
    emit({
      type: "options", options, compare: compareTable(options, byListing, contract),
      details: buildDetails(contract, profile, options, checked),
      others: otherSurvivors(contract, options, survivors, STORE_PRICING),
    });
    if (deps.prepare) await deps.prepare(contract, options, emit, run);
    run.throwIfAborted();
    emit({ type: "done" });
    log(`shop ${runId} done options ${options.length} steps ${budget.steps} tokens ${budget.tokens}`);
  } catch (error) {
    if (budget.exceeded) {
      log(`shop ${runId} stopped: ${budget.exceeded} limit reached (steps ${budget.steps}, tokens ${budget.tokens})`);
      emit({ type: "error", code: "RUN_BUDGET_EXCEEDED", message: ERROR_MESSAGES.RUN_BUDGET_EXCEEDED });
    } else if (signal.aborted) {
      log(`shop ${runId} cancelled after ${budget.steps} planner steps`);
    } else if (error instanceof ApiError) {
      log(`shop ${runId} failed: ${error.code}`);
      emit({ type: "error", code: error.code, message: error.message });
    } else if (error instanceof PlannerError) {
      log(`shop ${runId} failed: ${error.code}`);
      emit({ type: "error", code: error.code, message: ERROR_MESSAGES[error.code] });
    } else {
      log(`shop ${runId} failed: ${error instanceof Error ? error.name : "unknown error"}`);
      emit({ type: "error", code: "SHOP_FAILED", message: ERROR_MESSAGES.SHOP_FAILED });
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    controller.abort();
  }
}
