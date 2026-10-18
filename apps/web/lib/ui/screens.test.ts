import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const harness = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => unknown)[], push: vi.fn(), params: { id: "12345678-1234-4123-8123-123456789abc", contractId: "12345678-1234-4123-8123-123456789abc" } }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const index = harness.cursor++; if (!(index in harness.slots)) harness.slots[index] = typeof initial === "function" ? (initial as () => unknown)() : initial; return [harness.slots[index], (value: unknown) => { harness.slots[index] = typeof value === "function" ? (value as (previous: unknown) => unknown)(harness.slots[index]) : value; }]; },
  useRef: (initial: unknown) => { const index = harness.cursor++; if (!(index in harness.slots)) harness.slots[index] = { current: initial }; return harness.slots[index]; },
  useEffect: (effect: () => unknown) => { harness.effects.push(effect); },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: harness.push }), useParams: () => harness.params }));
import Home from "../../app/page.tsx";
import ContractPage from "../../app/contract/[id]/page.tsx";
import { api, ContractDraft, DraftResult, editedDraft, fieldsFromDraft } from "./contracts.ts";

const draft = ContractDraft.parse({ category: "running-shoes", goal: "Wide shoes", quantity: 1, budgetCapCents: 14000, mustHave: [{ key: "width", op: "eq", value: "wide" }, { key: "sizes_available", op: "includes", value: "10.5" }, { key: "brand", op: "eq", value: "Example" }], allowedMerchants: ["demo-store"], minReturnDays: 30, question: null });
function render(component: () => unknown) { harness.cursor = 0; return component() as Element; }
type Element = { type: unknown; props: Record<string, unknown> & { children?: unknown } };
function elements(node: unknown): Element[] { if (Array.isArray(node)) return node.flatMap(elements); if (!node || typeof node !== "object" || !("props" in node)) return []; const element = node as Element; return [element, ...elements(element.props.children)]; }
function find(tree: unknown, predicate: (element: Element) => boolean) { const found = elements(tree).find(predicate); if (!found) throw new Error("Expected control was missing"); return found; }
function event(element: Element, name: string, value?: string | boolean) { return (element.props[name] as (event: unknown) => unknown)({ preventDefault() {}, target: { value, checked: value } }); }
const response = (value: unknown, ok = true) => ({ ok, json: async () => value });
function mockFetch(value: unknown, ok = true) { const mock = vi.fn(async (url: string) => url === "/api/csrf" ? response({ token: "test-token" }) : response(value, ok)); vi.stubGlobal("fetch", mock); return mock; }
async function loadContract(value = draft) { mockFetch({ draft: value }); render(ContractPage); harness.effects[0]!(); await vi.waitFor(() => expect(harness.slots[0]).not.toBeNull()); return render(ContractPage); }
beforeEach(() => { vi.setSystemTime(new Date("2026-10-17T12:00:00.000Z")); harness.slots = []; harness.cursor = 0; harness.effects = []; harness.push.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("goal screen", () => {
  it("renders a labelled goal input, three example buttons and a stable initial snapshot", () => {
    const markup = renderToStaticMarkup(createElement(Home));
    expect(markup).toContain('for="goal"'); expect(markup).toContain("300 characters remaining");
    expect(markup.match(/class="secondary"/g)).toHaveLength(3);
    expect(markup).toMatchSnapshot();
  });
  it.each(["ab", "a".repeat(301), "   "])("rejects an invalid goal", async (goal) => {
    const fetch = mockFetch({}); let tree = render(Home); event(find(tree, (node) => node.props.id === "goal"), "onChange", goal); tree = render(Home);
    await event(find(tree, (node) => node.type === "form"), "onSubmit");
    expect(fetch).not.toHaveBeenCalled(); expect(renderToStaticMarkup(render(Home) as never)).toContain("between 3 and 300");
  });
  it("selects examples and submits the correct API body with CSRF then navigates", async () => {
    const fetch = mockFetch({ draftId: harness.params.id, draft }); let tree = render(Home);
    event(find(tree, (node) => node.props.className === "secondary"), "onClick"); tree = render(Home);
    await event(find(tree, (node) => node.type === "form"), "onSubmit");
    expect(fetch).toHaveBeenLastCalledWith("/api/intake", expect.objectContaining({ method: "POST", headers: { "content-type": "application/json", "x-csrf-token": "test-token" }, body: expect.stringContaining("Wide running shoes") }));
    expect(harness.push).toHaveBeenCalledWith(`/contract/${harness.params.id}`);
  });
  it.each(["abc", "a".repeat(300)])("accepts goal length boundaries", async (goal) => {
    mockFetch({ draftId: harness.params.id, draft }); let tree = render(Home);
    event(find(tree, (node) => node.props.id === "goal"), "onChange", goal); tree = render(Home);
    await event(find(tree, (node) => node.type === "form"), "onSubmit"); expect(harness.push).toHaveBeenCalled();
  });
  it("keeps the goal and displays the API message on failure", async () => {
    mockFetch({ code: "INTAKE_FAILED", message: "Please try again." }, false); let tree = render(Home);
    event(find(tree, (node) => node.props.id === "goal"), "onChange", "Wide shoes"); tree = render(Home); await event(find(tree, (node) => node.type === "form"), "onSubmit"); tree = render(Home);
    expect(find(tree, (node) => node.props.id === "goal").props.value).toBe("Wide shoes"); expect(renderToStaticMarkup(tree as never)).toContain("Please try again.");
  });
});
describe("contract screen", () => {
  it("renders without crashing and has labels for every editable control", async () => {
    const tree = await loadContract(); const markup = renderToStaticMarkup(tree as never); expect(markup).toMatchSnapshot();
    for (const id of ["budget", "quantity", "returns", "deadline", "width", "size"]) expect(markup).toContain(`for="${id}"`);
    expect(find(tree, (node) => node.props.id === "budget").props.value).toBe("140.00");
    expect(find(tree, (node) => node.props.id === "width").type).toBe("select");
    expect(find(tree, (node) => node.props.id === "quantity").props.type).toBe("number");
  });
  it("disables confirmation until a budget is set", async () => { const tree = await loadContract({ ...draft, budgetCapCents: null }); expect(find(tree, (node) => node.props.type === "submit").props.disabled).toBe(true); });
  it("removes other rules in memory and submits integer cents", async () => {
    let tree = await loadContract(); event(find(tree, (node) => node.props["aria-label"] === "Remove brand requirement"), "onClick"); tree = render(ContractPage);
    expect(elements(tree).some((node) => node.props["aria-label"] === "Remove brand requirement")).toBe(false);
    event(find(tree, (node) => node.props.id === "budget"), "onChange", "150.25"); tree = render(ContractPage);
    const fetch = mockFetch({ contract: { ...draft, question: undefined, budgetCapCents: 15025, id: harness.params.id, confirmedAt: new Date().toISOString() }, contractHash: "a".repeat(64) });
    // A real response omits the draft-only question key.
    fetch.mockImplementation(async (url) => url === "/api/csrf" ? response({ token: "test-token" }) : response({ contract: { ...(({ question: _, ...rest }) => rest)(draft), budgetCapCents: 15025, id: harness.params.id, confirmedAt: new Date().toISOString() }, contractHash: "a".repeat(64) }));
    await event(find(tree, (node) => node.type === "form"), "onSubmit");
    const options = fetch.mock.calls.find(([url]) => url === "/api/contracts") as unknown as [string, RequestInit];
    expect(JSON.parse(options[1].body as string).draft.budgetCapCents).toBe(15025);
    expect(JSON.parse(options[1].body as string).draft.mustHave.some((rule: { key: string }) => rule.key === "brand")).toBe(false);
    expect(harness.push).toHaveBeenCalledWith(`/shop/${harness.params.id}`);
  });
  it("preserves edited values after confirmation fails", async () => {
    let tree = await loadContract(); event(find(tree, (node) => node.props.id === "budget"), "onChange", "122.00"); tree = render(ContractPage); mockFetch({ code: "FAIL", message: "Please try again." }, false); await event(find(tree, (node) => node.type === "form"), "onSubmit"); tree = render(ContractPage); expect(find(tree, (node) => node.props.id === "budget").props.value).toBe("122.00"); expect(renderToStaticMarkup(tree as never)).toContain("Please try again.");
  });
  it("requires explicit acknowledgment of an open question", async () => { const tree = await loadContract({ ...draft, question: "Please clarify: color." }); expect(find(tree, (node) => node.props.id === "answered").props.checked).toBe(false); await event(find(tree, (node) => node.type === "form"), "onSubmit"); expect(renderToStaticMarkup(render(ContractPage) as never)).toContain("Review the open question"); });
});
describe("draft validation", () => {
  it.each(["0", "5000.01", "1.001", "-1", "Infinity", ""])("rejects invalid budget %s", (budget) => { expect(() => editedDraft(draft, { ...fieldsFromDraft(draft), budget }, "2026-10-17")).toThrow("budget"); });
  it("accepts the one-cent and maximum boundaries", () => { for (const budget of ["0.01", "5000.00"]) expect(editedDraft(draft, { ...fieldsFromDraft(draft), budget }, "2026-10-17").budgetCapCents).toBe(Math.round(Number(budget) * 100)); });
  it.each(["2026-10-16", "2026-02-30"])("rejects past or invalid deadline %s", (deadline) => { expect(() => editedDraft(draft, { ...fieldsFromDraft(draft), deadline }, "2026-10-17")).toThrow(deadline === "2026-10-16" ? "The date cannot be in the past." : "deadline"); });
  it("accepts today and stores numeric size as a typed rule", () => { const result = editedDraft(draft, { ...fieldsFromDraft(draft), deadline: "2026-10-17", size: "11.5" }, "2026-10-17"); expect(result.deadline).toBe("2026-10-17"); expect(result.mustHave).toContainEqual({ key: "sizes_available", op: "includes", value: "11.5" }); });
  it("preserves extra typed constraints and unsupported operators", () => {
    const extra = [{ key: "width", op: "eq" as const, value: "narrow" }, { key: "size", op: "gte" as const, value: 10 }];
    const loaded = ContractDraft.parse({ ...draft, mustHave: [...draft.mustHave, ...extra] });
    const result = editedDraft(loaded, fieldsFromDraft(loaded), "2026-10-17");
    for (const rule of extra) expect(result.mustHave).toContainEqual(rule);
  });
  it.each([{ quantity: "0" }, { quantity: "1.5" }, { minReturnDays: "-1" }, { minReturnDays: "366" }, { size: "ten" }])("rejects invalid numeric fields", (fields) => {
    expect(() => editedDraft(draft, { ...fieldsFromDraft(draft), ...fields }, "2026-10-17")).toThrow();
  });
  it("rejects malformed successful API data", async () => { mockFetch({ draft: { nope: true } }); await expect(api("/api/drafts/example", DraftResult)).rejects.toThrow("read the response"); });
});
it("provides visible focus styles and AA text contrast in the editorial theme", () => {
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8"); expect(css).toContain(":focus, :focus-visible"); expect(css).toContain("outline: 3px solid");
  const luminance = (hex: string) => { const channels = hex.match(/\w\w/g)!.map((part) => parseInt(part, 16) / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4); return channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722; };
  const themes = [...css.matchAll(/:root \{([^}]+)\}/g)]; expect(themes).toHaveLength(1);
  for (const theme of themes) {
    const colors = Object.fromEntries([...theme[1]!.matchAll(/--([a-z-]+): #([a-f0-9]{6})/g)].map((match) => [match[1], match[2]]));
    for (const [foreground, background] of [["text", "surface"], ["muted", "surface"], ["accent", "surface"], ["button-text", "accent"]]) {
      const values = [luminance(colors[foreground!]!), luminance(colors[background!]!)].sort((a, b) => b - a); expect((values[0]! + .05) / (values[1]! + .05)).toBeGreaterThan(4.5);
    }
  }
});


describe("M3 polish regressions", () => {
  it("prefills and focuses example goals and updates the counter as you type", () => {
    let tree = render(Home);
    const focus = vi.fn();
    (find(tree, (node) => node.props.id === "goal").props.ref as { current: unknown }).current = { focus };
    const example = find(tree, (node) => node.props.className === "secondary");
    event(example, "onClick");
    tree = render(Home);
    expect(find(tree, (node) => node.props.id === "goal").props.value).toBe((example.props.children as Element[])[1]!.props.children);
    expect(focus).toHaveBeenCalledOnce();
    event(find(tree, (node) => node.props.id === "goal"), "onChange", "Shoes");
    expect(renderToStaticMarkup(render(Home) as never)).toContain("295 characters remaining");
  });
  it.each(["invalid", "12345678-1234-4123-8123-123456789abc"])("shows a recoverable error for missing or invalid draft %s", async (id) => {
    const previous = harness.params.id;
    harness.params.id = id;
    try {
      mockFetch({ code: "DRAFT_NOT_FOUND", message: "This draft could not be found." }, false);
      render(ContractPage); harness.effects[0]!();
      await vi.waitFor(() => expect(harness.slots[4]).toBe(false));
      const markup = renderToStaticMarkup(render(ContractPage) as never);
      expect(markup).toContain(id === "invalid" ? "Choose a valid draft" : "This draft could not be found.");
      expect(markup).toContain("Back to home");
    } finally { harness.params.id = previous; }
  });
  it("focuses the review heading after the draft loads", async () => {
    const tree = await loadContract(); const focus = vi.fn();
    (find(tree, (node) => node.type === "h1").props.ref as { current: unknown }).current = { focus };
    harness.effects.at(-1)!(); expect(focus).toHaveBeenCalledOnce();
  });
  it.each(["140", "140.0", "0.01", "10.00", "100.25"])("formats budget %s to two decimal places and enables confirmation", async (budget) => {
    let tree = await loadContract({ ...draft, budgetCapCents: null });
    event(find(tree, (node) => node.props.id === "budget"), "onChange", budget);
    tree = render(ContractPage); event(find(tree, (node) => node.props.id === "budget"), "onBlur");
    tree = render(ContractPage);
    expect(find(tree, (node) => node.props.id === "budget").props.value).toBe(Number(budget).toFixed(2));
    expect(find(tree, (node) => node.props.type === "submit").props.disabled).toBe(false);
  });
  it.each([["budget", "5000.01"], ["deadline", "2026-10-16"]])("marks and focuses invalid %s without posting edits", async (field, value) => {
    let tree = await loadContract();
    const focus = vi.fn();
    class Control { focus = focus; }
    vi.stubGlobal("HTMLElement", Control);
    const namedItem = vi.fn(() => new Control());
    (find(tree, (node) => node.type === "form").props.ref as { current: unknown }).current = { elements: { namedItem } };
    event(find(tree, (node) => node.props.id === field), "onChange", value);
    tree = render(ContractPage); const fetch = mockFetch({});
    await event(find(tree, (node) => node.type === "form"), "onSubmit");
    tree = render(ContractPage);
    expect(find(tree, (node) => node.props.id === field).props["aria-invalid"]).toBe(true);
    expect(namedItem).toHaveBeenCalledWith(field);
    expect(focus).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(tree as never)).toContain("$5,000.00");
  });
  it.each([
    ["/api/intake", 429, "You've reached the hourly goal limit. Please try again later."],
    ["/api/contracts", 409, "This draft was already confirmed. Please create a new goal."],
    ["/api/intake", 502, "Something went wrong. Please try again."],
    ["/api/contracts", 500, "Something went wrong. Please try again."],
  ] as const)("uses safe copy for %s status %s even with a non-JSON response", async (url, status, message) => {
    vi.stubGlobal("fetch", vi.fn(async (path: string) => path === "/api/csrf" ? response({ token: "test-token" }) : { ok: false, status, json: async () => { throw new Error("internal details"); } }));
    await expect(api(url, DraftResult, {})).rejects.toThrow(message);
  });
  it("uses plain intake network error copy and clears Thinking", async () => {
    let tree = render(Home); event(find(tree, (node) => node.props.id === "goal"), "onChange", "Wide shoes");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { if (url === "/api/csrf") return response({ token: "test-token" }); throw new Error("network stack trace"); }));
    tree = render(Home); await event(find(tree, (node) => node.type === "form"), "onSubmit");
    const markup = renderToStaticMarkup(render(Home) as never);
    expect(markup).toContain("I couldn&#x27;t read that goal just now. Please try again.");
    expect(markup).not.toContain("Thinking...");
  });
  it("runs goal to review edits and lands on the shopping screen", async () => {
    const confirmed = { contract: { ...(({ question: _, ...rest }) => rest)(draft), budgetCapCents: 10025, id: harness.params.id, confirmedAt: "2026-10-17T00:00:00.000Z" }, contractHash: "b".repeat(64) };
    const fetch = vi.fn(async (url: string) => response(url === "/api/csrf" ? { token: "test-token" } : url === "/api/intake" ? { draftId: harness.params.id, draft } : url.startsWith("/api/drafts/") ? { draft } : confirmed));
    vi.stubGlobal("fetch", fetch);
    let tree = render(Home); event(find(tree, (node) => node.props.id === "goal"), "onChange", "Wide shoes");
    tree = render(Home); await event(find(tree, (node) => node.type === "form"), "onSubmit");
    expect(harness.push).toHaveBeenLastCalledWith(`/contract/${harness.params.id}`);
    harness.slots = []; harness.effects = []; render(ContractPage); harness.effects[0]!();
    await vi.waitFor(() => expect(harness.slots[0]).not.toBeNull());
    tree = render(ContractPage); event(find(tree, (node) => node.props.id === "budget"), "onChange", "100.25");
    tree = render(ContractPage); await event(find(tree, (node) => node.type === "form"), "onSubmit");
    expect(harness.push).toHaveBeenLastCalledWith(`/shop/${harness.params.id}`);
  });
});

it("uses generic error copy for a non-JSON session server failure", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ status: 503, json: async () => { throw new Error("private details"); } })));
  await expect(api("/api/intake", DraftResult, {})).rejects.toThrow("Something went wrong. Please try again.");
});

