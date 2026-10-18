import { generateText, isStepCount, tool, type ModelMessage } from "ai";
import { z } from "zod";
import { Sku, type Contract, type ProfileEntry, type ReaderFacts } from "@amasa/schemas";
import type { PlannerListing } from "@amasa/reader";
import type { Proposal } from "../shop/compare.ts";
import type { IntakeModel } from "./intake.ts";
import { PLANNER_SYSTEM_PROMPT } from "./prompts.ts";
import type { RunBudget } from "./run-budget.ts";

// SPEC §7.2: the planner has exactly two tools and never sees page text (I4). Turn 1 may only
// search; turn 2 may only propose, and only SKUs that survived every check.
export const MAX_SEARCHES = 3;

// Code-written reminder for turn 2 when a model answers in prose instead of calling proposeCart.
// It adds no new rule: the §7.2 system prompt already says to call proposeCart with the candidates.
export const PROPOSE_REMINDER = "Call proposeCart now with at most 3 options using only SKUs from the candidate list, or with an empty options list if none fits.";

export type SurvivorForPlanner = PlannerListing & { readerFacts: Pick<ReaderFacts, "fitNotes" | "praise" | "complaints"> };

export class PlannerError extends Error {
  constructor(readonly code: "PLANNER_INVALID_SKU" | "PLANNER_FAILED") {
    super(code);
  }
}

export type PlannerContext = {
  model: IntakeModel;
  budget: RunBudget;
  signal: AbortSignal;
  // Runs one search against the store, sanitizes the results and reports progress.
  search: (input: { merchant: string; query: string }) => Promise<PlannerListing[]>;
};

type StepSummaryInput = {
  usage: Parameters<RunBudget["addPlannerStep"]>[0];
  toolCalls: ReadonlyArray<{ toolName: string }>;
  content: ReadonlyArray<{ type: string; error?: unknown }>;
  text: string;
  finishReason: string;
};

// For the server log: which tools were called, which tool errors happened (class names only) and how
// much text came back. No model or store text is logged.
function stepSummary(step: StepSummaryInput): string {
  const calls = step.toolCalls.map((call) => call.toolName).join(",") || "none";
  const errors = step.content.filter((part) => part.type === "tool-error")
    .map((part) => {
      const name = (part.error as { name?: unknown } | null)?.name;
      return typeof name === "string" ? name : "error";
    }).join(",") || "none";
  return `finish=${step.finishReason} calls=${calls} toolErrors=${errors} textChars=${step.text.length}`;
}

export function createPlanner(contract: Contract, profile: readonly ProfileEntry[], ctx: PlannerContext) {
  let searches = 0;
  let allowedSkus: ReadonlySet<string> | null = null;
  let proposal: Proposal[] | null = null;
  let invalidSku = false;

  const tools = {
    searchCatalog: tool({
      description: "Search a store in the contract for products in the contract's category. Returns product listings as JSON data.",
      inputSchema: z.strictObject({
        merchant: z.enum(contract.allowedMerchants as [string, ...string[]]),
        query: z.string().trim().min(1).max(80),
        category: z.enum([contract.category]),
      }),
      execute: async ({ merchant, query }) => {
        if (searches >= MAX_SEARCHES) return { error: "Search limit reached." };
        searches += 1;
        return { listings: await ctx.search({ merchant, query }) };
      },
    }),
    proposeCart: tool({
      description: "Propose up to 3 options, best first, using only SKUs from the candidate list.",
      inputSchema: z.strictObject({
        options: z.array(z.strictObject({
          lines: z.array(z.strictObject({ sku: Sku, qty: z.number().int().min(1).max(10) })).min(1).max(5),
          reason: z.string().max(400),
        })).max(3),
      }),
      execute: async ({ options }) => {
        if (!allowedSkus) return { error: "No candidate list yet." };
        const known = allowedSkus;
        if (options.some((option) => option.lines.some((line) => !known.has(line.sku)))) {
          invalidSku = true;
          return { error: "A SKU is not in the candidate list." };
        }
        proposal = options;
        return { ok: true };
      },
    }),
  };

  const messages: ModelMessage[] = [{
    role: "user",
    content: JSON.stringify({ contract, confirmedProfile: profile.map(({ category, key, value }) => ({ category, key, value })) }),
  }];

  const common = () => ({
    model: ctx.model.model,
    instructions: PLANNER_SYSTEM_PROMPT,
    tools,
    temperature: 0,
    maxOutputTokens: 1200,
    maxRetries: 1,
    abortSignal: AbortSignal.any([ctx.signal, AbortSignal.timeout((ctx.model.timeoutMs ?? 30_000) * 3)]),
    ...(ctx.model.providerOptions ? { providerOptions: ctx.model.providerOptions } : {}),
    onStepEnd: (step: StepSummaryInput) => ctx.budget.addPlannerStep(step.usage, stepSummary(step)),
  });

  return {
    get searchCount() { return searches; },

    // Turn 1 (SPEC §7.4 step 2). Leaves at least one step of the budget for turn 2.
    async search(): Promise<void> {
      const steps = ctx.budget.stepsLeft() - 1;
      if (steps < 1) throw new PlannerError("PLANNER_FAILED");
      // Turn 1 ends after 3 searches, or as soon as a step makes no search call (models tend to try
      // proposeCart before they have candidates, which only wastes steps).
      const result = await generateText({
        ...common(), messages, activeTools: ["searchCatalog"],
        stopWhen: [() => searches >= MAX_SEARCHES,
          ({ steps: done }) => !(done.at(-1)?.toolCalls ?? []).some((call) => call.toolName === "searchCatalog"),
          isStepCount(steps)],
      });
      messages.push(...result.responseMessages);
    },

    // Turn 2 (SPEC §7.4 step 6). Survivors carry store fields and typed reader facts only.
    async propose(survivors: readonly SurvivorForPlanner[]): Promise<Proposal[]> {
      if (ctx.budget.stepsLeft() < 1) throw new PlannerError("PLANNER_FAILED");
      allowedSkus = new Set(survivors.map((s) => s.sku));
      messages.push({ role: "user", content: JSON.stringify({ candidates: survivors }) });
      // Stop on a proposal that passed the schema (or an unknown SKU, which ends the run). A malformed
      // proposeCart call is returned to the model as a tool error so it can correct the shape. If the
      // model answers in prose instead, it gets one reminder. All of it stays within MAX_STEPS.
      for (let attempt = 0; attempt < 2 && proposal === null && !invalidSku; attempt += 1) {
        const steps = ctx.budget.stepsLeft();
        if (steps < 1) break;
        if (attempt === 1) messages.push({ role: "user", content: PROPOSE_REMINDER });
        const result = await generateText({
          ...common(), messages, activeTools: ["proposeCart"],
          stopWhen: [() => proposal !== null || invalidSku, isStepCount(steps)],
        });
        messages.push(...result.responseMessages);
      }
      if (invalidSku) throw new PlannerError("PLANNER_INVALID_SKU");
      if (!proposal) throw new PlannerError("PLANNER_FAILED");
      return proposal;
    },

    // For tests: everything the planner has been sent so far.
    transcript: (): readonly ModelMessage[] => messages,
  };
}
