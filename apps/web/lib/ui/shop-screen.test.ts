import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSseParser, ProgressEvent, streamShop } from "./sse.ts";
import { initialShopState, shopReducer, summaryLine, type ShopState } from "./shop-state.ts";
import { CompareTableView, FilteredOut, OptionCards, OthersList, StepList } from "../../app/shop/[contractId]/results.tsx";

const product = (sku: string, title: string, over: Record<string, unknown> = {}) => ({
  sku, title, brand: title.split(" ")[0]!, sponsored: false, stock: 12, rating: 4.6, reviewCount: 214, returnDays: 30, deliveryDays: 3,
  facts: { fitNotes: ["wide_friendly"], praise: ["comfort"], complaints: [] }, reviewQuotes: ["Finally enough room in the toe box."], ...over,
});
const optionsEvent = ProgressEvent.parse({
  type: "options",
  options: [
    { rank: 1, lines: [{ sku: "SHOE-WIDE-01", qty: 1 }], reason: "Wide, size 10.5, 30-day returns.", estimate: { totalCents: 13932, deliveryDays: 3, returnDays: 30 } },
    { rank: 2, lines: [{ sku: "SHOE-WIDE-02", qty: 1 }], reason: "Wide and size 10.5 for less.", estimate: { totalCents: 12636, deliveryDays: 5, returnDays: 14 } },
  ],
  compare: { skus: ["SHOE-WIDE-01", "SHOE-WIDE-02"], tradeoff: "$12.96 cheaper but 14-day returns", rows: [
    { label: "Total", values: ["$139.32", "$126.36"], highlight: false },
    { label: "Returns", values: ["30 days", "14 days"], highlight: true },
  ] },
  details: [
    { rank: 1, products: [product("SHOE-WIDE-01", "Stride Wide Road Running Shoe")], checks: ["Total $139.32 is within your $140.00 budget, including tax and shipping"], dataUsed: ["Your confirmed profile: size 10.5"] },
    { rank: 2, products: [product("SHOE-WIDE-02", "Pacer Wide Daily Road Running Shoe", { sponsored: true, stock: 8, returnDays: 14, deliveryDays: 5 })], checks: [], dataUsed: [] },
  ],
  others: [{ sku: "SHOE-WIDE-09", title: "Stride Wide Walking Shoe", totalCents: 10211, sponsored: false }],
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
    parser.push('\ndata: {"type":"flagged","sku":"SHOE-LUX-01","reason":"A review contains instructions to AI agents"}\r\n\r\n');
    parser.push('data: {"type":"step","text":"x","extra":1}\n\ndata: {not json\n\ndata: {"type":"done"}\n\n');
    expect(seen).toEqual([{ type: "step", text: "Reading your contract" },
      { type: "flagged", sku: "SHOE-LUX-01", reason: "A review contains instructions to AI agents" }, { type: "done" }]);
  });
});

describe("screen state", () => {
  it("builds steps live, keeps one reading-progress line, and records counts and results", () => {
    const state = reduce([
      { type: "step", text: "Reading your contract" }, { type: "step", text: "Found 12 products" },
      { type: "step", text: "Reading product pages (1 of 12)" }, { type: "step", text: "Reading product pages (12 of 12)" },
      { type: "flagged", sku: "SHOE-LUX-01", reason: "A review contains instructions to AI agents" },
      { type: "flagged", sku: "SHOE-LUX-01", reason: "again" },
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
  it("option cards show the full total, delivery date, returns, store stock and the Sponsored label", () => {
    const markup = html(createElement(OptionCards, { result: optionsEvent, open: new Set<number>(), onToggle: () => {}, now: NOW }));
    expect(markup).toContain("1. Stride Wide Road Running Shoe");
    expect(markup).toContain("$139.32, includes tax and shipping");
    expect(markup).toContain("Arrives by Wed, Oct 21 (3 days)");
    expect(markup).toContain("Store says: 12 in stock");
    expect(markup.match(/class="sponsored">Sponsored</g)).toHaveLength(1);
    expect(markup).toContain("Wide, size 10.5, 30-day returns.");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toMatch(/only \d+ left|hurry|selling fast|others bought/i);
  });
  it("the Why? panel shows checks, data used, the AI summary and quotes labeled Store review", () => {
    const markup = html(createElement(OptionCards, { result: optionsEvent, open: new Set([1]), onToggle: () => {}, now: NOW }));
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain("Total $139.32 is within your $140.00 budget, including tax and shipping");
    expect(markup).toContain("Your confirmed profile: size 10.5");
    expect(markup).toContain("Summary written by AI from the reviews: good for wide feet, praised for comfort.");
    expect(markup).toContain('<p class="label">Store review</p><p>Finally enough room in the toe box.</p>');
  });
  it("Why? toggles by rank", () => {
    const onToggle = vi.fn();
    const tree = OptionCards({ result: optionsEvent, open: new Set(), onToggle, now: NOW }) as { props: { children: Array<{ props: { children: unknown[] } }> } };
    const card = tree.props.children[1]!;
    const button = (card.props.children as Array<{ type?: string; props?: { onClick?: () => void } }>).find((c) => c?.type === "button")!;
    button.props!.onClick!();
    expect(onToggle).toHaveBeenCalledWith(2);
  });
  it("the compare table marks the biggest difference in text and states the trade-off", () => {
    const markup = html(createElement(CompareTableView, { result: optionsEvent }));
    expect(markup).toContain('<tr class="highlight"><th scope="row">Returns<span class="badge"> Biggest difference</span></th>');
    expect(markup).toContain("<strong>Trade-off:</strong> $12.96 cheaper but 14-day returns");
    expect(markup).toContain('<th scope="col">Pacer Wide Daily Road Running Shoe</th>');
    expect(html(createElement(CompareTableView, { result: { ...optionsEvent, compare: { ...optionsEvent.compare, skus: ["SHOE-WIDE-01"] } } }))).toBe("");
  });
  it("Filtered out lists flagged products with reasons and plain-language counts", () => {
    const state = reduce([{ type: "flagged", sku: "SHOE-LUX-01", reason: "A review contains instructions to AI agents" },
      { type: "filtered", removed: [{ code: "MUST_HAVE_FAILED", count: 4 }, { code: "OVER_BUDGET", count: 1 }] }]);
    const markup = html(createElement(FilteredOut, { state }));
    expect(markup).toContain("<summary>Filtered out (6)</summary>");
    expect(markup).toContain("SHOE-LUX-01: A review contains instructions to AI agents");
    expect(markup).toContain("4 products missing one of your requirements");
    expect(markup).toContain("1 product over your budget, including tax and shipping");
    expect(html(createElement(FilteredOut, { state: initialShopState }))).toBe("");
  });
  it("Show more reveals the other products that fit", () => {
    expect(html(createElement(OthersList, { result: optionsEvent, shown: false, onShow: () => {} }))).toContain("Show more (1)");
    expect(html(createElement(OthersList, { result: optionsEvent, shown: true, onShow: () => {} }))).toContain("Stride Wide Walking Shoe: $102.11 total");
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
