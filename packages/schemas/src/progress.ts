import { z } from "zod";
import { Sku } from "./contract.ts";
import { CompareTable, Option } from "./options.ts";

// SPEC §2.14. Streamed to the UI (§6).
export const ProgressEvent = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("step"), text: z.string().max(140) }),
  z.strictObject({ type: z.literal("flagged"), sku: Sku, reason: z.string().max(140) }),
  z.strictObject({ type: z.literal("filtered"),
    removed: z.array(z.strictObject({ code: z.string(), count: z.number().int() })) }),
  z.strictObject({ type: z.literal("options"), options: z.array(Option).max(3), compare: CompareTable }),
  z.strictObject({ type: z.literal("error"), code: z.string(), message: z.string().max(200) }),
  z.strictObject({ type: z.literal("done") }),
]);
export type ProgressEvent = z.infer<typeof ProgressEvent>;
