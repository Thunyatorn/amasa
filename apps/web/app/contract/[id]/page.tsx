"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { KNOWN_MERCHANTS } from "../../../lib/merchants.ts";
import { api, CHOICES, FieldError, ConfirmInput, ContractDraft, ContractResult, DraftResult, editedDraft, extrasFromDraft, fieldsFromDraft, Id, ruleLabel, type Extra, type Fields, type Rule } from "../../../lib/ui/contracts.ts";

const ruleName = (rule: Rule) => rule.key.replaceAll("_", " ");

export default function ContractPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [draft, setDraft] = useState<ContractDraft | null>(null);
  const [fields, setFields] = useState<Fields | null>(null);
  const [today, setToday] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [answered, setAnswered] = useState(false);
  const pending = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [invalidField, setInvalidField] = useState("");
  const [extras, setExtras] = useState<Extra[]>([]);
  const [unsupported, setUnsupported] = useState<Rule[]>([]);
  const hadUnsupported = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    setDraft(null); setFields(null); setLoading(true); setError(""); setAnswered(false); setInvalidField(""); setExtras([]); setUnsupported([]);
    const id = Id.safeParse(params.id);
    if (!id.success) { setError("Choose a valid draft to continue."); setLoading(false); return; }
    api(`/api/drafts/${id.data}`, DraftResult, undefined, controller.signal).then(({ draft: loaded, unsupported: notCheckable }) => {
      if (controller.signal.aborted) return;
      setDraft(loaded); setFields(fieldsFromDraft(loaded)); setExtras(extrasFromDraft(loaded));
      setUnsupported(notCheckable); hadUnsupported.current = notCheckable.length > 0;
      // The draft API has no date metadata; freeze the UTC day used by intake on load.
      setToday(new Date().toISOString().slice(0, 10));
    }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "We couldn't load this draft. Please try again."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [params.id]);
  useEffect(() => { if (!loading) heading.current?.focus(); }, [loading]);
  function clearError() { setError(""); setInvalidField(""); }
  function change(key: keyof Fields, value: string) { setFields((current) => current && { ...current, [key]: value }); clearError(); }
  function changeExtra(index: number, value: string) { setExtras((current) => current.map((extra, position) => position === index ? { ...extra, value } : extra)); clearError(); }
  function focusControl(name: string) {
    const control = form.current?.elements.namedItem(name);
    if (typeof HTMLElement !== "undefined" && control instanceof HTMLElement) control.focus();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !fields || pending.current) return;
    setError("");
    try {
      if (unsupported.length) throw new FieldError("unsupported-0", "Remove each requirement Amasa can't check to continue without it, or go back and change your goal.");
      if (draft.question && !answered) throw new FieldError("answered", "Review the open question and confirm that your edits address it.");
      const edited = editedDraft(draft, fields, today, extras);
      const body = ConfirmInput.parse({ draftId: params.id, draft: edited, ...(hadUnsupported.current ? { acknowledgedUnsupported: true } : {}) });
      pending.current = true; setBusy(true);
      const result = await api("/api/contracts", ContractResult, body);
      router.push(`/shop/${result.contract.id}`);
    } catch (cause) {
      if (cause instanceof FieldError) { setInvalidField(cause.field); focusControl(cause.field); }
      setError(cause instanceof Error ? cause.message : "We couldn't confirm this contract. Please try again."); }
    finally { pending.current = false; setBusy(false); }
  }
  const choice = draft ? CHOICES[draft.category] : null;
  return <main className="screen"><p className="eyebrow">01 / Set the boundaries</p><h1 ref={heading} tabIndex={-1}>Review your contract</h1>
    <p className="subtitle">Your goal, translated into clear shopping rules. Edit any detail before Amasa starts looking.</p>
    {loading && <p role="status">Loading your draft...</p>}
    {draft && fields && <>
      <p>{draft.goal}</p>
      {draft.question && <p id="open-question">{draft.question}</p>}
      <form ref={form} noValidate onSubmit={submit} aria-busy={busy}>
        {unsupported.length > 0 && <section className="notice" aria-labelledby="unsupported-heading"><h2 id="unsupported-heading">Amasa can&apos;t check these at {KNOWN_MERCHANTS.join(", ")}</h2>
          <p className="hint" id="unsupported-help">They won&apos;t be part of your contract. Remove each one to continue without it, or go back and change your goal.</p>
          <ul className="rules">{unsupported.map((rule, index) => <li className="chip" key={`${index}-${rule.key}-${rule.op}`}><span>{ruleLabel(rule)} {String(rule.value)}</span><button id={`unsupported-${index}`} className="secondary" type="button" disabled={busy} aria-invalid={invalidField === `unsupported-${index}`} aria-describedby="unsupported-help contract-status" aria-label={`Remove ${ruleName(rule)} requirement that Amasa can't check`} onClick={() => { setUnsupported(unsupported.filter((_, position) => position !== index)); clearError(); }}>Remove</button></li>)}</ul>
        </section>}
        <fieldset disabled={busy}><legend>Shopping requirements</legend><div className="field-grid">
          <div><label htmlFor="budget">Budget in VU</label><div className="money-input"><span aria-hidden="true">VU</span><input id="budget" aria-invalid={invalidField === "budget"} inputMode="decimal" value={fields.budget} onBlur={() => { if (/^\d+(?:\.\d{1,2})?$/.test(fields.budget) && Number(fields.budget) <= 5000 && Number(fields.budget) > 0) setFields({ ...fields, budget: Number(fields.budget).toFixed(2) }); }} onChange={(event) => change("budget", event.target.value)} required aria-describedby="budget-help contract-status" /></div><p className="hint" id="budget-help">Total including tax. Maximum 5,000.00 VU (1 VU = $1.00 in this demo).</p></div>
          <div><label htmlFor="quantity">Quantity</label><input id="quantity" aria-invalid={invalidField === "quantity"} aria-describedby="contract-status" type="number" min="1" max="10" step="1" value={fields.quantity} onChange={(event) => change("quantity", event.target.value)} required /></div>
          <div><label htmlFor="returns">Minimum refund days</label><input id="returns" aria-invalid={invalidField === "returns"} aria-describedby="contract-status" type="number" min="0" max="365" step="1" value={fields.minReturnDays} onChange={(event) => change("minReturnDays", event.target.value)} required /></div>
          <div><label htmlFor="deadline">Deadline (optional)</label><input id="deadline" aria-invalid={invalidField === "deadline"} aria-describedby="contract-status" type="date" min={today} value={fields.deadline} onChange={(event) => change("deadline", event.target.value)} /></div>
          {choice && <div><label htmlFor="choice">{choice.label} (optional)</label><select id="choice" aria-invalid={invalidField === "choice"} aria-describedby="contract-status" value={fields.choice} onChange={(event) => change("choice", event.target.value)}><option value="">{choice.none}</option>{choice.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>}
        </div>
        {extras.length > 0 && <section aria-labelledby="other-rules"><h2 id="other-rules">Other requirements</h2><ul className="rules">{extras.map((extra, index) => <li className="chip" key={`${index}-${extra.rule.key}-${extra.rule.op}`}>
          <label htmlFor={`rule-${index}`}>{ruleLabel(extra.rule)}</label>
          <input id={`rule-${index}`} aria-invalid={invalidField === `rule-${index}`} aria-describedby="contract-status" inputMode={typeof extra.rule.value === "number" ? "decimal" : undefined} maxLength={40} value={extra.value} onChange={(event) => changeExtra(index, event.target.value)} />
          <button className="secondary" type="button" aria-label={`Remove ${ruleName(extra.rule)} requirement`} onClick={() => { setExtras(extras.filter((_, position) => position !== index)); clearError(); }}>Remove</button>
        </li>)}</ul></section>}
        {draft.question && <div className="check-field"><input id="answered" aria-invalid={invalidField === "answered"} type="checkbox" checked={answered} onChange={(event) => { setAnswered(event.target.checked); clearError(); }} aria-describedby="open-question contract-status" /><label htmlFor="answered">My edits address the question above.</label></div>}
        </fieldset>
        <p className="hint">Your edits stay here until you choose Looks right.</p>
        <button type="submit" disabled={busy || !fields.budget.trim()}>Looks right</button>
      </form>
    </>}
    <p id="contract-status" role="status" aria-live="polite">{busy ? "Confirming your contract..." : error}</p>
    <a href="/">Back to home</a>
  </main>;
}
