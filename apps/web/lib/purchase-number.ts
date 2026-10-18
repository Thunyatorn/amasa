import { randomInt } from "node:crypto";

// 16 characters from [A-Z0-9] via crypto.randomInt (SPEC §10.2); Visa requires alphanumeric, < 20.
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
export function newPurchaseNumber(): string {
  let out = "";
  for (let i = 0; i < 16; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}
