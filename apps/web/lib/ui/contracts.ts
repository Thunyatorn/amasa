import { z } from "zod";
// Import the browser-safe schema directly: the package barrel also exports Node hashing.
import { Contract, ContractDraft, Rule } from "../../../../packages/schemas/src/contract.ts";

export { ContractDraft, Rule };
export const Id = z.string().uuid();
export const Goal = z.string().trim().min(3).max(300);
// Requirements from the goal that the store cannot check (never part of the contract).
const Unsupported = z.array(Rule).max(8).default([]);
export const IntakeResult = z.strictObject({ draftId: Id, draft: ContractDraft, unsupported: Unsupported });
export const DraftResult = z.strictObject({ draft: ContractDraft, unsupported: Unsupported });
export const ContractResult = z.strictObject({ contract: Contract, contractHash: z.string().regex(/^[a-f0-9]{64}$/) });
export const ConfirmInput = z.strictObject({ draftId: Id, draft: ContractDraft, acknowledgedUnsupported: z.literal(true).optional() });
const ErrorResult = z.strictObject({ code: z.string(), message: z.string().min(1).max(500) });

export async function api<S extends z.ZodType>(url: string, schema: S, body?: unknown, signal?: AbortSignal, method?: "DELETE" | "PATCH"): Promise<z.infer<S>> {
  const headers: Record<string, string> = {};
  // Every entry route can be opened directly, before a demo session exists.
  let sessionFailed = false;
  try {
    const session = await fetch("/api/csrf", { credentials: "same-origin", cache: "no-store", signal });
    if (session.status >= 500) { sessionFailed = true; throw new Error(); }
    const token = z.strictObject({ token: z.string().min(1).max(256) }).safeParse(await session.json());
    if (!session.ok || !token.success) throw new Error();
    if (body !== undefined) headers["content-type"] = "application/json";
    if (body !== undefined || method) headers["x-csrf-token"] = token.data.token;
  } catch {
    throw new Error(sessionFailed ? "Something went wrong. Please try again." : "We couldn't start your session. Please reload the page and try again.");
  }
  let response: Response;
  try {
    response = await fetch(url, { method: method ?? (body === undefined ? "GET" : "POST"), headers, credentials: "same-origin", cache: "no-store", signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  } catch {
    throw new Error(url === "/api/intake" ? "I couldn't read that goal just now. Please try again." : "We couldn't connect. Please try again.");
  }
  if (response.status >= 500) throw new Error("Something went wrong. Please try again.");
  if (response.status === 429 && url === "/api/intake") throw new Error("You've reached the hourly goal limit. Please try again later.");
  if (response.status === 409 && url === "/api/contracts") throw new Error("This draft was already confirmed. Please create a new goal.");
  let raw: unknown;
  try { raw = await response.json(); }
  catch { throw new Error("Something went wrong. Please try again."); }
  if (!response.ok) {
    const error = ErrorResult.safeParse(raw);
    throw new Error(error.success ? error.data.message : "Something went wrong. Please try again.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new Error("We couldn't read the response. Please try again.");
  return parsed.data;
}

export type Fields = { budget: string; quantity: string; minReturnDays: string; deadline: string; choice: string };
// A requirement without its own control, edited as text; numeric values stay numeric.
export type Extra = { rule: Rule; value: string };
// Each category's one store attribute with its own control (the values the demo store uses).
export const CHOICES = {
  actors: { key: "oscar", op: "eq", label: "Academy Award winner", none: "No requirement", options: [["yes", "Has won an Oscar"], ["no", "Hasn't won an Oscar"]] },
  musicians: { key: "genre", op: "includes", label: "Genre", none: "Any genre",
    options: [["pop", "Pop"], ["rock", "Rock"], ["r&b", "R&B"], ["soul", "Soul"], ["hip-hop", "Hip-hop"], ["country", "Country"], ["latin", "Latin"], ["electronic", "Electronic"]] },
  athletes: { key: "sport", op: "eq", label: "Sport", none: "Any sport",
    options: [["tennis", "Tennis"], ["soccer", "Soccer"], ["basketball", "Basketball"], ["track and field", "Track and field"], ["gymnastics", "Gymnastics"],
      ["swimming", "Swimming"], ["american football", "American football"], ["motor racing", "Motor racing"]] },
} as const satisfies Record<ContractDraft["category"], { key: string; op: Rule["op"]; label: string; none: string; options: readonly (readonly [string, string])[] }>;
export const isTypedRule = (category: ContractDraft["category"], rule: Rule) => {
  const choice = CHOICES[category];
  return rule.key === choice.key && rule.op === choice.op && choice.options.some(([value]) => value === String(rule.value).toLowerCase());
};
// The first rule matching the category's choice gets the control; any others stay editable as text.
export function editableRules(draft: ContractDraft) {
  let taken = false;
  return draft.mustHave.map((rule) => {
    if (taken || !isTypedRule(draft.category, rule)) return false;
    taken = true; return true;
  });
}
export function extrasFromDraft(draft: ContractDraft): Extra[] {
  const editable = editableRules(draft);
  return draft.mustHave.filter((_, index) => !editable[index]).map((rule) => ({ rule, value: String(rule.value) }));
}
export function fieldsFromDraft(draft: ContractDraft): Fields {
  const typed = (keys: string[]) => draft.mustHave.find((rule, index) => editableRules(draft)[index] && keys.includes(rule.key));
  return { budget: draft.budgetCapCents === null ? "" : (draft.budgetCapCents / 100).toFixed(2), quantity: String(draft.quantity), minReturnDays: String(draft.minReturnDays), deadline: draft.deadline ?? "",
    choice: String(typed([CHOICES[draft.category].key])?.value ?? "").toLowerCase() };
}
export const ruleLabel = (rule: Rule) =>
  `${rule.key.replaceAll("_", " ")} ${({ eq: "is", gte: "at least", lte: "at most", includes: "includes" } as const)[rule.op]}`;
export class FieldError extends Error {
  constructor(readonly field: string, message: string) { super(message); }
}

export function editedDraft(draft: ContractDraft, fields: Fields, today: string, extras: Extra[] = extrasFromDraft(draft)): ContractDraft {
  const budget = z.string().regex(/^\d+(?:\.\d{1,2})?$/).safeParse(fields.budget);
  const cents = budget.success ? Math.round(Number(fields.budget) * 100) : NaN;
  if (!Contract.shape.budgetCapCents.safeParse(cents).success) throw new FieldError("budget", "Enter a budget from 0.01 to 5,000.00 VU, with up to two decimal places.");
  if (!/^\d+$/.test(fields.quantity) || !Contract.shape.quantity.safeParse(Number(fields.quantity)).success) throw new FieldError("quantity", "Enter a quantity from 1 to 10, using a whole number.");
  if (!/^\d+$/.test(fields.minReturnDays) || !Contract.shape.minReturnDays.safeParse(Number(fields.minReturnDays)).success) throw new FieldError("returns", "Enter refund days from 0 to 365, using a whole number.");
  if (fields.deadline && !z.iso.date().safeParse(fields.deadline).success) throw new FieldError("deadline", "Enter a valid deadline in YYYY-MM-DD format.");
  if (fields.deadline && fields.deadline < today) throw new FieldError("deadline", "The date cannot be in the past.");
  const choice = CHOICES[draft.category];
  if (fields.choice && !choice.options.some(([value]) => value === fields.choice)) throw new FieldError("choice", `Choose a ${choice.label.toLowerCase()} from the list.`);
  const mustHave: Rule[] = extras.map(({ rule, value }, index) => {
    const field = `rule-${index}`, label = ruleLabel(rule);
    const text = value.trim();
    if (typeof rule.value === "number") {
      if (!/^-?\d+(?:\.\d+)?$/.test(text)) throw new FieldError(field, `Enter a number for "${label}", or remove it.`);
      return { ...rule, value: Number(text) };
    }
    if (!text || text.length > 40) throw new FieldError(field, `Enter a value of up to 40 characters for "${label}", or remove it.`);
    return { ...rule, value: text };
  });
  if (fields.choice) mustHave.push({ key: choice.key, op: choice.op, value: fields.choice });
  const { deadline: _deadline, ...rest } = draft;
  const result = ContractDraft.safeParse({ ...rest, budgetCapCents: cents, quantity: Number(fields.quantity), minReturnDays: Number(fields.minReturnDays), ...(fields.deadline ? { deadline: fields.deadline } : {}), mustHave, question: null });
  if (!result.success) throw new Error("Keep at most eight rules before confirming.");
  return result.data;
}
