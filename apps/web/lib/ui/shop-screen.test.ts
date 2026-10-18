import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSseParser, ProgressEvent, streamShop } from "./sse.ts";
import { initialShopState, shopReducer, summaryLine, type ShopState } from "./shop-state.ts";
import { CompareTableView, FilteredOut, OptionCards, OthersList, StepList } from "../../app/shop/[contractId]/results.tsx";
import { CategoryIllustration } from "../../app/category-illustration.tsx";

const product = (sku: string, title: string, over: Record<string, unknown> = {}) => ({
  sku, title, brand: title, sponsored: false, stock: 25, rating: 4.9, reviewCount: 160, returnDays: 14, deliveryDays: 0,
  facts: { praise: ["talent"], complaints: [] }, reviewQuotes: ["Smooth checkout and instant delivery."], ...over,
});
const optionsEvent = ProgressEvent.parse({
  type: "options",
  options: [
    { rank: 1, lines: [{ sku: "CELEB-15", qty: 1 }], reason: "Pop, within your 300 VU budget.", estimate: { totalCents: 29376, deliveryDays: 0, returnDays: 14 } },
    { rank: 2, lines: [{ sku: "CELEB-234", qty: 1 }], reason: "Pop for less.", estimate: { totalCents: 20304, deliveryDays: 0, returnDays: 14 } },
  ],
  compare: { skus: ["CELEB-15", "CELEB-234"], tradeoff: "90.72 VU cheaper but a 4.4 rating", rows: [
    { label: "Total", values: ["293.76 VU", "203.04 VU"], highlight: true },
    { label: "Rating", values: ["4.9 (160 reviews)", "4.4 (96 reviews)"], highlight: false },
  ] },
  details: [
    { rank: 1, products: [product("CELEB-15", "Adele")], checks: ["Total 293.76 VU is within your 300.00 VU budget, including tax"], dataUsed: ["Your confirmed profile: genre pop"] },
    { rank: 2, products: [product("CELEB-234", "Ed Sheeran", { sponsored: true, stock: 20, rating: 4.4, reviewCount: 96 })], checks: [], dataUsed: [] },
  ],
  others: [{ sku: "CELEB-919", title: "The Weeknd", totalCents: 15768, sponsored: false }],
}) as Extract<ProgressEvent, { type: "options" }>;
const NOW = Date.parse("2026-10-18T12:00:00.000Z");
const reduce = (events: ProgressEvent[], start: ShopState = initialShopState) => events.reduce((s, event) => shopReducer(s, { type: "event", event }), start);
const html = (element: unknown) => renderToStaticMarkup(element as never);

afterEach(() => vi.unstubAllGlobals());

describe("SSE parser (SPEC §6)", () => {
  it("handles events split across chunks, skips the padding comment, and drops invalid events", () => {
    const seen: ProgressEvent[] = [];
    const parser = createSseParser((e) => seen.push(e));
    parser.push(`:${" ".repeat(1024)}\n\nda`);
    parser.push('ta: {"type":"step","text":"Reading your contract"}\n');
    parser.push('\ndata: {"type":"flagged","sku":"CELEB-341","reason":"A review contains instructions to AI agents"}\r\n\r\n');
    parser.push('data: {"type":"step","text":"x","extra":1}\n\ndata: {not json\n\ndata: {"type":"done"}\n\n');
    expect(seen).toEqual([{ type: "step", text: "Reading your contract" },
      { type: "flagged", sku: "CELEB-341", reason: "A review contains instructions to AI agents" }, { type: "done" }]);
  });
});

