import { APICallError, generateText, Output, type LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { ContractDraft, ProfileEntry, Rule } from "@amasa/schemas";
import { z } from "zod";
import { modelEnv, type ModelEnv } from "../env.ts";
import { ApiError } from "../http.ts";
import { KNOWN_MERCHANTS } from "../merchants.ts";
import { isStoreRule, STORE_ATTRIBUTES } from "../store-attributes.ts";
import { INTAKE_SYSTEM_PROMPT } from "./prompts.ts";

export type { LanguageModel } from "ai";

// A draft plus the requirements from the goal that demo-store cannot check. They are never put
// in the contract, and the review screen must show every one of them (I2: no silent weakening).
export type IntakeResult = { draft: ContractDraft; unsupported: Rule[] };

// The model to call plus how to call it. timeoutMs and providerOptions differ per provider.
export type IntakeModel = {
  model: LanguageModel;
  timeoutMs?: number;
  providerOptions?: Parameters<typeof generateText>[0]["providerOptions"];
};

const IntakeInput = z.strictObject({
  goal: z.string().trim().min(3).max(300),
  profile: z.array(ProfileEntry),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const identity = (rule: Rule) => JSON.stringify([rule.key, rule.op, rule.value]);

// A deadline is kept only when the goal itself talks about timing. Models were seen copying the
// `today` date into `deadline` for goals with no date at all, which made every product miss it.
const TIME_WORDS = /\b(by|before|until|till|deadline|due|need(ed)? (it|them)|arrive|deliver(ed|y)?|today|tonight|tomorrow|week(end)?|month|days?|monday|tuesday|wednesday|thursday|friday|saturday|sunday|jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?|christmas|birthday)\b|\d{1,2}[/-]\d{1,2}|\d{4}-\d{2}-\d{2}/i;
export const mentionsTiming = (goal: string) => TIME_WORDS.test(goal);

// "Must be returnable" is already the contract's minReturnDays. A separate rule for it (models write
// e.g. returnable = yes) is redundant, so it is dropped when the return window is at least 14 days.
const RETURN_RULE = /^(returnable|returns?|return_policy|refundable)$/;

export function normalizeDraft(draft: ContractDraft, goal: string): IntakeResult {
  const input = ContractDraft.parse(draft);
  const parsed = { ...input, mustHave: input.mustHave.filter((rule) => !(RETURN_RULE.test(rule.key) && input.minReturnDays >= 14)) };
  const kept = new Map<string, Rule>();
  const unsupported = new Map<string, Rule>();
  for (const original of parsed.mustHave) {
    // The store lists shoe sizes in sizes_available. An exact size maps onto it; a size range
    // ("10 or larger") cannot be checked there, so it is reported instead of narrowed.
    const exactShoeSize = parsed.category === "running-shoes" && original.key === "size"
      && (original.op === "eq" || original.op === "includes");
    const rule: Rule = exactShoeSize
      ? { key: "sizes_available", op: "includes", value: String(original.value) }
      : original;
    if (isStoreRule(parsed.category, rule)) kept.set(identity(rule), rule);
    else unsupported.set(identity(original), original);
  }
  const { deadline, ...rest } = parsed;
  return {
    draft: ContractDraft.parse({
      ...rest, ...(deadline !== undefined && mentionsTiming(goal) ? { deadline } : {}),
      goal: goal.trim().slice(0, 300), allowedMerchants: [...KNOWN_MERCHANTS], mustHave: [...kept.values()],
    }),
    unsupported: [...unsupported.values()].slice(0, 8),
  };
}

// Server log line for a failed model call. Only the error's class name, plus the provider's own
// status and message for API errors: other error messages can quote model output, which may echo
// the user's goal.
export function describeIntakeError(error: unknown): string {
  if (APICallError.isInstance(error)) {
    return `APICallError status ${error.statusCode ?? "none"}: ${error.message.slice(0, 200)}`;
  }
  return error instanceof Error ? error.name : "unknown error";
}

export async function runIntake(
  input: { goal: string; profile: ProfileEntry[]; today: string },
  deps: IntakeModel,
): Promise<IntakeResult> {
  try {
    const { goal, profile, today } = IntakeInput.parse(input);
    const confirmedProfile = profile.map(({ category, key, value }) => ({ category, key, value }));
    const result = await generateText({
      model: deps.model,
      instructions: INTAKE_SYSTEM_PROMPT,
      prompt: JSON.stringify({ goal, today, allowedMerchants: [...KNOWN_MERCHANTS], confirmedProfile, storeAttributes: STORE_ATTRIBUTES }),
      output: Output.object({ schema: ContractDraft }),
      temperature: 0,
      maxOutputTokens: 800,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(deps.timeoutMs ?? 30_000),
      ...(deps.providerOptions ? { providerOptions: deps.providerOptions } : {}),
    });
    return normalizeDraft(result.output, goal);
  } catch (error) {
    console.error(`intake failed: ${describeIntakeError(error)}`);
    throw new ApiError(502, "INTAKE_FAILED", "I couldn't read that goal just now. Please try again.");
  }
}

function buildModel(config: ModelEnv, modelId: string): IntakeModel {
  if (config.MODEL_PROVIDER === "ollama") {
    return {
      // Ollama implements Chat Completions, not the Responses API, so .chat(). It ignores the key.
      model: createOpenAI({ baseURL: config.OLLAMA_BASE_URL, apiKey: "ollama" }).chat(modelId),
      // Thinking off: with it on, local models took minutes and returned no answer (M3 test).
      providerOptions: { openai: { reasoningEffort: "none" } },
      // Loading a multi-GB model into memory on the first call can take a while.
      timeoutMs: 90_000,
    };
  }
  return { model: createAnthropic({ apiKey: config.ANTHROPIC_API_KEY })(modelId), timeoutMs: 30_000 };
}

// Planner (also used by intake) and reader models from the environment.
export function modelsFromEnv(): { planner: IntakeModel; reader: IntakeModel } {
  const config = modelEnv();
  return { planner: buildModel(config, config.MODEL_PLANNER), reader: buildModel(config, config.MODEL_READER ?? config.MODEL_PLANNER) };
}

export function modelFromEnv(): IntakeModel {
  return modelsFromEnv().planner;
}
