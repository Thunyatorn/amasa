import type { ProgressEvent } from "./sse.ts";

// Screen 3–4 state, built only from the run's events (SPEC §6). Pure, so it is tested directly.
type OptionsEvent = Extract<ProgressEvent, { type: "options" }>;
export type PreparedEvent = Extract<ProgressEvent, { type: "prepared" }>;
export type ShopState = {
  status: "running" | "done" | "cancelled" | "error";
  steps: string[];
  productsFound: number | null;
  flagged: { sku: string; reason: string }[];
  removed: { code: string; count: number }[];
  result: OptionsEvent | null;
  prepared: PreparedEvent | null;
  error: string | null;
};
export type ShopAction = { type: "start" } | { type: "event"; event: ProgressEvent } | { type: "cancelled" } | { type: "failed"; message: string };

export const initialShopState: ShopState = { status: "running", steps: [], productsFound: null, flagged: [], removed: [], result: null, prepared: null, error: null };

export function shopReducer(state: ShopState, action: ShopAction): ShopState {
  switch (action.type) {
    case "start": return initialShopState;
    case "cancelled": return state.status === "running" ? { ...state, status: "cancelled" } : state;
    case "failed": return { ...state, status: "error", error: action.message };
    case "event": {
      const event = action.event;
      switch (event.type) {
        case "step": {
          const found = /^Found (\d+) products?$/.exec(event.text);
          // "Reading product pages (n of m)" replaces the previous reading line instead of piling up.
          const reading = event.text.startsWith("Reading product pages");
          const steps = reading && state.steps.at(-1)?.startsWith("Reading product pages") ? [...state.steps.slice(0, -1), event.text] : [...state.steps, event.text];
          return { ...state, steps, productsFound: found ? Number(found[1]) : state.productsFound };
        }
        case "flagged": return state.flagged.some((f) => f.sku === event.sku) ? state : { ...state, flagged: [...state.flagged, { sku: event.sku, reason: event.reason }] };
        case "filtered": return { ...state, removed: event.removed };
        case "options": return { ...state, result: event };
        case "prepared": return { ...state, prepared: event };
        case "error": return { ...state, status: "error", error: event.message };
        case "done": return { ...state, status: "done" };
      }
    }
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// "Checked 1 store · 12 products · 0 sponsored labeled · 1 flagged" (SPEC §6).
export function summaryLine(state: ShopState): string {
  const shown = state.result ? [...state.result.details.flatMap((d) => d.products), ...state.result.others] : [];
  const sponsored = new Set(shown.filter((p) => p.sponsored).map((p) => p.sku)).size;
  return [
    "Checked 1 store",
    state.productsFound === null ? null : plural(state.productsFound, "product"),
    state.result ? `${sponsored} sponsored labeled` : null,
    `${state.flagged.length} flagged`,
  ].filter(Boolean).join(" · ");
}

export const REMOVED_WORDS: Record<string, string> = {
  MERCHANT_NOT_ALLOWED: "from a store your contract doesn't allow",
  OUT_OF_STOCK: "out of stock",
  MUST_HAVE_FAILED: "missing one of your requirements",
  OVER_BUDGET: "over your budget, including tax",
  RETURN_WINDOW_SHORT: "return window shorter than you asked",
  DEADLINE_MISSED: "won't arrive by your deadline",
};

export const filteredCount = (state: ShopState) => state.flagged.length + state.removed.reduce((n, r) => n + r.count, 0);
