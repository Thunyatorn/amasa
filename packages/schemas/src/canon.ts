import { createHash } from "node:crypto";

// SPEC §2.1. Every hash and signature in Amasa goes through canon(); never hash JSON.stringify output.

// Sorted keys, undefined keys dropped, non-finite numbers rejected.
export function canon(v: unknown): string {
  if (typeof v === "number" && !Number.isFinite(v)) throw new Error("canon: non-finite number");
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canon(o[k])}`)
    .join(",")}}`;
}

export const sha256 = (v: unknown) => createHash("sha256").update(canon(v)).digest("hex");
