import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HOST, createPaymentsServer, parsePort } from "./server";

describe("payments server", () => {
  const server = createPaymentsServer();
  let base = "";

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, HOST, resolve));
    const addr = server.address() as AddressInfo;
    expect(addr.address).toBe("127.0.0.1");
    base = `http://${HOST}:${addr.port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  });

  it("GET /health returns ok", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("unknown routes return a typed 404 error", async () => {
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: "NOT_FOUND", message: "No such route." });
  });

  it("parses PORT with a 4100 default", () => {
    expect(parsePort(undefined)).toBe(4100);
    expect(parsePort("4200")).toBe(4200);
    expect(() => parsePort("abc")).toThrow();
  });
});
