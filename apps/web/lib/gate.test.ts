import { describe, expect, it } from "vitest";
import { gateDecision } from "./gate.ts";

const basic = (user: string, password: string) => `Basic ${btoa(`${user}:${password}`)}`;
const external = (extra: Record<string, string> = {}) => new Headers({ "fly-client-ip": "203.0.113.9", "fly-forwarded-port": "443", ...extra });

describe("shared-password gate", () => {
  it("is off without a password locally, and closes the site on Fly", async () => {
    expect(await gateDecision(external(), undefined)).toBe("allow");
    expect(await gateDecision(external(), "")).toBe("allow");
    expect(await gateDecision(external(), undefined, true)).toBe("unconfigured");
    expect(await gateDecision(new Headers(), "", true)).toBe("unconfigured");
  });
  it("asks outside callers for the password, and accepts the right one with any user name", async () => {
    expect(await gateDecision(external(), "s3cret")).toBe("challenge");
    expect(await gateDecision(external({ authorization: basic("anyone", "s3cret") }), "s3cret")).toBe("allow");
    expect(await gateDecision(external({ authorization: basic("", "s3cret") }), "s3cret")).toBe("allow");
    expect(await gateDecision(external({ authorization: basic("demo", "p:a:ss") }), "p:a:ss")).toBe("allow");
  });
  it("refuses wrong, partial and malformed credentials", async () => {
    for (const authorization of [basic("a", "wrong"), basic("a", "s3cret "), basic("a", "S3CRET"), basic("a", ""), "Basic !!!", "Basic", "Bearer s3cret",
      `Basic ${btoa("no-colon")}`]) {
      expect(await gateDecision(external({ authorization }), "s3cret"), authorization).toBe("challenge");
    }
  });
  it("lets the app's own calls through only when no Fly proxy header is present", async () => {
    expect(await gateDecision(new Headers({ host: "127.0.0.1:3000" }), "s3cret")).toBe("allow");
    expect(await gateDecision(new Headers(), "s3cret", true)).toBe("allow");
    // Anything that came through Fly's proxy carries at least one of these, so it is gated.
    for (const header of ["fly-forwarded-port", "fly-client-ip"]) {
      expect(await gateDecision(new Headers({ [header]: "1" }), "s3cret"), header).toBe("challenge");
    }
    // Next.js adds x-forwarded-for to every request, internal ones included, so it says nothing.
    expect(await gateDecision(new Headers({ "x-forwarded-for": "127.0.0.1" }), "s3cret")).toBe("allow");
  });
  it("does not trust the Host header", async () => {
    expect(await gateDecision(external({ host: "127.0.0.1:3000" }), "s3cret")).toBe("challenge");
    expect(await gateDecision(external({ host: "localhost" }), "s3cret")).toBe("challenge");
  });
});

describe("proxy.ts", () => {
  const run = async (url: string, headers: Record<string, string>, env: Record<string, string | undefined>) => {
    const { vi } = await import("vitest");
    for (const [k, v] of Object.entries(env)) v === undefined ? vi.stubEnv(k, "") : vi.stubEnv(k, v);
    try {
      const { NextRequest } = await import("next/server");
      const { proxy } = await import("../proxy.ts");
      return await proxy(new NextRequest(url, { headers }));
    } finally { vi.unstubAllEnvs(); }
  };
  it("challenges outside callers with a 401 and WWW-Authenticate, but not the health check", async () => {
    const fromFly = { "fly-client-ip": "203.0.113.9" };
    const page = await run("http://x.fly.dev/", fromFly, { DEMO_PASSWORD: "s3cret" });
    expect([page.status, page.headers.get("www-authenticate")]).toEqual([401, expect.stringContaining("Basic")]);
    expect((await run("http://x.fly.dev/api/health", fromFly, { DEMO_PASSWORD: "s3cret" })).headers.get("x-middleware-next")).toBe("1");
    expect((await run("http://x.fly.dev/", { ...fromFly, authorization: basic("u", "s3cret") }, { DEMO_PASSWORD: "s3cret" })).headers.get("x-middleware-next")).toBe("1");
  });
  it("answers 503 on Fly when no password is set, and lets everything through locally", async () => {
    expect((await run("http://x.fly.dev/", { "fly-client-ip": "1" }, { DEMO_PASSWORD: "", FLY_APP_NAME: "amasa" })).status).toBe(503);
    expect((await run("http://127.0.0.1:3000/", {}, { DEMO_PASSWORD: "", FLY_APP_NAME: "" })).headers.get("x-middleware-next")).toBe("1");
  });
});
