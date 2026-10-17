import { spawnSync } from "node:child_process";
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = join(import.meta.dirname, "gen-keys.mjs");
const run = (root: string) => spawnSync(process.execPath, [SCRIPT, root], { encoding: "utf8" });
const envValue = (file: string, name: string) =>
  readFileSync(file, "utf8").match(new RegExp(`^${name}=(.*)$`, "m"))?.[1] ?? "";

describe("gen-keys", () => {
  let root: string;
  let webEnv: string;
  let payEnv: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "amasa-keys-"));
    webEnv = join(root, "apps/web/.env.local");
    payEnv = join(root, "services/payments/.env");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("writes a matching pair, prints no key material, and is idempotent", () => {
    const first = run(root);
    expect(first.status).toBe(0);

    const priv = envValue(webEnv, "VERIFIER_PRIVATE_KEY_B64");
    const pub = envValue(payEnv, "VERIFIER_PUBLIC_KEY_B64");
    expect(priv).not.toBe("");
    expect(pub).not.toBe("");

    const out = first.stdout + first.stderr;
    expect(out).not.toContain(priv);
    expect(out).not.toContain(pub);
    expect(out).not.toMatch(/BEGIN|PRIVATE KEY|[A-Za-z0-9+/]{40,}/);

    // The pair loads as documented in §10.1 and signs/verifies.
    const key = createPrivateKey(Buffer.from(priv, "base64").toString());
    const pk = createPublicKey(Buffer.from(pub, "base64").toString());
    const msg = Buffer.from("verdict");
    expect(verify(null, msg, pk, sign(null, msg, key))).toBe(true);

    expect(statSync(webEnv).mode & 0o777).toBe(0o600);
    expect(statSync(payEnv).mode & 0o777).toBe(0o600);

    const before = [readFileSync(webEnv, "utf8"), readFileSync(payEnv, "utf8")];
    expect(run(root).status).toBe(0);
    expect([readFileSync(webEnv, "utf8"), readFileSync(payEnv, "utf8")]).toEqual(before);
  });

  it("keeps existing variables and fills an empty placeholder line", () => {
    mkdirSync(join(root, "services/payments"), { recursive: true });
    writeFileSync(payEnv, "VISA_ACCEPTANCE_MERCHANT_ID=abc\nVERIFIER_PUBLIC_KEY_B64=\nPORT=4100");
    expect(run(root).status).toBe(0);

    const text = readFileSync(payEnv, "utf8");
    expect(text).toContain("VISA_ACCEPTANCE_MERCHANT_ID=abc\n");
    expect(text).toContain("PORT=4100");
    expect(text.match(/^VERIFIER_PUBLIC_KEY_B64=/gm)).toHaveLength(1);
    expect(envValue(payEnv, "VERIFIER_PUBLIC_KEY_B64")).not.toBe("");
  });

  it("refuses to write half a pair", () => {
    mkdirSync(join(root, "apps/web"), { recursive: true });
    writeFileSync(webEnv, "VERIFIER_PRIVATE_KEY_B64=existing\n");
    const res = run(root);
    expect(res.status).toBe(1);
    expect(readFileSync(webEnv, "utf8")).toBe("VERIFIER_PRIVATE_KEY_B64=existing\n");
    expect(() => readFileSync(payEnv)).toThrow();
  });
});
