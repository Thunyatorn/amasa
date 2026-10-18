import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { Category, type ContractDraft, type ProfileEntry } from "@amasa/schemas";
import { ApiError } from "../http.ts";
import { repoRoot } from "../paths.ts";
import Database from "better-sqlite3";
import { migrate, openDb } from "../db/index.ts";
import { deleteDraft, getDraft, getDraftRecord } from "../db/drafts.ts";
import { listProfileEntries } from "../db/profile.ts";
import { intakeStage } from "./intake-stage.ts";
import { INTAKE_SYSTEM_PROMPT, PLANNER_SYSTEM_PROMPT } from "./prompts.ts";
import { STORE_ATTRIBUTES } from "../store-attributes.ts";
import { describeIntakeError, mentionsTiming, normalizeDraft, runIntake } from "./intake.ts";

const goal = "wide running shoes for a half marathon, size 10.5, under $140, must be returnable";
const draft: ContractDraft = {
  category: "running-shoes", goal: "model copy", quantity: 1, budgetCapCents: 14000,
  mustHave: [{ key: "width", op: "eq", value: "wide" }, { key: "size", op: "eq", value: 10.5 }],
  allowedMerchants: ["untrusted-store"], minReturnDays: 14, question: null,
};
const input = { goal, profile: [], today: "2026-10-17" };
function modelReply(text = JSON.stringify(draft)) {
  return new MockLanguageModelV4({ doGenerate: async () => ({
    content: [{ type: "text", text }], finishReason: { unified: "stop", raw: undefined },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 20, text: 20, reasoning: undefined },
    }, warnings: [],
  }) });
}
function userMessage(model: MockLanguageModelV4) {
  const message = model.doGenerateCalls[0]!.prompt.find((message) => message.role === "user")!;
  if (message.role !== "user") throw new Error("missing user message");
  const content = message.content[0]!;
  if (content.type !== "text") throw new Error("missing text");
  return JSON.parse(content.text);
}

afterEach(() => vi.restoreAllMocks());

