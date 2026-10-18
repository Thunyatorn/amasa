"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { api, Goal, IntakeResult } from "../lib/ui/contracts.ts";

const examples = [
  "An Oscar-winning actor, under 300 VU, must be refundable",
  "A pop musician, under 250 VU",
  "A tennis player, under 300 VU",
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
    <h1 className="visually-hidden">Amasa: buy celebrities, priced in VU</h1>
    <div className="goal-layout"><div className="goal-compose">
    <form onSubmit={submit} noValidate aria-busy={busy}>
      <label htmlFor="goal">What would you like to shop for?</label>
      <input ref={input} id="goal" name="goal" placeholder="Tell me what you need, and what matters to you…" value={goal} onChange={(event) => setGoal(event.target.value)} minLength={3} maxLength={300} required readOnly={busy} aria-describedby="goal-count goal-status" aria-invalid={!!error} />
      <p id="goal-count" className="hint">{300 - goal.length} characters remaining</p>
      <button type="submit" disabled={busy}>Next</button>
      <p id="goal-status" role="status" aria-live="polite">{busy ? "Thinking..." : error}</p>
    </form>
    <section aria-labelledby="examples-heading"><h2 id="examples-heading">Example goals</h2><ul className="examples">{examples.map((example, index) => <li key={example}><button className="secondary" type="button" disabled={busy} onClick={() => { setGoal(example); setError(""); input.current?.focus(); }}><span className="example-number" aria-hidden="true">0{index + 1}</span><span>{example}</span><span aria-hidden="true">↗</span></button></li>)}</ul></section>
    </div><aside className="goal-guide"><ol><li><strong>Make it yours</strong><p>Review and edit your budget and requirements before the search.</p></li><li><strong>See the trade-offs</strong><p>Compare full costs, refund windows and ratings, with the reasons behind each option.</p></li><li><strong>Stay in control</strong><p>Review the checks. Enter your card only on Visa&apos;s hosted payment page.</p></li></ol></aside></div>
    <p><a href="/settings">Settings: how much Amasa does for you, your profile and your data</a></p>
  </main>;
}
