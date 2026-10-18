import { z } from "zod";
import { sha256 } from "@amasa/schemas";
import { Attribute, type Evidence, type SourcePayload } from "./schemas.ts";
import { MarketError } from "./source-http.ts";

const Qid = z.string().regex(/^Q[1-9][0-9]*$/);
const DataValue = z.object({ value: z.unknown(), type: z.string() });
const Snak = z.object({ snaktype: z.string(), property: z.string(), datavalue: DataValue.optional() });
const Claim = z.object({ id: z.string().optional(), rank: z.string().optional(), mainsnak: Snak,
  qualifiers: z.record(z.string(), z.array(Snak)).optional(),
  references: z.array(z.object({ snaks: z.record(z.string(), z.array(Snak)) })).optional() });
const Label = z.object({ language: z.string(), value: z.string().max(1000) });
export const Entity = z.object({ id: Qid, type: z.literal("item"), labels: z.record(z.string(), Label).default({}),
  aliases: z.record(z.string(), z.array(Label)).default({}), descriptions: z.record(z.string(), Label).default({}),
  claims: z.record(z.string(), z.array(Claim).max(2000)).default({}),
  sitelinks: z.record(z.string(), z.object({ site: z.string(), title: z.string().max(1000) })).default({}) });
export type Entity = z.infer<typeof Entity>;
const IdValue = z.object({ id: Qid });
const Quantity = z.object({ amount: z.string().regex(/^[+-]?\d+(\.\d+)?$/), unit: z.string() });
const Time = z.object({ time: z.string(), precision: z.number().int(), calendarmodel: z.string() });
export function claims(e: Entity, p: string) { return (e.claims[p] ?? []).filter(c => c.rank !== "deprecated" && c.mainsnak.snaktype === "value"); }
export function ids(e: Entity, p: string): string[] { return claims(e, p).flatMap(c => { const v = IdValue.safeParse(c.mainsnak.datavalue?.value); return v.success ? [v.data.id] : []; }); }
export function parseEntities(source: SourcePayload): Entity[] {
  const parsed = z.object({ entities: z.record(z.string(), z.unknown()) }).parse(JSON.parse(source.payload));
  return Object.values(parsed.entities).flatMap(v => { const e = Entity.safeParse(v); return e.success ? [e.data] : []; });
}
export function normalizeName(s: string) { return s.normalize("NFKC").toLocaleLowerCase("en").replace(/[“”"']/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim(); }
export function chooseIdentity(name: string, entities: Entity[]): Entity | null {
  const matches = entities.filter(e => ids(e, "P31").includes("Q5")
    && [e.labels.en?.value, ...(e.aliases.en ?? []).map(a => a.value)].some(n => n && normalizeName(n) === normalizeName(name))
    && (e.sitelinks.enwiki || /\b(actor|actress|singer|musician|athlete|player|writer|director|producer|politician|entrepreneur|model|comedian|rapper|presenter|business|artist|dancer|football|basketball)\b/i.test(e.descriptions.en?.value ?? "")));
  return matches.length === 1 ? matches[0]! : null;
}
export function entityUrl(qid: string) { return `https://www.wikidata.org/wiki/${Qid.parse(qid)}`; }
export function entityEndpoint(qid: string) { return `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${Qid.parse(qid)}&languages=en&props=labels%7Caliases%7Cdescriptions%7Cclaims%7Csitelinks&format=json&maxlag=5`; }
export const SearchResponse = z.object({ search: z.array(z.object({ id: Qid })).max(5) });

export type CatalogFact = { id: string; attribute: Attribute; evidence: Evidence };
export function factCatalog(qid: string, sources: SourcePayload[]): CatalogFact[] {
  const entries = sources.flatMap(s => {
    if (!s.url.startsWith("https://www.wikidata.org/wiki/Q")) return [];
    try { return parseEntities(s).map(e => ({ e, s })); } catch { return []; }
  });
  const root = entries.find(v => v.e.id === qid && v.s.url === entityUrl(qid));
  if (!root || !ids(root.e, "P31").includes("Q5")) throw new MarketError("IDENTITY_NOT_HUMAN");
  const { e, s } = root, output: CatalogFact[] = [];
  const label = (id: string) => entries.find(v => v.e.id === id)?.e.labels.en?.value ?? id;
  function add(key: string, datatype: Attribute["datatype"], value: string | number, excerptValue: unknown,
    extra: Partial<Attribute> = {}, date: string | null = null) {
    const token = typeof excerptValue === "string" ? excerptValue : JSON.stringify(excerptValue);
    if (!token || !s.payload.includes(token)) return;
    const attribute = Attribute.parse({ key, datatype, value, provenance: { sourceUrl: s.url, confidence: .8,
      status: key === "net_worth" ? "estimated" : "reported", effectiveDate: date, retrievedAt: s.checkedAt, publicationDate: s.publicationDate ?? null }, ...extra });
    const id = `${qid}:${key}:${sha256({ datatype, value, currency: attribute.currency }).slice(0, 16)}`;
    output.push({ id, attribute, evidence: { key, factId: id, entityId: qid, sourceHash: sha256({ payload: s.payload }), excerpt: token.slice(0, 4000), provenance: attribute.provenance } });
  }
  const aliases = (e.aliases.en ?? []).map(a => a.value);
  if (aliases.length) add("aliases", "text", aliases.join("; ").slice(0, 4000), aliases[0]);
  const dob = claims(e, "P569");
  if (dob.length === 1) {
    const t = Time.safeParse(dob[0]!.mainsnak.datavalue?.value);
    if (t.success && t.data.calendarmodel.endsWith("/Q1985727")) {
      const match = /^\+(\d{4})-(\d{2})-(\d{2})T/.exec(t.data.time);
      if (match) {
        const date = t.data.precision >= 11 ? `${match[1]}-${match[2]}-${match[3]}` : t.data.precision === 10 ? `${match[1]}-${match[2]}` : match[1]!;
        if (t.data.precision >= 9) { add("birth_date", t.data.precision >= 11 ? "date" : "text", date, t.data.time); add("birth_date_precision", "number", t.data.precision, t.data.precision); }
      }
    }
  }
  for (const [p, key] of Object.entries({ P27: "nationality", P106: "occupations", P166: "awards_list", P800: "notable_works", P108: "employers", P1416: "affiliations", P54: "sports_teams" })) {
    const values = [...new Set(ids(e, p))];
    if (values.length) add(key, "text", values.map(label).join("; ").slice(0, 4000), values[0]);
  }
  const awards = ids(e, "P166"); if (awards.length) add("awards", "count", awards.length, awards[0]);
  for (const place of ids(e, "P19")) {
    const city = entries.find(v => v.e.id === place)?.e;
    if (city && ids(city, "P31").some(v => ["Q515", "Q486972", "Q3957", "Q1549591", "Q200250", "Q5119"].includes(v)))
      add("birthplace", "text", [label(place), ...ids(city, "P17").map(label)].join(", "), place);
  }
  for (const [p, key] of Object.entries({ P856: "official_urls", P2002: "twitter_handles", P2003: "instagram_handles", P2397: "youtube_channels", P4985: "tmdb_person_id" })) {
    const values = claims(e, p).flatMap(c => typeof c.mainsnak.datavalue?.value === "string" ? [c.mainsnak.datavalue.value] : []);
    if (values.length) add(key, "text", values.join("; ").slice(0, 4000), values[0]);
  }
  for (const [p, key] of [["P2218", "net_worth"], ["P8687", "followers"]] as const) {
    const observations = claims(e, p).flatMap(c => {
      const q = Quantity.safeParse(c.mainsnak.datavalue?.value); if (!q.success) return [];
      const dateSnak = c.qualifiers?.P585?.[0]?.datavalue?.value;
      const t = Time.safeParse(dateSnak);
      const date = t.success && t.data.precision >= 11 && t.data.calendarmodel.endsWith("/Q1985727") ? /^\+(\d{4}-\d{2}-\d{2})T/.exec(t.data.time)?.[1] ?? null : null;
      return [{ c, q: q.data, date }];
    }).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
    // Multiple undated assertions are not a reliable single series.
    if (observations.length > 1 && !observations[0]?.date) continue;
    const o = observations[0]; if (!o) continue;
    const amount = Number(o.q.amount); if (!Number.isFinite(amount) || amount < 0) continue;
    const currencies: Record<string, string> = { Q4917: "USD", Q4916: "EUR", Q25224: "GBP", Q8146: "JPY" };
    const currency = currencies[o.q.unit.split("/").pop() ?? ""];
    if (key === "net_worth" && !currency || key === "followers" && (o.q.unit !== "1" || !Number.isSafeInteger(amount))) continue;
    add(key, key === "net_worth" ? "money" : "count", amount, o.q.amount, currency ? { currency } : {}, o.date);
    const refs = o.c.references?.flatMap(r => (r.snaks.P854 ?? []).flatMap(v => typeof v.datavalue?.value === "string" ? [v.datavalue.value] : [])) ?? [];
    if (refs.length) add(`${key}_references`, "text", refs.join("; ").slice(0, 4000), refs[0]);
  }
  return output;
}

// API views may derive age; age never enters the pricing feature whitelist.
export function ageAt(birthDate: string, precision: number, at: number): number | null {
  if (precision < 11 || !z.iso.date().safeParse(birthDate).success) return null;
  const today = new Date(at).toISOString().slice(0, 10), year = Number(today.slice(0, 4)) - Number(birthDate.slice(0, 4));
  const age = year - (today.slice(5) < birthDate.slice(5) ? 1 : 0);
  return age >= 0 && age < 130 ? age : null;
}
