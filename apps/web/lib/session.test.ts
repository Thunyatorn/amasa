import { describe, expect, it } from "vitest";
import { ApiError } from "./http";
import { isValidSession, newSessionValue, requireSession, requireSessionAndCsrf } from "./session";

const SECRET = "s".repeat(43);
process.env.SESSION_SECRET = SECRET;
process.env.VERIFIER_PRIVATE_KEY_B64 = "unused-in-this-test";

const req = (cookie: string, csrf?: string) =>
  new Request("http://localhost/api/x", { method: "POST", headers: { cookie, ...(csrf ? { "x-csrf-token": csrf } : {}) } });

describe("session and CSRF (SPEC §5)", () => {
  it("accepts a session it signed and rejects tampered or foreign ones", () => {
    const v = newSessionValue(SECRET);
    expect(isValidSession(v, SECRET)).toBe(true);
    expect(isValidSession(v.replace(/.$/, (c) => (c === "A" ? "B" : "A")), SECRET)).toBe(false);
    expect(isValidSession(newSessionValue("x".repeat(43)), SECRET)).toBe(false);
    expect(isValidSession(undefined, SECRET)).toBe(false);
    expect(isValidSession("no-dot", SECRET)).toBe(false);
  });

  it("a malformed cookie is treated as missing, not a crash", () => {
    expect(() => requireSession(req("amasa_session=%E0%A4%A"))).toThrow(ApiError);
  });

  it("requireSession throws 401 without a valid session", () => {
    expect(() => requireSession(req(""))).toThrow(ApiError);
    expect(() => requireSession(req(`amasa_session=${newSessionValue(SECRET)}`))).not.toThrow();
  });

  it("POST needs the CSRF header to match the cookie", () => {
    const s = `amasa_session=${newSessionValue(SECRET)}`;
    expect(() => requireSessionAndCsrf(req(`${s}; amasa_csrf=tok123`, "tok123"))).not.toThrow();
    for (const r of [req(`${s}; amasa_csrf=tok123`), req(`${s}; amasa_csrf=tok123`, "tok124"), req(s, "tok123")]) {
      try { requireSessionAndCsrf(r); expect.fail("should throw"); }
      catch (e) { expect((e as ApiError).status).toBe(403); }
    }
  });
});