it.each(["groceries", "household"] as const)("preserves removable %s package size without a numeric size editor", async (category) => {
  const rule = { key: "size", op: "eq" as const, value: "1 kg" };
  const packageDraft = ContractDraft.parse({ ...draft, category, mustHave: [rule] });
  const tree = await loadContract(packageDraft);
  expect(elements(tree).some((node) => node.props.id === "size")).toBe(false);
  expect(elements(tree).some((node) => node.props["aria-label"] === "Remove size requirement")).toBe(true);
  expect(fieldsFromDraft(packageDraft).size).toBe("");
  expect(editedDraft(packageDraft, fieldsFromDraft(packageDraft), "2026-10-17").mustHave).toEqual([rule]);
});

describe("M3 review fixes", () => {
  const confirmedBody = (value: ContractDraft) => ({ contract: { ...(({ question: _, ...rest }) => rest)(value), id: harness.params.id, confirmedAt: "2026-10-17T00:00:00.000Z" }, contractHash: "c".repeat(64) });
  const postedDraft = (fetch: ReturnType<typeof mockFetch>) => {
    const call = fetch.mock.calls.find(([url]) => url === "/api/contracts") as unknown as [string, RequestInit] | undefined;
    return call ? JSON.parse(call[1].body as string) : undefined;
  };

  it("edits other requirements in place and keeps numeric values numeric", async () => {
    const household = ContractDraft.parse({ ...draft, category: "household", mustHave: [{ key: "watts", op: "lte", value: 9 }, { key: "scent", op: "eq", value: "lemon" }] });
    let tree = await loadContract(household);
    expect(find(tree, (node) => node.props.htmlFor === "rule-0").props.children).toBe("watts at most");
    event(find(tree, (node) => node.props.id === "rule-0"), "onChange", "12"); tree = render(ContractPage);
    event(find(tree, (node) => node.props.id === "rule-1"), "onChange", " lavender "); tree = render(ContractPage);
    const fetch = mockFetch(confirmedBody(household));
    await event(find(tree, (node) => node.type === "form"), "onSubmit");
    expect(postedDraft(fetch).draft.mustHave).toEqual([{ key: "watts", op: "lte", value: 12 }, { key: "scent", op: "eq", value: "lavender" }]);
  });

  it("rejects an empty or non-numeric requirement value with a field error", () => {
    const watts = { key: "watts", op: "lte" as const, value: 9 }, scent = { key: "scent", op: "eq" as const, value: "lemon" };
    const household = ContractDraft.parse({ ...draft, category: "household", mustHave: [watts, scent] });
    const fields = fieldsFromDraft(household);
    expect(() => editedDraft(household, fields, "2026-10-17", [{ rule: watts, value: "nine" }, { rule: scent, value: "lemon" }])).toThrow("Enter a number");
    expect(() => editedDraft(household, fields, "2026-10-17", [{ rule: watts, value: "9" }, { rule: scent, value: "  " }])).toThrow("or remove it");
  });

  it("offers width and size controls only for running shoes", async () => {
    const groceries = ContractDraft.parse({ ...draft, category: "groceries", mustHave: [{ key: "type", op: "eq", value: "oats" }] });
    const tree = await loadContract(groceries);
    expect(elements(tree).some((node) => node.props.id === "width")).toBe(false);
    expect(elements(tree).some((node) => node.props.id === "size")).toBe(false);
    expect(editedDraft(groceries, { ...fieldsFromDraft(groceries), width: "wide", size: "10" }, "2026-10-17").mustHave).toEqual([{ key: "type", op: "eq", value: "oats" }]);
  });

  it("shows requirements the store can't check and blocks confirming until each is removed", async () => {
    const color = { key: "color", op: "eq" as const, value: "red" };
    mockFetch({ draft, unsupported: [color] }); render(ContractPage); harness.effects[0]!();
    await vi.waitFor(() => expect(harness.slots[0]).not.toBeNull());
    let tree = render(ContractPage);
    const markup = renderToStaticMarkup(tree as never);
    expect(markup).toContain("Amasa can&#x27;t check these at demo-store");
    expect(markup).toContain("color is red");
    let fetch = mockFetch({});
    await event(find(tree, (node) => node.type === "form"), "onSubmit");
    expect(fetch).not.toHaveBeenCalled();
    tree = render(ContractPage);
    expect(renderToStaticMarkup(tree as never)).toContain("Remove each requirement Amasa can&#x27;t check");
    expect(find(tree, (node) => node.props.id === "unsupported-0").props["aria-invalid"]).toBe(true);
    event(find(tree, (node) => node.props.id === "unsupported-0"), "onClick"); tree = render(ContractPage);
    expect(elements(tree).some((node) => node.props.id === "unsupported-0")).toBe(false);
    fetch = mockFetch(confirmedBody(draft));
    await event(find(tree, (node) => node.type === "form"), "onSubmit");
    expect(postedDraft(fetch).acknowledgedUnsupported).toBe(true);
    expect(harness.push).toHaveBeenCalledWith(`/shop/${harness.params.id}`);
  });

  it("does not send an acknowledgment when there was nothing to acknowledge", async () => {
    const tree = await loadContract(); const fetch = mockFetch(confirmedBody(draft));
    await event(find(tree, (node) => node.type === "form"), "onSubmit");
    expect(postedDraft(fetch)).not.toHaveProperty("acknowledgedUnsupported");
  });

  it("clears the open-question error once the box is ticked", async () => {
    let tree = await loadContract({ ...draft, question: "Is quantity 1 right?" });
    await event(find(tree, (node) => node.type === "form"), "onSubmit"); tree = render(ContractPage);
    expect(renderToStaticMarkup(tree as never)).toContain("Review the open question");
    event(find(tree, (node) => node.props.id === "answered"), "onChange", true); tree = render(ContractPage);
    expect(renderToStaticMarkup(tree as never)).not.toContain("Review the open question");
  });
});
