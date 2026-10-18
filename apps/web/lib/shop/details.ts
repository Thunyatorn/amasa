import { OptionDetail, OtherSurvivor, type Contract, type Option, type PricingConfig, type ProfileEntry, type ReaderFacts, type StoreListing } from "@amasa/schemas";
import { money } from "./compare.ts";
import { estimateTotalCents } from "./prefilter.ts";

// The "Why?" panel and "Show more" list (SPEC §16 screen 4), written by code from store data. Only
// `facts` (typed enums) and `reviewQuotes` (store review text, labeled as such) come from the page.

export type Checked = { listing: StoreListing; facts: ReaderFacts; reviewQuotes: string[] };

const OP_WORDS = { eq: "is", gte: "at least", lte: "at most", includes: "includes" } as const;
const ruleText = (rule: Contract["mustHave"][number]) => `${rule.key.replaceAll("_", " ")} ${OP_WORDS[rule.op]} ${rule.value}`;

export function dataUsed(contract: Contract, profile: readonly ProfileEntry[]): string[] {
  return [
    `Your contract: budget ${money(contract.budgetCapCents)} including tax`,
    `Your contract: quantity ${contract.quantity}`,
    `Your contract: a refund window of at least ${contract.minReturnDays} days`,
    ...(contract.deadline ? [`Your contract: arrives by ${contract.deadline}`] : []),
    ...contract.mustHave.map((rule) => `Your contract: ${ruleText(rule)}`),
    ...profile.map((entry) => `Your confirmed profile: ${entry.key.replaceAll("_", " ")} ${entry.value}`),
  ].slice(0, 20);
}

export function buildDetails(contract: Contract, profile: readonly ProfileEntry[], options: readonly Option[],
  checked: ReadonlyMap<string, Checked>): OptionDetail[] {
  const used = dataUsed(contract, profile);
  return options.map((option) => OptionDetail.parse({
    rank: option.rank,
    products: option.lines.map(({ sku }) => {
      const { listing, facts, reviewQuotes } = checked.get(sku)!;
      return { sku, title: listing.title, brand: listing.brand, sponsored: listing.sponsored, stock: listing.stock,
        rating: listing.rating, reviewCount: listing.reviewCount, returnDays: listing.returnDays, deliveryDays: listing.deliveryDays,
        facts: { praise: facts.praise, complaints: facts.complaints }, reviewQuotes };
    }),
    checks: [
      `Total ${money(option.estimate.totalCents)} is within your ${money(contract.budgetCapCents)} budget, including tax`,
      `${option.estimate.returnDays}-day refund window; you asked for at least ${contract.minReturnDays}`,
      `${option.estimate.deliveryDays === 0 ? "Instant delivery" : `Arrives in ${option.estimate.deliveryDays} ${option.estimate.deliveryDays === 1 ? "day" : "days"}`}${contract.deadline ? `, by your ${contract.deadline} deadline` : ""}`,
      ...contract.mustHave.map((rule) => `${ruleText(rule)}: yes, from the store's product data`),
    ].slice(0, 16),
    dataUsed: used,
  }));
}

export function otherSurvivors(contract: Contract, options: readonly Option[], survivors: readonly Checked[], pricing: PricingConfig): OtherSurvivor[] {
  const picked = new Set(options.flatMap((option) => option.lines.map((line) => line.sku)));
  return survivors.filter(({ listing }) => !picked.has(listing.sku)).slice(0, 12).map(({ listing }) => OtherSurvivor.parse({
    sku: listing.sku, title: listing.title, totalCents: estimateTotalCents(listing, contract.quantity, pricing), sponsored: listing.sponsored,
  }));
}
