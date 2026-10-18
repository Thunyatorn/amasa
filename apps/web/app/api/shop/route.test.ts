import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProgressEvent } from "@amasa/schemas";

const shop = vi.hoisted(() => ({ run: vi.fn(async (_id: string, emit: (e: ProgressEvent) => void, _signal: AbortSignal) => {
  emit({ type: "step", text: "Reading your contract" }); emit({ type: "done" });
}) }));
vi.mock("../../../lib/agent/shop-run.ts", () => ({ runShop: shop.run }));
import { POST } from "./route.ts";
import { newSessionValue } from "../../../lib/session.ts";

process.env.SESSION_SECRET = "s".repeat(43);
process.env.VERIFIER_PRIVATE_KEY_B64 = "unused-in-this-test";
const ID = "33333333-3333-4333-8333-333333333333";
const request = (body: unknown, session = newSessionValue(), csrf = true, signal?: AbortSignal) => new Request("http://localhost/api/shop", {
  method: "POST", signal, body: JSON.stringify(body),
  headers: { "content-type": "application/json", cookie: `amasa_session=${session}; amasa_csrf=token`, ...(csrf ? { "x-csrf-token": "token" } : {}) },
});

beforeEach(() => { shop.run.mockClear(); });
describe("POST /api/shop", () => {
  it("requires a session and CSRF before starting a run", async () => {
    expect((await POST(request({ contractId: ID }, "invalid"))).status).toBe(401);
    expect((await POST(request({ contractId: ID }, undefined, false))).status).toBe(403);
    expect(shop.run).not.toHaveBeenCalled();
  });

  it.each([{}, { contractId: "nope" }, { contractId: ID, extra: 1 }])("rejects the strict body %j", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(shop.run).not.toHaveBeenCalled();
  });

  it("streams validated events as SSE after a 1 KB padding comment", async () => {
    const response = await POST(request({ contractId: ID }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    const body = await response.text();
    expect(body.startsWith(`:${" ".repeat(1024)}\n\n`)).toBe(true);
    expect(body.endsWith('data: {"type":"step","text":"Reading your contract"}\n\ndata: {"type":"done"}\n\n')).toBe(true);
    expect(shop.run).toHaveBeenCalledWith(ID, expect.any(Function), expect.any(AbortSignal), { prepare: expect.any(Function) });
  });

  it("aborts the run when the client goes away", async () => {
    let seen: AbortSignal | undefined;
    shop.run.mockImplementationOnce(async (_id, _emit, signal) => { seen = signal; await new Promise((resolve) => signal.addEventListener("abort", resolve)); });
    const client = new AbortController();
    const response = await POST(request({ contractId: ID }, undefined, true, client.signal));
    await response.body!.cancel();
    expect(seen?.aborted).toBe(true);
  });

  it("limits each session to 10 runs an hour", async () => {
    const session = newSessionValue();
    for (let i = 0; i < 10; i++) expect((await POST(request({ contractId: ID }, session))).status).toBe(200);
    const limited = await POST(request({ contractId: ID }, session));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ code: "RATE_LIMITED" });
  });
});
