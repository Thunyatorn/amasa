import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { canon } from "@amasa/schemas/canon";
import type { SignedFields } from "./schema";

// SPEC §10.2. Ed25519: the algorithm argument is null.
export const checkVerdict = (f: SignedFields, sig: string, key: KeyObject): boolean => {
  try {
    return verify(null, Buffer.from(canon(f)), key, Buffer.from(sig, "base64"));
  } catch {
    return false;
  }
};

export function loadPublicKey(b64: string | undefined): KeyObject {
  if (!b64) throw new Error("VERIFIER_PUBLIC_KEY_B64 is not set; run pnpm keys");
  return createPublicKey(Buffer.from(b64, "base64").toString());
}
