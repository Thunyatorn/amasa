import { z } from "zod";
import { Category } from "./contract.ts";

// SPEC §2.10.
export const ProfileEntry = z.strictObject({
  id: z.string().uuid(),
  category: z.union([Category, z.literal("all")]),
  key: z.string().regex(/^[a-z_]{1,32}$/),        // "genre", "sport", "oscar", "brand_like", "brand_avoid"
  value: z.union([z.string().max(40), z.number()]),
  source: z.enum(["user_edit", "kept", "returned"]), // never merchant content
  status: z.enum(["suggested", "confirmed"]),
  note: z.string().max(120),                      // code-written reason, shown to the user
  updatedAt: z.string(),
});
export type ProfileEntry = z.infer<typeof ProfileEntry>;

// SPEC §2.11.
export const AutonomyState = z.strictObject({
  category: Category,
  level: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  offeredLevel: z.union([z.literal(1), z.literal(2)]).nullable(),
  consecutiveGood: z.number().int().min(0),
  weeklyCapCents: z.number().int().min(0),
  updatedAt: z.string(),
});
export type AutonomyState = z.infer<typeof AutonomyState>;
