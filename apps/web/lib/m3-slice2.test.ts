import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileEntry, sha256 } from "@amasa/schemas";
import { verifyAudit } from "@amasa/audit";

vi.mock("./db/index.ts", async (original) => {
  const module = await original<typeof import("./db/index.ts")>();
  return { ...module, getDb: () => db };
});
import { openDb } from "./db/index.ts";
import { getDraft, insertDraft } from "./db/drafts.ts";
import { confirmedProfile, confirmProfileEntry, deleteProfileEntry, insertProfileEntry, listProfileEntries, updateProfileEntry } from "./db/profile.ts";
import { confirmContract } from "./pipeline/contract-stage.ts";
import { newSessionValue } from "./session.ts";
import { ApiError, route } from "./http.ts";
import { GET as draftsGet } from "../app/api/drafts/[id]/route.ts";
import { POST as contractPost } from "../app/api/contracts/route.ts";
import { GET as profileGet, POST as profilePost } from "../app/api/profile/route.ts";
import { PATCH, DELETE } from "../app/api/profile/[id]/route.ts";
import { POST as confirmPost } from "../app/api/profile/[id]/confirm/route.ts";
import { GET as csrfGet } from "../app/api/csrf/route.ts";
import { seed } from "../scripts/seed.ts";

process.env.SESSION_SECRET = "s".repeat(43);
process.env.VERIFIER_PRIVATE_KEY_B64 = "unused-in-this-test";
const db = openDb(":memory:");
const draft = { category: "running-shoes" as const, goal: "wide shoes", quantity: 1, budgetCapCents: 14000,
  mustHave: [], allowedMerchants: ["demo-store"], minReturnDays: 14, question: null };
