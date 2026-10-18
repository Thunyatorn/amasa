import type { ProgressEvent } from "../../../lib/ui/sse.ts";
import { filteredCount, REMOVED_WORDS, type ShopState } from "../../../lib/ui/shop-state.ts";
import { CategoryIllustration, type ShoppingCategory } from "../../category-illustration.tsx";

// Screen 4 (SPEC §16): no hooks here, so every piece renders the same in tests and in the app. All
// text from models or the store is rendered as plain text.
type OptionsEvent = Extract<ProgressEvent, { type: "options" }>;

export const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
export const arrivalDate = (deliveryDays: number, now: number) =>
  new Date(now + deliveryDays * 86_400_000).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

const FIT_WORDS: Record<string, string> = {
  runs_small: "runs small", runs_large: "runs large", true_to_size: "true to size", wide_friendly: "good for wide feet", narrow: "narrow fit",
};

export function StepList({ steps, live }: { steps: string[]; live: boolean }) {
  return <ol className="steps" aria-live={live ? "polite" : "off"}>{steps.map((step, i) => <li key={`${i}-${step}`}>{step}</li>)}</ol>;
}

function WhyPanel({ detail, id }: { detail: OptionsEvent["details"][number]; id: string }) {
  return <div id={id} className="why">
    <h4>How it fits your contract</h4>
    <ul>{detail.checks.map((check) => <li key={check}>{check}</li>)}</ul>
    <h4>Data used</h4>
    <ul>{detail.dataUsed.map((item) => <li key={item}>{item}</li>)}</ul>
    {detail.products.map((product) => {
      const facts = [...product.facts.fitNotes.map((f) => FIT_WORDS[f] ?? f), ...product.facts.praise.map((p) => `praised for ${p}`),
        ...product.facts.complaints.map((c) => `complaints about ${c}`)];
      return <div key={product.sku}>
        <h4>From the store&apos;s reviews of {product.title}</h4>
        <p className="hint">Rated {product.rating.toFixed(1)} from {product.reviewCount} reviews. Summary written by AI from the reviews: {facts.length ? facts.join(", ") : "nothing clear"}.</p>
        {product.reviewQuotes.map((quote, i) => <blockquote key={i} className="quote"><p className="label">Store review</p><p>{quote}</p></blockquote>)}
      </div>;
    })}
  </div>;
}

export function OptionCards({ result, open, onToggle, now, onChoose, chooseDisabled = false, category }: {
  result: OptionsEvent; open: ReadonlySet<number>; onToggle: (rank: number) => void; now: number;
  onChoose?: (rank: number) => void; chooseDisabled?: boolean;
  category?: ShoppingCategory;
}) {
  return <ol className="options">{result.options.map((option) => {
    const detail = result.details.find((d) => d.rank === option.rank);
    const products = detail?.products ?? [];
    const panelId = `why-${option.rank}`;
    return <li key={option.rank} className="option">
      <div className="proposal-label"><span>Shopping proposal</span><span>0{option.rank}</span></div>
      {category && <CategoryIllustration category={category} />}
      <h3>{option.rank}. {products.map((p) => p.title).join(" + ") || option.lines.map((l) => l.sku).join(" + ")}</h3>
      <div className="option-disclosure">{products.some((p) => p.sponsored) && <p className="sponsored">Sponsored</p>}</div>
      <p className="option-reason">{option.reason}</p>
      <div className="option-total"><span className="price">{money(option.estimate.totalCents)}</span><span className="hint">Total · includes tax and shipping</span></div>
      <dl className="facts">
        <div><dt>Delivery</dt><dd>Arrives by {arrivalDate(option.estimate.deliveryDays, now)} ({days(option.estimate.deliveryDays)})</dd></div>
        <div><dt>Returns</dt><dd>{days(option.estimate.returnDays)}</dd></div>
        {products.map((p) => <div key={p.sku}><dt>Stock</dt><dd>Store says: {p.stock} in stock</dd></div>)}
      </dl>
      <div className="card-actions">
        {detail && <button type="button" className="secondary" aria-expanded={open.has(option.rank)} aria-controls={panelId} onClick={() => onToggle(option.rank)}>Why?</button>}
        {onChoose && <button type="button" disabled={chooseDisabled} onClick={() => onChoose(option.rank)}>Choose this option</button>}
      </div>
      {detail && open.has(option.rank) && <WhyPanel detail={detail} id={panelId} />}
    </li>;
  })}</ol>;
}

export function CompareTableView({ result }: { result: OptionsEvent }) {
  const { compare } = result;
  if (compare.skus.length < 2) return null;
  const titles = compare.skus.map((sku) => result.details.flatMap((d) => d.products).find((p) => p.sku === sku)?.title ?? sku);
  return <section className="comparison-section" aria-labelledby="compare-heading">
    <h2 id="compare-heading">Compare</h2>
    <div className="table-wrap"><table>
      <caption>Your options side by side. The row marked &quot;Biggest difference&quot; is where they differ most.</caption>
      <thead><tr><th scope="col">What</th>{titles.map((title, i) => <th key={compare.skus[i]} scope="col">{title}</th>)}</tr></thead>
      <tbody>{compare.rows.map((row) => <tr key={row.label} className={row.highlight ? "highlight" : undefined}>
        <th scope="row">{row.label}{row.highlight && <span className="badge"> Biggest difference</span>}</th>
        {row.values.map((value, i) => <td key={i}>{value}</td>)}
      </tr>)}</tbody>
    </table></div>
    {compare.tradeoff && <p className="tradeoff"><strong>Trade-off:</strong> {compare.tradeoff}</p>}
  </section>;
}

export function FilteredOut({ state }: { state: ShopState }) {
  const total = filteredCount(state);
  if (!total) return null;
  return <details className="filtered">
    <summary>Filtered out ({total})</summary>
    <ul>
      {state.flagged.map((f) => <li key={f.sku}>{f.sku}: {f.reason}</li>)}
      {state.removed.map((r) => <li key={r.code}>{r.count} {r.count === 1 ? "product" : "products"} {REMOVED_WORDS[r.code] ?? "didn't pass a check"}</li>)}
    </ul>
  </details>;
}

export function OthersList({ result, shown, onShow }: { result: OptionsEvent; shown: boolean; onShow: () => void }) {
  if (!result.others.length) return null;
  if (!shown) return <button type="button" className="secondary" onClick={onShow}>Show more ({result.others.length})</button>;
  return <section aria-labelledby="others-heading"><h2 id="others-heading">Also fits your contract</h2>
    <ul>{result.others.map((o) => <li key={o.sku}>{o.title}: {money(o.totalCents)} total{o.sponsored ? " (Sponsored)" : ""}</li>)}</ul>
  </section>;
}
