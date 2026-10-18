import { CompareTable, Option, priceLines, type Contract, type PricingConfig, type StoreListing } from "@amasa/schemas";
import { ruleHolds } from "@amasa/verifier";
import { stripUrgency } from "@amasa/reader";

// SPEC §7.4 step 7: option estimates and the compare table are written by code; only `reason` comes
// from the planner (urgency stripped, plain text).

export const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
const OP_WORDS = { eq: "is", gte: "at least", lte: "at most", includes: "includes" } as const;

export type Proposal = { lines: { sku: string; qty: number }[]; reason: string };

export function buildOptions(proposals: readonly Proposal[], listings: ReadonlyMap<string, StoreListing>, pricing: PricingConfig): Option[] {
  return proposals.slice(0, 3).map((proposal, index) => {
    const lines = proposal.lines.map((line) => ({ line, listing: listings.get(line.sku)! }));
    return Option.parse({
      rank: index + 1,
      lines: proposal.lines.map(({ sku, qty }) => ({ sku, qty })),
      reason: stripUrgency(proposal.reason).slice(0, 120),
      estimate: {
        totalCents: priceLines(lines.map(({ line, listing }) => ({ unitCents: listing.unitCents, qty: line.qty })), pricing).totalCents,
        deliveryDays: Math.max(...lines.map(({ listing }) => listing.deliveryDays)),
        returnDays: Math.min(...lines.map(({ listing }) => listing.returnDays)),
      },
    });
  });
}

type Facts = { total: number; delivery: number; returns: number; rating: number };

function optionFacts(option: Option, listings: ReadonlyMap<string, StoreListing>): Facts {
  return { total: option.estimate.totalCents, delivery: option.estimate.deliveryDays, returns: option.estimate.returnDays,
    rating: Math.min(...option.lines.map((line) => listings.get(line.sku)!.rating)) };
}

const relative = (values: number[]) => {
  const max = Math.max(...values), min = Math.min(...values);
  return max === 0 ? 0 : (max - min) / max;
};

// The trade-off compares the cheapest option with the best-ranked other option, so it reads the same
// whichever of the two the planner put first, e.g. "$12.96 cheaper but 14-day returns".
export function tradeoff(options: readonly Option[], listings: ReadonlyMap<string, StoreListing>): string {
  if (options.length === 0) return "";
  if (options.length === 1) return "Only one product fits your contract.";
  const ranked = [...options].sort((a, b) => a.rank - b.rank);
  const cheapest = ranked.reduce((best, option) => option.estimate.totalCents < best.estimate.totalCents ? option : best);
  const other = ranked.find((option) => option !== cheapest)!;
  const c = optionFacts(cheapest, listings), r = optionFacts(other, listings);
  const saving = r.total - c.total;
  if (saving <= 0) return "The options cost the same.";
  const downsides = [
    { size: c.delivery > r.delivery ? (c.delivery - r.delivery) / c.delivery : 0, phrase: `${c.delivery}-day delivery` },
    { size: c.returns < r.returns ? (r.returns - c.returns) / r.returns : 0, phrase: `${c.returns}-day returns` },
    { size: c.rating < r.rating ? (r.rating - c.rating) / r.rating : 0, phrase: `a ${c.rating.toFixed(1)} rating` },
  ].filter((d) => d.size > 0);
  if (!downsides.length) return `${money(saving)} cheaper with no downside on delivery, returns or rating`;
  const worst = downsides.reduce((a, b) => (b.size > a.size ? b : a));
  return `${money(saving)} cheaper but ${worst.phrase}`;
}

export function compareTable(options: readonly Option[], listings: ReadonlyMap<string, StoreListing>, contract: Contract): CompareTable {
  const ranked = [...options].sort((a, b) => a.rank - b.rank);
  const facts = ranked.map((option) => optionFacts(option, listings));
  const numeric = [
    { label: "Total", values: facts.map((f) => money(f.total)), size: relative(facts.map((f) => f.total)) },
    { label: "Delivery", values: facts.map((f) => days(f.delivery)), size: relative(facts.map((f) => f.delivery)) },
    { label: "Returns", values: facts.map((f) => days(f.returns)), size: relative(facts.map((f) => f.returns)) },
  ];
  const rating = { label: "Rating", values: ranked.map((option, i) => {
    const reviews = option.lines.length === 1 ? ` (${listings.get(option.lines[0]!.sku)!.reviewCount} reviews)` : "";
    return `${facts[i]!.rating.toFixed(1)}${reviews}`;
  }), size: relative(facts.map((f) => f.rating)) };
  const highlightSize = ranked.length > 1 ? Math.max(...[...numeric, rating].map((row) => row.size)) : 0;
  let highlighted = false;
  const mark = (size: number) => {
    const on = !highlighted && highlightSize > 0 && size === highlightSize;
    if (on) highlighted = true;
    return on;
  };
  const mustHaveRows = contract.mustHave.map((rule) => ({
    label: `${rule.key.replaceAll("_", " ")} ${OP_WORDS[rule.op]} ${rule.value}`,
    values: ranked.map((option) => option.lines.every((line) => ruleHolds(rule, listings.get(line.sku)!.attributes[rule.key])) ? "Yes" : "No"),
    highlight: false,
  }));
  return CompareTable.parse({
    skus: ranked.map((option) => option.lines[0]!.sku),
    rows: [...numeric.map((row) => ({ label: row.label, values: row.values, highlight: mark(row.size) })), ...mustHaveRows,
      { label: rating.label, values: rating.values, highlight: mark(rating.size) }],
    tradeoff: tradeoff(ranked, listings),
  });
}