describe("screen state", () => {
  it("builds steps live, keeps one reading-progress line, and records counts and results", () => {
    const state = reduce([
      { type: "step", text: "Reading your contract" }, { type: "step", text: "Found 12 products" },
      { type: "step", text: "Reading product pages (1 of 12)" }, { type: "step", text: "Reading product pages (12 of 12)" },
      { type: "flagged", sku: "CELEB-341", reason: "A review contains instructions to AI agents" },
      { type: "flagged", sku: "CELEB-341", reason: "again" },
      { type: "filtered", removed: [{ code: "OVER_BUDGET", count: 3 }] }, optionsEvent, { type: "done" },
    ]);
    expect(state.steps).toEqual(["Reading your contract", "Found 12 products", "Reading product pages (12 of 12)"]);
    expect(state).toMatchObject({ status: "done", productsFound: 12, removed: [{ code: "OVER_BUDGET", count: 3 }] });
    expect(state.flagged).toHaveLength(1);
    expect(summaryLine(state)).toBe("Checked 1 store · 12 products · 1 sponsored labeled · 1 flagged");
  });
  it("shows errors, and Cancel only applies to a running search", () => {
    expect(reduce([{ type: "error", code: "PLANNER_FAILED", message: "Please try again." }])).toMatchObject({ status: "error", error: "Please try again." });
    expect(shopReducer(initialShopState, { type: "cancelled" }).status).toBe("cancelled");
    expect(shopReducer(reduce([{ type: "done" }]), { type: "cancelled" }).status).toBe("done");
    expect(shopReducer(reduce([{ type: "done" }]), { type: "start" })).toEqual(initialShopState);
  });
});

describe("screen 4 (SPEC §16)", () => {
  it("each card shows the celebrity's photo, named in its alt text", () => {
    const markup = html(createElement(OptionCards, { result: optionsEvent, category: "musicians", open: new Set<number>(), onToggle: () => {}, now: NOW }));
    expect(markup.match(/<img /g)).toHaveLength(2);
    expect(markup).toContain('src="/api/store/products/CELEB-15/image" alt="Adele"');
    expect(markup).toContain("option-photos category-musicians");
  });
  it.each([["actors", "Actors"], ["musicians", "Musicians"], ["athletes", "Athletes"]] as const)("labels the %s artwork as a category illustration", (category, name) => {
    const markup = html(createElement(CategoryIllustration, { category }));
    expect(markup).toContain(`category-${category}`);
    expect(markup).toContain(`${name} · Category illustration`);
  });
  it("option cards show the full total in VU, instant delivery, the refund window, availability and the Sponsored label", () => {
    const markup = html(createElement(OptionCards, { result: optionsEvent, open: new Set<number>(), onToggle: () => {}, now: NOW }));
    expect(markup).toContain("1. Adele");
    expect(markup).toContain('<span class="price">293.76 VU</span>');
    expect(markup).toContain("Total · includes tax · 1 VU = $1.00");
    expect(markup).toContain("<dt>Delivery</dt><dd>Instant</dd>");
    expect(markup).toContain("<dt>Refund window</dt><dd>14 days</dd>");
    expect(markup).toContain("Store says: 25 available");
    expect(markup.match(/class="sponsored">Sponsored</g)).toHaveLength(1);
    expect(markup).toContain("Pop, within your 300 VU budget.");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toMatch(/only \d+ left|hurry|selling fast|others bought/i);
  });
  it("the Why? panel shows checks, data used, the AI summary and quotes labeled Store review", () => {
    const markup = html(createElement(OptionCards, { result: optionsEvent, open: new Set([1]), onToggle: () => {}, now: NOW }));
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain("Total 293.76 VU is within your 300.00 VU budget, including tax");
    expect(markup).toContain("Your confirmed profile: genre pop");
    expect(markup).toContain("Summary written by AI from the reviews: praised for talent.");
    expect(markup).toContain('<p class="label">Store review</p><p>Smooth checkout and instant delivery.</p>');
  });
  it("Why? toggles by rank, and Choose this option chooses by rank", () => {
    const onToggle = vi.fn(); const onChoose = vi.fn();
    type Node = { type?: unknown; props?: { children?: unknown; onClick?: () => void } };
    const all = (node: unknown): Node[] => Array.isArray(node) ? node.flatMap(all) : node && typeof node === "object" && "props" in node
      ? [node as Node, ...all((node as Node).props?.children)] : [];
    const buttons = all(OptionCards({ result: optionsEvent, open: new Set(), onToggle, now: NOW, onChoose })).filter((n) => n.type === "button");
    buttons.filter((b) => b.props?.children === "Why?")[1]!.props!.onClick!();
    buttons.filter((b) => b.props?.children === "Choose this option")[0]!.props!.onClick!();
    expect(onToggle).toHaveBeenCalledWith(2);
    expect(onChoose).toHaveBeenCalledWith(1);
    expect(html(createElement(OptionCards, { result: optionsEvent, open: new Set<number>(), onToggle, now: NOW }))).not.toContain("Choose this option");
  });
  it("the compare table marks the biggest difference in text and states the trade-off", () => {
    const markup = html(createElement(CompareTableView, { result: optionsEvent }));
    expect(markup).toContain('<tr class="highlight"><th scope="row">Total<span class="badge"> Biggest difference</span></th>');
    expect(markup).toContain("<strong>Trade-off:</strong> 90.72 VU cheaper but a 4.4 rating");
    expect(markup).toContain('<th scope="col">Ed Sheeran</th>');
    expect(html(createElement(CompareTableView, { result: { ...optionsEvent, compare: { ...optionsEvent.compare, skus: ["CELEB-15"] } } }))).toBe("");
  });
  it("Filtered out lists flagged products with reasons and plain-language counts", () => {
    const state = reduce([{ type: "flagged", sku: "CELEB-341", reason: "A review contains instructions to AI agents" },
      { type: "filtered", removed: [{ code: "MUST_HAVE_FAILED", count: 4 }, { code: "OVER_BUDGET", count: 1 }] }]);
    const markup = html(createElement(FilteredOut, { state }));
    expect(markup).toContain("<summary>Filtered out (6)</summary>");
    expect(markup).toContain("CELEB-341: A review contains instructions to AI agents");
    expect(markup).toContain("4 products missing one of your requirements");
    expect(markup).toContain("1 product over your budget, including tax");
    expect(html(createElement(FilteredOut, { state: initialShopState }))).toBe("");
  });
  it("Show more reveals the other products that fit", () => {
    expect(html(createElement(OthersList, { result: optionsEvent, shown: false, onShow: () => {} }))).toContain("Show more (1)");
    expect(html(createElement(OthersList, { result: optionsEvent, shown: true, onShow: () => {} }))).toContain("The Weeknd: 157.68 VU total");
  });
  it("steps are announced politely only while the search runs", () => {
    expect(html(createElement(StepList, { steps: ["Reading your contract"], live: true }))).toBe('<ol class="steps" aria-live="polite"><li>Reading your contract</li></ol>');
    expect(html(createElement(StepList, { steps: [], live: false }))).toContain('aria-live="off"');
  });
});

