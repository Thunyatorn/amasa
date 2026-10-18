import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyAudit } from "@amasa/audit";

vi.mock("./db/index.ts", async (original) => {
  const module = await original<typeof import("./db/index.ts")>();
  return { ...module, getDb: () => db };
});
import { openDb } from "./db/index.ts";
import { confirmProfileEntry, insertProfileEntry, listProfileEntries } from "./db/profile.ts";
import { unseenNotices } from "./db/notices.ts";
import { newSessionValue } from "./session.ts";
import { GET as autonomyGet, POST as autonomyPost } from "../app/api/autonomy/route.ts";
import { GET as noticesGet } from "../app/api/notices/route.ts";
import { POST as noticeSeen } from "../app/api/notices/[id]/seen/route.ts";

process.env.SESSION_SECRET = "s".repeat(43);
process.env.VERIFIER_PRIVATE_KEY_B64 = "unused-in-this-test";
const db = openDb(":memory:");
function request(method: string, body?: unknown, auth = "valid", csrf = true): Request {
  return new Request("http://localhost/api/test", { method,
    headers: { cookie: `amasa_session=${auth === "valid" ? newSessionValue() : auth}; amasa_csrf=token`, ...(csrf ? { "x-csrf-token": "token" } : {}), "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const setState = (state: Record<string, unknown>) => db.prepare("INSERT OR REPLACE INTO autonomy (category, json) VALUES ('musicians', ?)")
  .run(JSON.stringify({ category: "musicians", level: 0, offeredLevel: null, consecutiveGood: 0, weeklyCapCents: 0, updatedAt: "2026-10-18T00:00:00.000Z", ...state }));
beforeEach(() => { for (const t of ["autonomy", "notices", "profile_entries", "audit"]) db.prepare(`DELETE FROM ${t}`).run(); });
afterAll(() => db.close());

describe("autonomy API (SPEC §5, §11)", () => {
  it("lists all three categories, defaulting to level 0", async () => {
    const res = await autonomyGet(request("GET"));
    const { states } = await res.json();
    expect(states.map((s: { category: string; level: number }) => [s.category, s.level])).toEqual([["actors", 0], ["musicians", 0], ["athletes", 0]]);
    expect((await autonomyGet(request("GET", undefined, "invalid"))).status).toBe(401);
  });

  it("accepts an offered level with an audit row and a notice, and refuses one that was not offered", async () => {
    expect((await autonomyPost(request("POST", { category: "musicians", level: 1 }))).status).toBe(409);
    setState({ offeredLevel: 1, consecutiveGood: 5 });
    expect((await autonomyPost(request("POST", { category: "musicians", level: 1 }, "valid", false))).status).toBe(403);
    const ok = await autonomyPost(request("POST", { category: "musicians", level: 1 }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).state).toMatchObject({ level: 1, offeredLevel: null });
    const audit = db.prepare("SELECT type, payload FROM audit").all() as { type: string; payload: string }[];
    expect(audit.map((a) => a.type)).toEqual(["autonomy_changed"]);
    expect(JSON.parse(audit[0]!.payload)).toMatchObject({ category: "musicians", from: 0, to: 1, reason: "user_raised" });
    expect(unseenNotices(db).map((n) => n.text)).toEqual(["You raised musicians to level 1 (Propose)."]);
    expect(verifyAudit(db).ok).toBe(true);
  });

  it("lowers in one call and rejects unknown keys", async () => {
    setState({ level: 2, weeklyCapCents: 15000 });
    expect((await (await autonomyPost(request("POST", { category: "musicians", level: 0 }))).json()).state).toMatchObject({ level: 0 });
    expect((await autonomyPost(request("POST", { category: "musicians", level: 0, extra: 1 }))).status).toBe(400);
    expect((await autonomyPost(request("POST", { category: "toys", level: 0 }))).status).toBe(400);
  });
});

describe("notices (SPEC §16)", () => {
  it("lists unseen notices and dismisses one", async () => {
    setState({ offeredLevel: 1 });
    await autonomyPost(request("POST", { category: "musicians", level: 0 }));
    const { notices } = await (await noticesGet(request("GET"))).json();
    expect(notices).toHaveLength(1);
    expect((await noticeSeen(request("POST"), { params: Promise.resolve({ id: notices[0].id }) })).status).toBe(200);
    expect((await noticeSeen(request("POST"), { params: Promise.resolve({ id: notices[0].id }) })).status).toBe(404);
    expect((await (await noticesGet(request("GET"))).json()).notices).toEqual([]);
    expect((await noticeSeen(request("POST", undefined, "valid", false), { params: Promise.resolve({ id: notices[0].id }) })).status).toBe(403);
  });
});

describe("profile changes leave notices and never duplicate a key", () => {
  const entry = (over: Record<string, unknown>) => ({ id: randomUUID(), category: "musicians", key: "genre", value: "pop", source: "user_edit",
    status: "confirmed", note: "", updatedAt: "2026-10-18T00:00:00.000Z", ...over });
  it("keeping a suggested genre replaces the confirmed one", () => {
    insertProfileEntry(db, entry({}) as never, null);
    const suggestion = entry({ value: "rock", source: "kept", status: "suggested", note: "You kept 2 orders with genre rock" });
    insertProfileEntry(db, suggestion as never, "Amasa suggests genre rock.");
    expect(listProfileEntries(db).map((e) => [e.value, e.status])).toEqual([["pop", "confirmed"], ["rock", "suggested"]]);
    confirmProfileEntry(db, suggestion.id);
    expect(listProfileEntries(db).map((e) => [e.value, e.status])).toEqual([["rock", "confirmed"]]);
    expect(unseenNotices(db).map((n) => n.text)).toEqual(["Amasa suggests genre rock.", "You kept musicians genre rock in your profile. It replaces pop."]);
    expect(verifyAudit(db).ok).toBe(true);
  });
});
