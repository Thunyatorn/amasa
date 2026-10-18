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

export type Fields = { budget: string; quantity: string; minReturnDays: string; deadline: string; width: string; size: string };
// A requirement without its own control, edited as text; numeric values stay numeric.
export type Extra = { rule: Rule; value: string };
const SHOES = "running-shoes";
export const isTypedRule = (rule: Rule) =>
  (rule.key === "width" && rule.op === "eq" && ["wide", "standard", "narrow"].includes(String(rule.value))) ||
  (rule.key === "sizes_available" && rule.op === "includes") || (rule.key === "size" && rule.op === "eq");
// Width and size have their own controls only for shoes, the one category whose products have them.
export function editableRules(draft: ContractDraft) {
  const seen = new Set<string>();
  return draft.mustHave.map((rule) => {
    const key = rule.key === "width" ? "width" : "size";
    if (draft.category !== SHOES || !isTypedRule(rule) || seen.has(key)) return false;
    seen.add(key); return true;
  });
}
export function extrasFromDraft(draft: ContractDraft): Extra[] {
  const editable = editableRules(draft);
  return draft.mustHave.filter((_, index) => !editable[index]).map((rule) => ({ rule, value: String(rule.value) }));
}
export function fieldsFromDraft(draft: ContractDraft): Fields {
  const typed = (keys: string[]) => draft.mustHave.find((rule, index) => editableRules(draft)[index] && keys.includes(rule.key));
  return { budget: draft.budgetCapCents === null ? "" : (draft.budgetCapCents / 100).toFixed(2), quantity: String(draft.quantity), minReturnDays: String(draft.minReturnDays), deadline: draft.deadline ?? "",
    width: String(typed(["width"])?.value ?? ""), size: String(typed(["size", "sizes_available"])?.value ?? "") };
}
export const ruleLabel = (rule: Rule) =>
  `${rule.key.replaceAll("_", " ")} ${({ eq: "is", gte: "at least", lte: "at most", includes: "includes" } as const)[rule.op]}`;
export class FieldError extends Error {
  constructor(readonly field: string, message: string) { super(message); }
}

export function editedDraft(draft: ContractDraft, fields: Fields, today: string, extras: Extra[] = extrasFromDraft(draft)): ContractDraft {
  const budget = z.string().regex(/^\d+(?:\.\d{1,2})?$/).safeParse(fields.budget);
  const cents = budget.success ? Math.round(Number(fields.budget) * 100) : NaN;
  if (!Contract.shape.budgetCapCents.safeParse(cents).success) throw new FieldError("budget", "Enter a budget from $0.01 to $5,000.00, with up to two decimal places.");
  if (!/^\d+$/.test(fields.quantity) || !Contract.shape.quantity.safeParse(Number(fields.quantity)).success) throw new FieldError("quantity", "Enter a quantity from 1 to 10, using a whole number.");
  if (!/^\d+$/.test(fields.minReturnDays) || !Contract.shape.minReturnDays.safeParse(Number(fields.minReturnDays)).success) throw new FieldError("returns", "Enter return days from 0 to 365, using a whole number.");
  if (fields.deadline && !z.iso.date().safeParse(fields.deadline).success) throw new FieldError("deadline", "Enter a valid deadline in YYYY-MM-DD format.");
  if (fields.deadline && fields.deadline < today) throw new FieldError("deadline", "The date cannot be in the past.");
  const shoes = draft.category === SHOES;
  if (shoes && fields.width && !z.enum(["wide", "standard", "narrow"]).safeParse(fields.width).success) throw new FieldError("width", "Choose wide, standard, or narrow width.");
  if (shoes && fields.size && !z.string().max(40).regex(/^\d+(?:\.\d+)?$/).safeParse(fields.size).success) throw new FieldError("size", "Enter a numeric size, such as 10.5.");
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
  if (shoes && fields.width) mustHave.push({ key: "width", op: "eq", value: fields.width });
  if (shoes && fields.size) mustHave.push({ key: "sizes_available", op: "includes", value: fields.size });
  const { deadline: _deadline, ...rest } = draft;
  const result = ContractDraft.safeParse({ ...rest, budgetCapCents: cents, quantity: Number(fields.quantity), minReturnDays: Number(fields.minReturnDays), ...(fields.deadline ? { deadline: fields.deadline } : {}), mustHave, question: null });
  if (!result.success) throw new Error("Keep at most eight rules before confirming.");
  return result.data;
}
