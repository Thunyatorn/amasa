import { FAILURE_TEXT } from "../../../lib/failure-text.ts";
import { ruleLabel, type Rule } from "../../../lib/ui/contracts.ts";
import type { FailureCode } from "../../../lib/ui/purchase-api.ts";
import { money } from "./results.tsx";

// Screens 5 and 6 (SPEC §16). No hooks: the page owns the state. Approve and Not now share one
// style so neither is pushed; no timers or urgency copy.

export function ApprovalPanel({ title, totalCents, budgetCapCents, checks, busy, error, expired, onApprove, onNotNow, onCheckAgain }: {
  title: string; totalCents: number; budgetCapCents: number; checks: string[]; busy: boolean; error: string; expired: boolean;
  onApprove: () => void; onNotNow: () => void; onCheckAgain: () => void;
}) {
  return <section className="panel" aria-labelledby="approval-heading">
    <p className="eyebrow">Your decision · Before checkout</p>
    <h2 id="approval-heading">Approve this order?</h2>
    <div className="approval-layout"><div>
    <p><strong>{title}</strong></p>
    <p>Total {money(totalCents)}, including tax and shipping. {money(budgetCapCents - totalCents)} of your {money(budgetCapCents)} budget left.</p>
    <div className="budget-meter"><label htmlFor="order-budget">Budget allocation <span>{money(budgetCapCents)} cap</span></label><progress id="order-budget" value={totalCents} max={budgetCapCents} /><p className="hint">{money(totalCents)} order total · {money(budgetCapCents - totalCents)} remaining</p></div>
    <h3>Checked by Amasa&apos;s verifier against the store&apos;s own data</h3>
    <ul className="checks">{checks.map((check) => <li key={check}>{check}</li>)}</ul>
    </div><div className="approval-decision"><h3>The next step is yours.</h3><p>Approving prepares a payment link for this order. You complete payment on the hosted page.</p>
    <p className="visa-note">You&apos;ll enter your card on Visa&apos;s secure page. Amasa never sees your card.</p>
    {error && <p role="alert">{error}</p>}
    <div className="choice-row">
      {expired
        ? <button type="button" className="choice" disabled={busy} onClick={onCheckAgain}>Check again</button>
        : <button type="button" className="choice" disabled={busy} onClick={onApprove}>Approve</button>}
      <button type="button" className="choice" disabled={busy} onClick={onNotNow}>Not now</button>
    </div>
    {busy && <p role="status">Working on it...</p>}
    </div></div>
  </section>;
}

export function PaymentReady({ purchaseNumber, paymentLinkUrl, prepared, onClose }: {
  purchaseNumber: string; paymentLinkUrl: string; prepared: boolean; onClose: () => void;
}) {
  return <section className="panel payment-ready" aria-labelledby="ready-heading">
    <h2 id="ready-heading">{prepared ? "Ready to pay: one tap" : "Visa's secure payment page is ready"}</h2>
    {prepared && <p>Amasa checked this order and prepared Visa&apos;s payment page within your weekly limit. Nothing is paid until you finish on Visa&apos;s page.</p>}
    <p>Order {purchaseNumber}. You&apos;ll enter your card on Visa&apos;s page, not in Amasa.</p>
    <div className="choice-row">
      <a className="choice button-link" href={paymentLinkUrl} target="_blank" rel="noopener noreferrer">Pay on Visa&apos;s secure page</a>
      <a className="choice button-link" href={`/receipt/${purchaseNumber}`}>View receipt</a>
    </div>
    <button type="button" className="secondary" onClick={onClose}>Close</button>
  </section>;
}

export function BlockedPanel({ codes, busy, error, onPickAnother, onEditRule }: {
  codes: FailureCode[]; busy: boolean; error: string; onPickAnother: () => void; onEditRule: () => void;
}) {
  const sentences = [...new Set(codes.map((code) => FAILURE_TEXT[code]))];
  return <section className="panel blocked-panel" aria-labelledby="blocked-heading">
    <h2 id="blocked-heading">This order can&apos;t go ahead yet</h2>
    <ul className="checks">{sentences.map((sentence) => <li key={sentence}>{sentence}</li>)}</ul>
    <p className="hint">Nothing was charged.</p>
    {error && <p role="alert">{error}</p>}
    <div className="choice-row">
      <button type="button" className="choice" disabled={busy} onClick={onPickAnother}>Pick another option</button>
      <button type="button" className="choice" disabled={busy} onClick={onEditRule}>Edit the rule</button>
    </div>
  </section>;
}

// What the verifier checked, in plain words, for the approval panel.
export function approvalChecks(contract: { mustHave: Rule[]; minReturnDays: number; deadline?: string | undefined; quantity: number }): string[] {
  return [
    "✓ Total is within your budget, using the store's own quote",
    ...contract.mustHave.map((rule) => `✓ ${ruleLabel(rule)} ${String(rule.value)}`),
    `✓ Returns: at least ${contract.minReturnDays} days`,
    `✓ Quantity: ${contract.quantity}`,
    ...(contract.deadline ? [`✓ Arrives by ${contract.deadline}`] : []),
    "✓ Sold by a store in your contract, and not flagged",
  ];
}
