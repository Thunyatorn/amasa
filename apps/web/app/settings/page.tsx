"use client";

import { useEffect, useState } from "react";
import { AUTONOMY, CATEGORY_NAMES, LEVEL_DESCRIPTIONS, LEVEL_NAMES, type Level } from "../../lib/autonomy.ts";
import { api } from "../../lib/ui/contracts.ts";
import { announceChange, AuditResult, AutonomyResult, AutonomyStateResult, EntryResult, OkResult, ProfileResult,
  type AutonomyState, type ProfileEntry } from "../../lib/ui/purchase-api.ts";
import type { z } from "zod";
import { money } from "../shop/[contractId]/results.tsx";

const AUDIT_WORDS: Record<string, string> = {
  contract_confirmed: "Contract confirmed", cart_created: "Cart created", verdict: "Checks run", approved: "Order approved",
  payment_link_created: "Payment page created", payment_failed: "Payment page failed", outcome_recorded: "Kept or returned",
  autonomy_changed: "Autonomy changed", profile_changed: "Profile changed",
};
const CATEGORY_WORDS: Record<ProfileEntry["category"], string> = { "running-shoes": "Running shoes", groceries: "Groceries", household: "Household", all: "All categories" };

// Screen 8 (SPEC §16): autonomy per category with what each level does and what changes if raised,
// the offer banner (never auto-promoted), one-tap lowering, the editable profile, the tamper-evident
// history and an easy-to-find "Delete all my data".
export default function SettingsPage() {
  const [states, setStates] = useState<AutonomyState[]>([]);
  const [entries, setEntries] = useState<ProfileEntry[]>([]);
  const [audit, setAudit] = useState<z.infer<typeof AuditResult> | null>(null);
  const [caps, setCaps] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const [autonomy, profile, history] = await Promise.all([api("/api/autonomy", AutonomyResult), api("/api/profile", ProfileResult), api("/api/audit", AuditResult)]);
    setStates(autonomy.states); setEntries(profile.entries); setAudit(history);
  }
  useEffect(() => { load().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "We couldn't load your settings.")); }, []);

  async function act(work: () => Promise<string>) {
    setBusy(true); setError(""); setMessage("");
    try { setMessage(await work()); await load(); announceChange(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Something went wrong. Please try again."); }
    finally { setBusy(false); }
  }
  const setLevel = (state: AutonomyState, level: Level) => act(async () => {
    const capText = caps[state.category] ?? (AUTONOMY.defaultWeeklyCapCents / 100).toFixed(2);
    const weeklyCapCents = level === 2 ? Math.round(Number(capText) * 100) : undefined;
    if (level === 2 && !/^\d+(\.\d{1,2})?$/.test(capText)) throw new Error("Enter a weekly limit in dollars, such as 150.00.");
    await api("/api/autonomy", AutonomyStateResult, { category: state.category, level, ...(weeklyCapCents !== undefined ? { weeklyCapCents } : {}) });
    return "Saved.";
  });
  const saveEntry = (entry: ProfileEntry) => act(async () => {
    const text = (edits[entry.id] ?? String(entry.value)).trim();
    const value = typeof entry.value === "number" ? Number(text) : text;
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Enter a number.");
    if (value === "" ) throw new Error("Enter a value, or forget the entry.");
    await api(`/api/profile/${entry.id}`, EntryResult, { value }, undefined, "PATCH");
    return "Profile updated.";
  });
  const keep = (entry: ProfileEntry) => act(async () => { await api(`/api/profile/${entry.id}/confirm`, EntryResult, {}); return "Kept in your profile."; });
  const forget = (entry: ProfileEntry) => act(async () => { await api(`/api/profile/${entry.id}`, OkResult, undefined, undefined, "DELETE"); return "Forgotten."; });
  const deleteAll = () => act(async () => { await api("/api/me", OkResult, undefined, undefined, "DELETE"); setConfirmDelete(false); return "All your data was deleted. Your history keeps only fingerprints, so it still verifies."; });

  return <main className="screen wide">
    <p className="eyebrow">Your shopping, on your terms</p>
    <h1>Settings</h1>
    <p className="subtitle">Decide what Amasa remembers and how much it prepares for you.</p>
    <p role="status" aria-live="polite">{message}</p>
    {error && <p role="alert">{error}</p>}
    {!audit && !error && <p role="status">Loading your preferences and history...</p>}

    <section aria-labelledby="autonomy-heading"><h2 id="autonomy-heading">How much Amasa does for you</h2>
      <p className="hint">Every category starts at level 0. Amasa only offers more after orders go well, and only you can accept. Lowering always works at once.</p>
      {states.map((state) => <div className="card" key={state.category}>
        <h3>{CATEGORY_NAMES[state.category]}: level {state.level} ({LEVEL_NAMES[state.level]})</h3>
        <div className="autonomy-levels" aria-label="Current autonomy level">{([0, 1, 2] as const).map((level) => <span key={level} aria-current={state.level === level ? "step" : undefined}>{level} · {LEVEL_NAMES[level]}</span>)}</div>
        <p>{LEVEL_DESCRIPTIONS[state.level]}</p>
        {state.level === 2 && <p>Weekly limit: {money(state.weeklyCapCents)}.</p>}
        <p className="hint">Kept orders in a row: {state.consecutiveGood} of {AUTONOMY.offerAfterGood} needed for the next offer.</p>
        {state.offeredLevel !== null && <div className="panel">
          <p><strong>Offer:</strong> raise {CATEGORY_NAMES[state.category].toLowerCase()} to level {state.offeredLevel} ({LEVEL_NAMES[state.offeredLevel]}).</p>
          <p>What changes: {LEVEL_DESCRIPTIONS[state.offeredLevel]}</p>
          {state.offeredLevel === 2 && <div><label htmlFor={`cap-${state.category}`}>Weekly limit in dollars</label>
            <input id={`cap-${state.category}`} inputMode="decimal" value={caps[state.category] ?? (AUTONOMY.defaultWeeklyCapCents / 100).toFixed(2)}
              onChange={(event) => setCaps({ ...caps, [state.category]: event.target.value })} /></div>}
          <div className="choice-row">
            <button type="button" className="choice" disabled={busy} onClick={() => setLevel(state, state.offeredLevel!)}>Accept</button>
            <button type="button" className="choice" disabled={busy} onClick={() => setLevel(state, state.level)}>No thanks</button>
          </div>
        </div>}
        {state.level > 0 && <button type="button" disabled={busy} onClick={() => setLevel(state, (state.level - 1) as Level)}>
          Lower to level {state.level - 1} ({LEVEL_NAMES[(state.level - 1) as Level]})</button>}
      </div>)}
    </section>

    <section aria-labelledby="profile-heading" id="profile"><h2 id="profile-heading">Your profile</h2>
      {audit && entries.length === 0 && <div className="empty-state"><h3>Nothing saved yet.</h3><p className="hint">Preferences you choose to keep will appear here. You can edit or forget them at any time.</p></div>}
      <ul className="rules">{entries.map((entry) => <li className="chip" key={entry.id}>
        {entry.status === "suggested" ? <>
          <span>Suggestion: {CATEGORY_WORDS[entry.category]} {entry.key.replaceAll("_", " ")} {String(entry.value)}. {entry.note}</span>
          <span className="choice-row">
            <button type="button" className="choice" disabled={busy} onClick={() => keep(entry)}>Keep</button>
            <button type="button" className="choice" disabled={busy} onClick={() => forget(entry)}>Forget</button>
          </span>
        </> : <>
          <label htmlFor={`entry-${entry.id}`}>{CATEGORY_WORDS[entry.category]} {entry.key.replaceAll("_", " ")}</label>
          <input id={`entry-${entry.id}`} value={edits[entry.id] ?? String(entry.value)} maxLength={40}
            inputMode={typeof entry.value === "number" ? "decimal" : undefined} onChange={(event) => setEdits({ ...edits, [entry.id]: event.target.value })} />
          <button type="button" className="secondary" disabled={busy} onClick={() => saveEntry(entry)}>Save</button>
          <button type="button" className="secondary" disabled={busy} onClick={() => forget(entry)}>Forget</button>
        </>}
      </li>)}</ul>
    </section>

    {audit && <section aria-labelledby="history-heading" id="history"><h2 id="history-heading">Your history</h2>
      <p>{audit.check.ok ? `Tamper-evident and verified: ${audit.check.length} entries, each linked to the one before.` : `The history check failed at entry ${audit.check.brokenAt}.`}</p>
      {audit.entries.length === 0 && <p className="hint">No activity yet. Your shopping decisions will appear here.</p>}
      <ul className="history">{audit.entries.slice(0, 15).map((entry) => <li key={entry.seq}>
        {new Date(entry.ts).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}: {entry.erased ? "erased at your request" : AUDIT_WORDS[entry.type] ?? entry.type}
      </li>)}</ul>
    </section>}

    <section aria-labelledby="delete-heading"><h2 id="delete-heading">Delete all my data</h2>
      <p>Deletes your contracts, orders, profile and autonomy settings. Your history keeps only fingerprints, so it still verifies.</p>
      {!confirmDelete ? <button type="button" disabled={busy} onClick={() => setConfirmDelete(true)}>Delete all my data</button>
        : <div className="panel"><p><strong>Delete everything now?</strong> This can&apos;t be undone.</p>
          <div className="choice-row">
            <button type="button" className="choice" disabled={busy} onClick={deleteAll}>Yes, delete everything</button>
            <button type="button" className="choice" disabled={busy} onClick={() => setConfirmDelete(false)}>Keep my data</button>
          </div></div>}
    </section>
    <p><a href="/">Back to home</a></p>
  </main>;
}