describe("stream client", () => {
  const stream = (text: string) => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } }), { status: 200 });
  it("sends the CSRF token and feeds every event to the screen", async () => {
    const fetch = vi.fn(async (url: string) => url === "/api/csrf" ? Response.json({ token: "t" })
      : stream('data: {"type":"step","text":"Reading your contract"}\n\ndata: {"type":"done"}\n\n'));
    vi.stubGlobal("fetch", fetch);
    const seen: ProgressEvent[] = [];
    await streamShop("33333333-3333-4333-8333-333333333333", new AbortController().signal, (e) => seen.push(e));
    expect(seen.map((e) => e.type)).toEqual(["step", "done"]);
    expect(fetch).toHaveBeenLastCalledWith("/api/shop", expect.objectContaining({ method: "POST", headers: { "content-type": "application/json", "x-csrf-token": "t" },
      body: JSON.stringify({ contractId: "33333333-3333-4333-8333-333333333333" }) }));
  });
  it.each([[429, { code: "RATE_LIMITED", message: "You've started many searches this hour. Please try again later." }, "You've started many searches this hour. Please try again later."],
    [500, { code: "INTERNAL", message: "stack trace" }, "Something went wrong. Please try again."]] as const)(
    "turns HTTP %s into a plain message", async (status, body, message) => {
      vi.stubGlobal("fetch", vi.fn(async (url: string) => url === "/api/csrf" ? Response.json({ token: "t" }) : Response.json(body, { status })));
      await expect(streamShop("33333333-3333-4333-8333-333333333333", new AbortController().signal, () => {})).rejects.toThrow(message);
    });
});
