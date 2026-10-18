import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { canon, type SignedFields } from "@amasa/schemas";
import { env } from "./env";

// SPEC §10.2. Ed25519: the algorithm argument is null. The key never leaves the server.
export const signVerdict = (f: SignedFields, key: KeyObject) =>
  sign(null, Buffer.from(canon(f)), key).toString("base64");

let key: KeyObject | undefined;
export function verifierKey(): KeyObject {
  key ??= createPrivateKey(Buffer.from(env().VERIFIER_PRIVATE_KEY_B64, "base64").toString());
  return key;
}
