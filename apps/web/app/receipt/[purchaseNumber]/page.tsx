"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CATEGORY_NAMES, LEVEL_NAMES } from "../../../lib/autonomy.ts";
import { FAILURE_TEXT } from "../../../lib/failure-text.ts";
import { api, ruleLabel } from "../../../lib/ui/contracts.ts";
import { announceChange, EntryResult, OkResult, OutcomeResult, ReceiptResult, type ProfileEntry, type Receipt } from "../../../lib/ui/purchase-api.ts";
import { dollars, money } from "../../shop/[contractId]/results.tsx";

const REASONS = [
  ["not_as_described", "Not as described"],
  ["changed_mind", "Changed my mind"], ["other", "Other"],
] as const;
const STATUS_TEXT: Record<string, string> = {
  verified: "Checked, waiting for your approval", blocked: "Stopped by a check", approved: "Approved, preparing the payment page",
  link_created: "Payment page ready", payment_failed: "The payment page couldn't be prepared", kept: "Kept", returned: "Returned",
};
const daysLeft = (isoDate: string, now: number) => Math.max(0, Math.ceil((Date.parse(`${isoDate}T23:59:59Z`) - now) / 86_400_000));

// Screen 7 (SPEC §16): items, total, data used, refund-window countdown, audit head, Kept / Returned (demo),
// and profile suggestions with Keep / Forget. No profile change happens without the user's tap.
export default function ReceiptPage() {
  const { purchaseNumber } = useParams<{ purchaseNumber: string }>();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState<string>("not_as_described");
  const [message, setMessage] = useState("");
  const [now] = useState(() => Date.now());

  const load = (signal?: AbortSignal) => api(`/api/purchases/${purchaseNumber}`, ReceiptResult, undefined, signal)
    .then((loaded) => { if (!signal?.aborted) setReceipt(loaded); })
    .catch((cause: unknown) => { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "We couldn't load this order."); });
  useEffect(() => {
    if (!/^[A-Z0-9]{16}$/.test(purchaseNumber)) { setError("Choose a valid order."); return; }
    const abort = new AbortController();
    void load(abort.signal);
    return () => abort.abort();
  }, [purchaseNumber]);

  async function act(work: () => Promise<string>) {
    setBusy(true); setError(""); setMessage("");
    try { setMessage(await work()); await load(); announceChange(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Something went wrong. Please try again."); }
    finally { setBusy(false); }
  }
  const record = (outcome: "kept" | "returned") => act(async () => {
    const result = await api("/api/outcomes", OutcomeResult, { purchaseNumber, outcome, ...(outcome === "returned" ? { reason } : {}) });
    setReturning(false);
    return result.suggestions.length ? "Saved. Amasa has a profile suggestion for you below." : "Saved.";
  });
  const keep = (entry: ProfileEntry) => act(async () => { await api(`/api/profile/${entry.id}/confirm`, EntryResult, {}); return "Kept in your profile."; });
  const forget = (entry: ProfileEntry) => act(async () => { await api(`/api/profile/${entry.id}`, OkResult, undefined, undefined, "DELETE"); return "Forgotten."; });

  if (error && !receipt) return <main className="screen"><h1>Receipt</h1><p role="alert">{error}</p><p><a href="/">Back to home</a></p></main>;
  if (!receipt) return <main className="screen"><h1>Receipt</h1><p role="status">Loading your order...</p></main>;
  const { purchase, lines, totals, contract, returnBy, auditHead, suggestions, autonomy } = receipt;
  const linked = purchase.status === "link_created";

  return <main className="screen wide">
    <p className="eyebrow">Your order / The details in one place</p>
    <h1>Receipt</h1>
    <p className="summary">Order {purchase.purchaseNumber}: {STATUS_TEXT[purchase.status] ?? purchase.status}</p>
    {purchase.status === "blocked" && <ul>{receipt.failureCodes.map((code) => <li key={code}>{FAILURE_TEXT[code]}</li>)}</ul>}

    <div className="receipt-layout"><div className="receipt-order">
    <section className="card" aria-labelledby="items-heading"><h2 id="items-heading">Items &amp; total</h2>
      <div className="table-wrap"><table>
        <thead><tr><th scope="col">Item</th><th scope="col">Qty</th><th scope="col">Price</th></tr></thead>
        <tbody>{lines.map((line) => <tr key={line.sku}><td>{line.title}</td><td>{line.qty}</td><td>{line.lineCents === null ? "" : money(line.lineCents)}</td></tr>)}</tbody>
      </table></div>
      {totals && <dl className="receipt-totals">
        <div><dt>Subtotal</dt><dd>{money(totals.subtotalCents)}</dd></div>
        <div><dt>Tax</dt><dd>{money(totals.taxCents)}</dd></div>
        <div className="receipt-grand-total"><dt>Total</dt><dd>{money(totals.totalCents)} <span className="hint">(= {dollars(totals.totalCents)} at 1 VU = $1.00)</span></dd></div>
      </dl>}
      {returnBy && <div className="return-information"><h3>Your refund window</h3><p>Refunds accepted until {returnBy} ({daysLeft(returnBy, now)} days left).</p></div>}
    </section>

    {linked && purchase.paymentLinkUrl && <section className="panel" aria-labelledby="pay-heading"><h2 id="pay-heading">Payment</h2>
      <p><a href={purchase.paymentLinkUrl} target="_blank" rel="noopener noreferrer">Open Visa&apos;s secure payment page</a></p>
      <p className="hint">In this sandbox demo Amasa can&apos;t see whether you finished paying on Visa&apos;s page.</p>
    </section>}

    {contract && <section className="card" aria-labelledby="data-heading"><h2 id="data-heading">Data used</h2>
      <ul>
        <li>Budget {money(contract.budgetCapCents)}, including tax</li>
        <li>Quantity {contract.quantity}; refund window at least {contract.minReturnDays} days{contract.deadline ? `; by ${contract.deadline}` : ""}</li>
        {contract.mustHave.map((rule) => <li key={`${rule.key}-${rule.value}`}>{ruleLabel(rule)} {String(rule.value)}</li>)}
      </ul>
    </section>}
    {auditHead && <div className="receipt-audit"><p className="hint">Audit chain head at purchase time: <span className="hash">{auditHead}</span></p></div>}
    </div><aside className="receipt-followup" aria-label="Outcomes and preferences">

    {linked && <section className="card" aria-labelledby="outcome-heading"><h2 id="outcome-heading">How did it go? (demo)</h2>
      <p className="hint">Your feedback helps Amasa understand your preferences. Choose the outcome when you know.</p>
      {!returning ? <div className="choice-row">
        <button type="button" className="choice" disabled={busy} onClick={() => record("kept")}>Kept</button>
        <button type="button" className="choice" disabled={busy} onClick={() => setReturning(true)}>Returned</button>
      </div> : <div>
        <label htmlFor="reason">Why did you return it?</label>
        <select id="reason" value={reason} onChange={(event) => setReason(event.target.value)}>
          {REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <div className="choice-row">
          <button type="button" className="choice" disabled={busy} onClick={() => record("returned")}>Confirm return</button>
          <button type="button" className="choice" disabled={busy} onClick={() => setReturning(false)}>Cancel</button>
        </div>
      </div>}
    </section>}

    {suggestions.length > 0 && <section className="card" aria-labelledby="suggest-heading"><h2 id="suggest-heading">Profile suggestions</h2>
      <p className="hint">Amasa only changes your profile when you choose Keep.</p>
      <ul className="rules">{suggestions.map((entry) => <li className="chip" key={entry.id}>
        <span>{entry.key.replaceAll("_", " ")} {String(entry.value)}: {entry.note}</span>
        <span className="choice-row">
          <button type="button" className="choice" disabled={busy} onClick={() => keep(entry)}>Keep</button>
          <button type="button" className="choice" disabled={busy} onClick={() => forget(entry)}>Forget</button>
        </span>
      </li>)}</ul>
    </section>}

    <section className="card" aria-labelledby="receipt-preferences-heading"><h2 id="receipt-preferences-heading">Your shopping preferences</h2>
    <p className="hint">{CATEGORY_NAMES[autonomy.category]}: level {autonomy.level} ({LEVEL_NAMES[autonomy.level]}).
      {autonomy.offeredLevel !== null ? ` You can raise it to level ${autonomy.offeredLevel} in Settings.` : ""}</p>
    <a href="/settings">Manage preferences &amp; autonomy ↗</a></section>
    </aside></div>
    <p role="status" aria-live="polite">{message}</p>
    {error && <p role="alert">{error}</p>}
    <p><a href="/settings">Settings</a> · <a href="/">Start a new goal</a></p>
  </main>;
}
