import { z } from "zod";

// SPEC §2.2.
export const Category = z.enum(["actors", "musicians", "athletes"]);
export type Category = z.infer<typeof Category>;
export const Sku = z.string().regex(/^[A-Z0-9-]{3,24}$/);
export const AttrKey = z.string().regex(/^[a-z_]{1,24}$/);
export const AttrValue = z.union([z.string().max(40), z.number()]);
export type AttrValue = z.infer<typeof AttrValue>;

export const Rule = z.strictObject({
  key: AttrKey,                                   // "width", "size"
  op: z.enum(["eq", "gte", "lte", "includes"]),
  value: AttrValue,
});
export type Rule = z.infer<typeof Rule>;

export const Contract = z.strictObject({
  id: z.string().uuid(),
  category: Category,
  goal: z.string().max(300),                      // user's words, display only
  quantity: z.number().int().min(1).max(10),
  budgetCapCents: z.number().int().positive().max(500_000), // item + tax + shipping
  mustHave: z.array(Rule).max(8),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  allowedMerchants: z.array(z.string().min(1)).min(1),
  minReturnDays: z.number().int().min(0).max(365),
  confirmedAt: z.string(),                        // ISO timestamp
});
export type Contract = z.infer<typeof Contract>;

// What intake returns; nulls mean "ask the user".
export const ContractDraft = Contract.omit({ id: true, confirmedAt: true }).extend({
  budgetCapCents: z.number().int().positive().max(500_000).nullable(),
  question: z.string().max(140).nullable(),
});
export type ContractDraft = z.infer<typeof ContractDraft>;
