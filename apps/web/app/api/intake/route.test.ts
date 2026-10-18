import { beforeEach, describe, expect, it, vi } from "vitest";

const stage = vi.hoisted(() => vi.fn(async (goal: string) => ({ draftId: "test-id", draft: { goal } })));
vi.mock("../../../lib/agent/intake-stage.ts", () => ({ intakeStage: stage }));
import { POST } from "./route.ts";
import { newSessionValue, sessionId } from "../../../lib/session.ts";

process.env.SESSION_SECRET = "s".repeat(43);
process.env.VERIFIER_PRIVATE_KEY_B64 = "unused-in-this-test";
const request = (body: unknown, session = newSessionValue(), csrf = true) => new Request("http://localhost/api/intake", {
  method: "POST", headers: { "content-type": "application/json", cookie: `amasa_session=${session}; amasa_csrf=token`, ...(csrf ? { "x-csrf-token": "token" } : {}) },
  body: JSON.stringify(body),
});

beforeEach(() => { stage.mockClear(); });
describe("POST intake", () => {
  it("requires a valid session and CSRF before running intake", async () => {
    expect((await POST(request({ goal: "shoes" }, "invalid"))).status).toBe(401);
    expect((await POST(request({ goal: "shoes" }, undefined, false))).status).toBe(403);
    expect(stage).not.toHaveBeenCalled();
  });

  it.each([{ goal: "ab" }, { goal: "x".repeat(301) }, { goal: "shoes", extra: true }, {}])("rejects invalid strict bodies %j", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(stage).not.toHaveBeenCalled();
  });

  it("trims the goal and returns the stored id and draft", async () => {
    const response = await POST(request({ goal: "  shoes  " }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ draftId: "test-id", draft: { goal: "shoes" } });
    expect(stage).toHaveBeenCalledWith("shoes");
  });

  it("limits each authenticated session to 20 model calls", async () => {
    const session = newSessionValue();
    for (let i = 0; i < 20; i++) expect((await POST(request({ goal: "shoes" }, session))).status).toBe(200);
    const response = await POST(request({ goal: "shoes" }, session));
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ code: "RATE_LIMITED" });
    expect(stage).toHaveBeenCalledTimes(20);
    expect((await POST(request({ goal: "shoes" }))).status).toBe(200);
  });

  it("extracts only the authenticated session id", () => {
    const session = newSessionValue();
    expect(sessionId(request({}, session))).toBe(session.split(".")[0]);
    expect(() => sessionId(request({}, "invalid"))).toThrow();
  });
});