const context = (id: string) => ({ params: Promise.resolve({ id }) });
function request(method: string, body?: unknown, auth = "valid", csrf = true): Request {
  return new Request("http://localhost/api/test", { method,
    headers: { cookie: `amasa_session=${auth === "valid" ? newSessionValue() : auth}; amasa_csrf=token`,
      ...(csrf ? { "x-csrf-token": "token" } : {}), "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function entry(source: "user_edit" | "kept" = "kept"): ProfileEntry {
  return { id: randomUUID(), category: "running-shoes", key: "size", value: 10.5, source,
    status: "suggested", note: "", updatedAt: "2026-10-17T00:00:00.000Z" };
}
function count(table: string): number {
  return (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
}
beforeEach(() => { for (const table of ["profile_entries", "contract_drafts", "contracts", "audit"]) db.prepare(`DELETE FROM ${table}`).run(); });
afterAll(() => db.close());

describe("M3 profile API", () => {
  it("authenticates reads and every write, and checks CSRF before mutation", async () => {
    expect((await profileGet(request("GET", undefined, "invalid"))).status).toBe(401);
    const id = randomUUID();
    const writes = [
      (req: Request) => profilePost(req), (req: Request) => PATCH(req, context(id)),
      (req: Request) => DELETE(req, context(id)), (req: Request) => confirmPost(req, context(id)),
    ];
    for (const write of writes) {
      expect((await write(request("POST", {}, "invalid"))).status).toBe(401);
      expect((await write(request("POST", {}, "valid", false))).status).toBe(403);
    }
    expect(count("audit")).toBe(0);
  });

  it("creates a confirmed manual entry, lists, edits, refuses status edits, confirms and deletes it with audit", async () => {
    const created = await profilePost(request("POST", { category: "running-shoes", key: "width", value: "wide" }));
    expect(created.status).toBe(200);
    const { entry: createdEntry } = await created.json();
    expect(createdEntry).toMatchObject({ source: "user_edit", status: "confirmed", key: "width" });
    const id = createdEntry.id;
    expect(await (await profileGet(request("GET"))).json()).toEqual({ entries: [createdEntry] });
    expect(await (await PATCH(request("PATCH", { value: "narrow" }), context(id))).json()).toMatchObject({ entry: { key: "width", value: "narrow" } });
    expect((await PATCH(request("PATCH", { status: "suggested" }), context(id))).status).toBe(400);
    expect(await (await confirmPost(request("POST"), context(id))).json()).toMatchObject({ entry: { status: "confirmed" } });
    const deleted = await DELETE(request("DELETE"), context(id));
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ ok: true });
    expect(listProfileEntries(db)).toEqual([]);
    expect(count("audit")).toBe(4);
    const audits = db.prepare("SELECT type, payload FROM audit").all() as { type: string; payload: string }[];
    expect(audits.every((row) => row.type === "profile_changed" && JSON.parse(row.payload).entryId === id)).toBe(true);
    expect(verifyAudit(db).ok).toBe(true);
  });

  it.each([{}, { category: "running-shoes", key: "width", value: "wide", status: "confirmed" },
    { category: "running-shoes", key: "Bad", value: "wide" }])("rejects invalid creation %j", async (body) => {
    expect((await profilePost(request("POST", body))).status).toBe(400);
    expect(count("profile_entries")).toBe(0);
  });

  it.each([{}, { extra: true }, { status: "user_edit" }, { status: "confirmed" }, { value: 11, status: "suggested" }, { key: "size" }, { key: "size", value: 11 }, { value: null }, { value: "x".repeat(41) }])("rejects invalid updates %j", async (body) => {
    expect((await PATCH(request("PATCH", body), context(randomUUID()))).status).toBe(400);
  });

  it("rejects malformed ids and reports missing entries on every id route", async () => {
    for (const id of ["bad", randomUUID()]) {
      const expected = id === "bad" ? 400 : 404;
      expect((await PATCH(request("PATCH", { value: 11 }), context(id))).status).toBe(expected);
      expect((await DELETE(request("DELETE"), context(id))).status).toBe(expected);
      expect((await confirmPost(request("POST"), context(id))).status).toBe(expected);
    }
  });

  it("normalizes initial status by source and only passes confirmed entries to intake", () => {
    const manual = entry("user_edit"), suggestion = entry();
    insertProfileEntry(db, manual); insertProfileEntry(db, { ...suggestion, status: "confirmed" });
    expect(confirmedProfile(db).map((row) => row.id)).toEqual([manual.id]);
    expect(listProfileEntries(db).find((row) => row.id === suggestion.id)?.status).toBe("suggested");
    expect(updateProfileEntry(db, suggestion.id, { value: 11 })).toMatchObject({ source: "user_edit", status: "confirmed" });
  });

  it("Keep confirms a suggestion without changing its source or value", () => {
    const suggestion = entry(); insertProfileEntry(db, suggestion);
    expect(confirmProfileEntry(db, suggestion.id)).toMatchObject({ source: "kept", status: "confirmed", value: 10.5 });
    expect(confirmedProfile(db).map((row) => row.id)).toEqual([suggestion.id]);
  });

  it("rolls back every profile mutation if audit cannot be appended", () => {
    const original = entry(); insertProfileEntry(db, original);
    db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END");
    try {
      expect(() => insertProfileEntry(db, entry())).toThrow();
      expect(() => updateProfileEntry(db, original.id, { value: 11 })).toThrow();
      expect(() => confirmProfileEntry(db, original.id)).toThrow();
      expect(() => deleteProfileEntry(db, original.id)).toThrow();
      expect(listProfileEntries(db)).toEqual([original]);
      expect(count("audit")).toBe(1);
    } finally { db.exec("DROP TRIGGER fail_audit"); }
  });
});

describe("draft confirmation", () => {
  it("requires session to read, validates UUID, and returns a stored draft or 404", async () => {
    const id = randomUUID(); insertDraft(db, id, draft, new Date().toISOString());
    expect((await draftsGet(request("GET", undefined, "invalid"), context(id))).status).toBe(401);
    expect((await draftsGet(request("GET"), context("bad"))).status).toBe(400);
    expect((await draftsGet(request("GET"), context(randomUUID()))).status).toBe(404);
    expect(await (await draftsGet(request("GET"), context(id))).json()).toEqual({ draft, unsupported: [] });
    const withUnsupported = randomUUID(); const color = { key: "color", op: "eq" as const, value: "red" };
    insertDraft(db, withUnsupported, draft, new Date().toISOString(), [color]);
    expect(await (await draftsGet(request("GET"), context(withUnsupported))).json()).toEqual({ draft, unsupported: [color] });
  });

  it("refuses rules the store can't check, including width outside running shoes", async () => {
    const cases = [
      { ...draft, mustHave: [{ key: "color", op: "eq", value: "red" }] },
      { ...draft, category: "groceries", mustHave: [{ key: "width", op: "eq", value: "wide" }] },
      { ...draft, mustHave: [{ key: "size", op: "gte", value: 10 }] },
    ];
    for (const edited of cases) {
      const draftId = randomUUID(); insertDraft(db, draftId, draft, new Date().toISOString());
      const response = await contractPost(request("POST", { draftId, draft: edited }));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "UNSUPPORTED_RULE" });
      expect(getDraft(db, draftId)).toEqual(draft);
    }
    expect(count("contracts")).toBe(0);
  });

  it("requires the user to acknowledge requirements the store can't check before confirming", async () => {
    const draftId = randomUUID();
    insertDraft(db, draftId, draft, new Date().toISOString(), [{ key: "color", op: "eq", value: "red" }]);
    const refused = await contractPost(request("POST", { draftId, draft }));
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ code: "UNSUPPORTED_NOT_REVIEWED" });
    expect(count("contracts")).toBe(0);
    expect((await contractPost(request("POST", { draftId, draft, acknowledgedUnsupported: false }))).status).toBe(400);
    const accepted = await contractPost(request("POST", { draftId, draft, acknowledgedUnsupported: true }));
    expect(accepted.status).toBe(200);
    expect((await accepted.json()).contract.mustHave).toEqual([]);
  });

  it("consumes the draft once, preserves its id and atomically audits the hashed contract", async () => {
    const draftId = randomUUID(); insertDraft(db, draftId, draft, new Date().toISOString());
    const body = { draftId, draft };
    expect((await contractPost(request("POST", body, "invalid"))).status).toBe(401);
    expect((await contractPost(request("POST", body, "valid", false))).status).toBe(403);
    const response = await contractPost(request("POST", body));
    expect(response.status).toBe(200);
    const { contract, contractHash } = await response.json();
    expect(contract.id).toBe(draftId); expect(contract.confirmedAt).toBeTruthy();
    expect(contractHash).toBe(sha256(contract));
    expect(getDraft(db, draftId)).toBeNull(); expect(count("contracts")).toBe(1);
    expect((await contractPost(request("POST", body))).status).toBe(409);
    const audit = db.prepare("SELECT type, payload FROM audit").get() as { type: string; payload: string };
    expect(audit.type).toBe("contract_confirmed");
    expect(JSON.parse(audit.payload)).toEqual({ contractId: draftId, contractHash });
    expect(count("audit")).toBe(1);
  });

  it.each([{ draft }, { draftId: "bad", draft }, { draftId: randomUUID(), draft, extra: true }])("rejects strict confirmation body %j", async (body) => {
    expect((await contractPost(request("POST", body))).status).toBe(400);
  });

  it("rolls back draft deletion and contract insertion if auditing fails", () => {
    const draftId = randomUUID(); insertDraft(db, draftId, draft, new Date().toISOString());
    db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END");
    try {
      expect(() => confirmContract({ draftId, draft })).toThrow();
      expect(getDraft(db, draftId)).toEqual(draft); expect(count("contracts")).toBe(0); expect(count("audit")).toBe(0);
    } finally { db.exec("DROP TRIGGER fail_audit"); }
  });
});

