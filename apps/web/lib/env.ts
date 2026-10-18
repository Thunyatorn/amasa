import { join } from "node:path";
import { z } from "zod";
import { repoRoot } from "./paths";

// Server-only environment (SPEC §19). Never import this from client components, and never
// prefix these variables with NEXT_PUBLIC_.
const Env = z.object({
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters; run pnpm keys"),
  VERIFIER_PRIVATE_KEY_B64: z.string().min(1, "VERIFIER_PRIVATE_KEY_B64 is not set; run pnpm keys"),
  STORE_BASE_URL: z.string().url().default("http://localhost:3000/api/store"),
  PAYMENTS_URL: z.string().url().default("http://127.0.0.1:4100"),
  DATABASE_PATH: z.string().optional(),
  TAP_ENABLED: z.enum(["true", "false"]).default("false"),
});
export type Env = z.infer<typeof Env>;

let cached: Env | undefined;

// Parsed lazily so a missing variable fails the request that needs it, with a clear message.
export function env(): Env {
  if (cached) return cached;
  const parsed = Env.safeParse({ ...process.env, STORE_BASE_URL: process.env.STORE_BASE_URL || undefined,
    PAYMENTS_URL: process.env.PAYMENTS_URL || undefined, DATABASE_PATH: process.env.DATABASE_PATH || undefined,
    TAP_ENABLED: process.env.TAP_ENABLED || undefined });
  if (!parsed.success) {
    throw new Error(`Server configuration error: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  cached = parsed.data;
  return cached;
}

export function databasePath(): string {
  return process.env.DATABASE_PATH || join(repoRoot(), "data", "amasa.db");
}
