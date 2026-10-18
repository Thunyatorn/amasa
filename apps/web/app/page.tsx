"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { KNOWN_MERCHANTS } from "../lib/merchants.ts";
import { api, Goal, IntakeResult } from "../lib/ui/contracts.ts";

const examples = [
  "Wide running shoes for a half marathon, size 10.5, under $140, must be returnable",
  "Groceries for the week, under $80",
  "Household cleaning supplies, under $40",
];

export default function Home() {
  const router = useRouter();
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const parsed = Goal.safeParse(goal);
    if (!parsed.success) { setError("Enter a goal between 3 and 300 characters."); input.current?.focus(); return; }
    pending.current = true; setBusy(true); setError("");
    try {
      const body = z.strictObject({ goal: Goal }).parse({ goal: parsed.data });
      const result = await api("/api/intake", IntakeResult, body);
      router.push(`/contract/${result.draftId}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Something went wrong. Please try again."); }
    finally { pending.current = false; setBusy(false); }
  }
  return <main className="screen home-screen">
    <header className="goal-intro"><p className="eyebrow">A little less searching. A little more certainty.</p><h1>Good shopping starts<br/>with your rules.</h1><p className="subtitle">A personal shopping agent that never pays without your OK.</p></header>
    <div className="goal-layout"><div className="goal-compose">
    <p className="store-disclosure">I shop {KNOWN_MERCHANTS.join(", ")} and never pay without your OK</p>
    <form onSubmit={submit} noValidate aria-busy={busy}>
      <label htmlFor="goal">What would you like to shop for?</label>
      <input ref={input} id="goal" name="goal" placeholder="Tell me what you need, and what matters to you…" value={goal} onChange={(event) => setGoal(event.target.value)} minLength={3} maxLength={300} required readOnly={busy} aria-describedby="goal-count goal-status" aria-invalid={!!error} />
      <p id="goal-count" className="hint">{300 - goal.length} characters remaining</p>
      <button type="submit" disabled={busy}>Next</button>
      <p id="goal-status" role="status" aria-live="polite">{busy ? "Thinking..." : error}</p>
    </form>
    <section aria-labelledby="examples-heading"><h2 id="examples-heading">Example goals</h2><ul className="examples">{examples.map((example, index) => <li key={example}><button className="secondary" type="button" disabled={busy} onClick={() => { setGoal(example); setError(""); input.current?.focus(); }}><span className="example-number" aria-hidden="true">0{index + 1}</span><span>{example}</span><span aria-hidden="true">↗</span></button></li>)}</ul></section>
    </div><aside className="goal-guide"><p className="eyebrow">From intent to informed choice</p><h2>You set the boundaries.<br/>Amasa does the legwork.</h2><ol><li><strong>Make it yours</strong><p>Review and edit your budget, fit and requirements before the search.</p></li><li><strong>See the trade-offs</strong><p>Compare full costs, delivery and returns, with the reasons behind each option.</p></li><li><strong>Stay in control</strong><p>Review the checks. Enter your card only on Visa&apos;s hosted payment page.</p></li></ol></aside></div>
    <p><a href="/settings">Settings: how much Amasa does for you, your profile and your data</a></p>
  </main>;
}