describe("intake model boundary", () => {
  it("keeps the prompt exactly equal to SPEC §7.1", () => {
    const spec = readFileSync(join(repoRoot(), "docs/SPEC.md"), "utf8");
    const block = spec.split("### §7.1 Intake (stage 1)")[1]!.split("```text\n")[1]!.split("\n```")[0];
    expect(INTAKE_SYSTEM_PROMPT).toBe(block);
  });

  it("keeps the planner prompt exactly equal to SPEC §7.2", () => {
    const spec = readFileSync(join(repoRoot(), "docs/SPEC.md"), "utf8");
    const block = spec.split("### §7.2 Planner (stages 2 and 5)")[1]!.split("```text\n")[1]!.split("\n```")[0];
    expect(PLANNER_SYSTEM_PROMPT).toBe(block);
  });

  it("describes exactly the attributes present in the store for every category", () => {
    const data = JSON.parse(readFileSync(join(repoRoot(), "data/products.json"), "utf8")) as {
      products: { listing: { category: string; attributes: Record<string, unknown> } }[];
    };
    for (const category of Category.options) {
      const keys = new Set(data.products.filter(({ listing }) => listing.category === category).flatMap(({ listing }) => Object.keys(listing.attributes)));
      expect(Object.keys(STORE_ATTRIBUTES[category]).sort()).toEqual([...keys].sort());
    }
  });

  it("normalizes sizes, merchants and the user's original goal", async () => {
    const { draft: result, unsupported } = await runIntake({ ...input, goal: `  ${goal}  ` }, { model: modelReply() });
    expect(result).toMatchObject({ budgetCapCents: 14000, goal, allowedMerchants: ["demo-store"] });
    expect(result.mustHave).toEqual([{ key: "width", op: "eq", value: "wide" }, { key: "sizes_available", op: "includes", value: "10.5" }]);
    expect(result.minReturnDays).toBeGreaterThanOrEqual(14);
    expect(unsupported).toEqual([]);
  });

  it("preserves missing budgets and the model's question", async () => {
    const { draft: result } = await runIntake(input, { model: modelReply(JSON.stringify({ ...draft, budgetCapCents: null, question: "What is your budget?" })) });
    expect(result.budgetCapCents).toBeNull();
    expect(result.question).toBe("What is your budget?");
  });

  it("moves rules the store can't check out of the contract, reports each one, and deduplicates", () => {
    const magic = { key: "magic", op: "eq" as const, value: "yes" };
    const result = normalizeDraft({ ...draft, mustHave: [...draft.mustHave, draft.mustHave[0]!, { key: "sizes_available", op: "includes", value: "10.5" }, magic, magic] }, goal);
    expect(result.draft.mustHave).toEqual([{ key: "width", op: "eq", value: "wide" }, { key: "sizes_available", op: "includes", value: "10.5" }]);
    expect(result.unsupported).toEqual([magic]);
    expect(result.draft.question).toBeNull();
    expect(normalizeDraft(draft, "x".repeat(350)).draft.goal).toHaveLength(300);
  });

  it("still reports unsupported rules when the model already asked a question", () => {
    const color = { key: "color", op: "eq" as const, value: "red" };
    const result = normalizeDraft({ ...draft, question: "What is your budget?", mustHave: [...draft.mustHave, color] }, goal);
    expect(result.draft.question).toBe("What is your budget?");
    expect(result.unsupported).toEqual([color]);
    expect(result.draft.mustHave.some((rule) => rule.key === "color")).toBe(false);
  });

  it("drops a separate 'returnable' rule when the contract already has a return window of at least 14 days", () => {
    const returnable = { key: "returnable", op: "eq" as const, value: "yes" };
    expect(normalizeDraft({ ...draft, mustHave: [...draft.mustHave, returnable] }, goal)).toMatchObject({ unsupported: [] });
    expect(normalizeDraft({ ...draft, mustHave: [...draft.mustHave, returnable] }, goal).draft.mustHave.some((r) => r.key === "returnable")).toBe(false);
    expect(normalizeDraft({ ...draft, minReturnDays: 0, mustHave: [returnable] }, goal).unsupported).toEqual([returnable]);
  });

  it("drops a deadline the goal never asked for, and keeps one it did", () => {
    expect(normalizeDraft({ ...draft, deadline: "2026-10-18" }, goal).draft).not.toHaveProperty("deadline");
    for (const timed of ["wide shoes by Friday, under $140", "running shoes before 10/25", "shoes, need them next week", "shoes delivered in 3 days", "shoes by 2026-10-30"]) {
      expect(normalizeDraft({ ...draft, deadline: "2026-10-30" }, timed).draft.deadline).toBe("2026-10-30");
    }
    expect(mentionsTiming("Running shoes for a half marathon, under $140, must be returnable")).toBe(false);
  });

  it("maps only exact shoe sizes; a size range is reported instead of narrowed to one size", () => {
    expect(normalizeDraft({ ...draft, mustHave: [{ key: "size", op: "includes", value: "11" }] }, goal).draft.mustHave)
      .toEqual([{ key: "sizes_available", op: "includes", value: "11" }]);
    for (const op of ["gte", "lte"] as const) {
      const range = { key: "size", op, value: 10 };
      const result = normalizeDraft({ ...draft, mustHave: [range] }, goal);
      expect(result.draft.mustHave).toEqual([]);
      expect(result.unsupported).toEqual([range]);
    }
  });

  it.each(["throw", "invalid-json", "schema", "unknown-field", "timeout"])("sanitizes %s failures", async (failure) => {
    const model = failure === "throw" || failure === "timeout"
      ? new MockLanguageModelV4({ doGenerate: async () => { throw failure === "timeout" ? new DOMException(goal, "TimeoutError") : new Error(`${failure}: ${goal}`); } })
      : modelReply(failure === "invalid-json" ? "{" : JSON.stringify(failure === "schema" ? { ...draft, quantity: 0 } : { ...draft, injected: goal }));
    const error = await runIntake(input, { model }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 502, code: "INTAKE_FAILED", message: "I couldn't read that goal just now. Please try again." });
    expect((error as Error).message).not.toContain(goal);
  });

  it("logs why intake failed without the goal or model output", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await runIntake(input, { model: new MockLanguageModelV4({ doGenerate: async () => { throw new Error(`boom ${goal}`); } }) }).catch(() => {});
    await runIntake(input, { model: modelReply(JSON.stringify({ ...draft, goal: undefined, injected: goal })) }).catch(() => {});
    expect(log).toHaveBeenCalledTimes(2);
    for (const [line] of log.mock.calls) {
      expect(String(line)).toMatch(/^intake failed: /);
      expect(String(line)).not.toContain(goal);
      expect(String(line)).not.toContain("half marathon");
    }
    const apiError = new APICallError({ message: "model: claude-nope not found", url: "https://api.anthropic.com/v1/messages", requestBodyValues: { goal }, statusCode: 404 });
    expect(describeIntakeError(apiError)).toBe("APICallError status 404: model: claude-nope not found");
    expect(describeIntakeError(new Error(goal))).toBe("Error");
  });

  it("sends only the specified context and gives the model no tools", async () => {
    const profile: ProfileEntry = { id: randomUUID(), category: "running-shoes", key: "width", value: "wide", source: "user_edit", status: "confirmed", note: "private note", updatedAt: "2026-10-17" };
    const model = modelReply();
    await runIntake({ ...input, profile: [profile] }, { model });
    expect(userMessage(model)).toEqual({ goal, today: input.today, allowedMerchants: ["demo-store"], confirmedProfile: [{ category: profile.category, key: profile.key, value: profile.value }], storeAttributes: STORE_ATTRIBUTES });
    const call = model.doGenerateCalls[0]!;
    expect(call.prompt.find((message) => message.role === "system")).toEqual({ role: "system", content: INTAKE_SYSTEM_PROMPT });
    expect(call.tools ?? []).toEqual([]);
    expect(call.temperature).toBe(0);
    expect(call.maxOutputTokens).toBe(800);
    expect(call.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it("passes provider options to the model call and keeps the default 30 s timeout otherwise", async () => {
    const model = modelReply();
    await runIntake(input, { model, providerOptions: { openai: { reasoningEffort: "none" } }, timeoutMs: 90_000 });
    expect(model.doGenerateCalls[0]!.providerOptions).toEqual({ openai: { reasoningEffort: "none" } });
    const plain = modelReply();
    await runIntake(input, { model: plain });
    expect(plain.doGenerateCalls[0]!.providerOptions ?? {}).toEqual({});
  });

  it("stores drafts, filters confirmed profile, orders entries, and uses a UTC date", async () => {
    const db = openDb(":memory:");
    try {
      const base: ProfileEntry = { id: randomUUID(), category: "running-shoes", key: "width", value: "wide", source: "user_edit", status: "confirmed", note: "private", updatedAt: "2026-10-16" };
      const suggested = { ...base, id: randomUUID(), status: "suggested", updatedAt: "2026-10-15" };
      for (const entry of [base, suggested]) db.prepare("INSERT INTO profile_entries (id, json) VALUES (?, ?)").run(entry.id, JSON.stringify(entry));
      expect(listProfileEntries(db).map((entry) => entry.id)).toEqual([suggested.id, base.id]);
      const model = modelReply();
      const result = await intakeStage(goal, { db, model, now: () => new Date("2026-10-17T23:30:00-07:00") });
      expect(result.draftId).toMatch(/^[0-9a-f-]{36}$/);
      expect(getDraft(db, result.draftId)).toEqual(result.draft);
      expect(getDraftRecord(db, result.draftId)).toEqual({ draft: result.draft, unsupported: [] });
      expect(userMessage(model)).toMatchObject({ today: "2026-10-18", confirmedProfile: [{ category: base.category, key: base.key, value: base.value }] });
      deleteDraft(db, result.draftId);
      expect(getDraft(db, result.draftId)).toBeNull();
      db.prepare("INSERT INTO contract_drafts (id, json, created_at) VALUES ('bad', '{}', 'now')").run();
      expect(() => getDraft(db, "bad")).toThrow();
      db.prepare("UPDATE profile_entries SET json = '{}' WHERE id = ?").run(base.id);
      expect(() => listProfileEntries(db)).toThrow();
    } finally { db.close(); }
  });

  it("keeps money modules outside the agent directory", () => {
    const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]);
    for (const file of walk(join(repoRoot(), "apps/web/lib/agent")).filter((file) => file.endsWith(".ts"))) {
      const source = readFileSync(file, "utf8");
      const imports = [...source.matchAll(/(?:from\s*|import\s*\(|require\s*\()\s*["']([^"']+)["']/g)].map((match) => match[1]);
      for (const specifier of imports) expect(specifier).not.toMatch(/(?:^|\/)(?:sign|payments-client)(?:\.ts)?$|pipeline\/(?:verify|approve|cart)-stage/);
    }
  });
});

it.each(["groceries", "household"] as const)("keeps %s package-size rules during normalization", (category) => {
  const rule = { key: "size", op: "eq" as const, value: "1 kg" };
  const result = normalizeDraft({ ...draft, category, mustHave: [rule] }, goal);
  expect(result.draft.mustHave).toEqual([rule]);
});

it("adds the unsupported column to a database created before it existed", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE contract_drafts (id TEXT PRIMARY KEY, json TEXT NOT NULL, created_at TEXT NOT NULL)");
    db.prepare("INSERT INTO contract_drafts (id, json, created_at) VALUES (?, ?, ?)").run("old", JSON.stringify({ ...draft, allowedMerchants: ["demo-store"] }), "now");
    migrate(db); migrate(db);
    expect(getDraftRecord(db, "old")?.unsupported).toEqual([]);
  } finally { db.close(); }
});

it("stores unsupported rules with the draft so the review screen can show them", async () => {
  const db = openDb(":memory:");
  try {
    const color = { key: "color", op: "eq", value: "red" };
    const result = await intakeStage(goal, { db, model: modelReply(JSON.stringify({ ...draft, mustHave: [...draft.mustHave, color] })) });
    expect(result.unsupported).toEqual([color]);
    expect(getDraftRecord(db, result.draftId)?.unsupported).toEqual([color]);
  } finally { db.close(); }
});

it("answers 503 and logs which variables are missing, never their values, when the model is not configured", async () => {
  const db = openDb(":memory:");
  const saved = { ...process.env };
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    delete process.env.MODEL_PROVIDER; delete process.env.MODEL_PLANNER;
    process.env.ANTHROPIC_API_KEY = "sk-secret-value";
    const error = await intakeStage(goal, { db }).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ status: 503, code: "MODEL_NOT_CONFIGURED" });
    const line = String(log.mock.calls[0]?.[0]);
    expect(line).toContain("MODEL_PROVIDER");
    expect(line).not.toContain("sk-secret-value");
  } finally { process.env = saved; db.close(); }
});