describe("CSRF token", () => {
  const cookieValue = (response: Response, name: string) =>
    response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${name}=`))?.split(";")[0]!.split("=")[1];
  it("is issued with a new session, then reused for that session so concurrent requests keep passing", async () => {
    const first = await csrfGet(new Request("http://localhost/api/csrf"));
    const session = cookieValue(first, "amasa_session")!; const { token } = await first.json();
    expect(cookieValue(first, "amasa_csrf")).toBe(token);
    const again = await csrfGet(new Request("http://localhost/api/csrf", { headers: { cookie: `amasa_session=${session}; amasa_csrf=${token}` } }));
    expect((await again.json()).token).toBe(token);
    expect(cookieValue(again, "amasa_csrf")).toBeUndefined();
  });
  it("is replaced when the session is invalid or the cookie is malformed", async () => {
    const valid = newSessionValue(); const old = "a".repeat(43);
    const noSession = await csrfGet(new Request("http://localhost/api/csrf", { headers: { cookie: `amasa_csrf=${old}` } }));
    expect((await noSession.json()).token).not.toBe(old);
    const malformed = await csrfGet(new Request("http://localhost/api/csrf", { headers: { cookie: `amasa_session=${valid}; amasa_csrf=short` } }));
    const { token } = await malformed.json();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookieValue(malformed, "amasa_csrf")).toBe(token);
  });
});

it("logs unexpected route errors server-side but answers with a plain message", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const failing = route(async () => { throw new TypeError("MODEL_PLANNER must be configured"); });
    const response = await failing();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: "INTERNAL", message: "Something went wrong. Please try again." });
    expect(log).toHaveBeenCalledWith("internal error: TypeError: MODEL_PLANNER must be configured");
    log.mockClear();
    expect((await route(async () => { throw new ApiError(400, "X", "Plain."); })()).status).toBe(400);
    expect(log).not.toHaveBeenCalled();
  } finally { log.mockRestore(); }
});

it("seeds three fixed profile UUIDs idempotently without duplicate audit or overwriting edits", () => {
  seed(db); const first = listProfileEntries(db); seed(db);
  expect(listProfileEntries(db)).toEqual(first); expect(count("audit")).toBe(3);
  expect(first.map((row) => row.id)).toEqual(["a3a5a000-0000-4000-8000-000000000001", "a3a5a000-0000-4000-8000-000000000002", "a3a5a000-0000-4000-8000-000000000003"]);
  expect(first.map(({ key, value, source, status }) => ({ key, value, source, status }))).toEqual([
    { key: "size", value: 10.5, source: "user_edit", status: "confirmed" },
    { key: "width", value: "wide", source: "user_edit", status: "confirmed" },
    { key: "brand_like", value: "Stride", source: "kept", status: "suggested" },
  ]);
  expect(first[2]!.note).toBe("You kept Stride shoes twice");
  updateProfileEntry(db, first[0]!.id, { value: 11 }); seed(db);
  expect(listProfileEntries(db).find((row) => row.id === first[0]!.id)?.value).toBe(11);
});
