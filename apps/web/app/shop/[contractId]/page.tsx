"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { useParams } from "next/navigation";
import type { z } from "zod";
import { api, ContractResult, Id, ruleLabel } from "../../../lib/ui/contracts.ts";
import { streamShop } from "../../../lib/ui/sse.ts";
import { initialShopState, shopReducer, summaryLine } from "../../../lib/ui/shop-state.ts";
import { CompareTableView, FilteredOut, money, OptionCards, OthersList, StepList } from "./results.tsx";

// Screens 3–4 (SPEC §16): the contract card first, live steps with Cancel while the run streams
// (§6), then options, compare table and the "Filtered out" list.
export default function ShopPage() {
  const { contractId } = useParams<{ contractId: string }>();
  const [contract, setContract] = useState<z.infer<typeof ContractResult> | null>(null);
  const [contractError, setContractError] = useState("");
  const [state, dispatch] = useReducer(shopReducer, initialShopState);
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const [showMore, setShowMore] = useState(false);
  const [runKey, setRunKey] = useState(0);
  const [now] = useState(() => Date.now());
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    const id = Id.safeParse(contractId);
    if (!id.success) { setContractError("Choose a valid contract to continue."); return; }
    const abort = new AbortController();
    api(`/api/contracts/${id.data}`, ContractResult, undefined, abort.signal)
      .then((result) => { if (!abort.signal.aborted) setContract(result); })
      .catch((cause: unknown) => { if (!abort.signal.aborted) setContractError(cause instanceof Error ? cause.message : "We couldn't load this contract."); });
    return () => abort.abort();
  }, [contractId]);

  useEffect(() => {
    const id = Id.safeParse(contractId);
    dispatch({ type: "start" }); setOpen(new Set()); setShowMore(false);
    if (!id.success) { dispatch({ type: "failed", message: "Choose a valid contract to continue." }); return; }
    const abort = new AbortController();
    controller.current = abort;
    let finished = false;
    streamShop(id.data, abort.signal, (event) => {
      if (event.type === "done" || event.type === "error") finished = true;
      dispatch({ type: "event", event });
    }).then(() => {
      if (!abort.signal.aborted && !finished) dispatch({ type: "failed", message: "The search stopped before it finished. Please try again." });
    }).catch((cause: unknown) => {
      if (!abort.signal.aborted) dispatch({ type: "failed", message: cause instanceof Error ? cause.message : "Something went wrong. Please try again." });
    });
    return () => abort.abort();
  }, [contractId, runKey]);

  const cancel = () => { controller.current?.abort(); dispatch({ type: "cancelled" }); };
  const runAgain = () => setRunKey((key) => key + 1);
  const toggle = (rank: number) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(rank)) next.delete(rank); else next.add(rank);
    return next;
  });
  const running = state.status === "running";
  const { result } = state;

  return <main className="screen wide">
    <h1>{running ? "Shopping for you" : result ? "Your options" : state.status === "cancelled" ? "Search stopped" : "Search didn't finish"}</h1>

    <section className="card" aria-labelledby="contract-heading">
      <h2 id="contract-heading">Your contract</h2>
      {contractError && <p role="alert">{contractError}</p>}
      {!contract && !contractError && <p>Loading your contract...</p>}
      {contract && <>
        <p>{contract.contract.goal}</p>
        <ul className="contract-terms">
          <li>Budget {money(contract.contract.budgetCapCents)}, including tax and shipping</li>
          <li>Quantity {contract.contract.quantity}</li>
          <li>Returns: at least {contract.contract.minReturnDays} days</li>
          {contract.contract.deadline && <li>Arrives by {contract.contract.deadline}</li>}
          {contract.contract.mustHave.map((rule) => <li key={`${rule.key}-${rule.op}-${rule.value}`}>{ruleLabel(rule)} {String(rule.value)}</li>)}
        </ul>
        <p className="hint">Only demo-store is searched. Amasa never pays without your OK.</p>
      </>}
    </section>

    <section aria-labelledby="progress-heading">
      <h2 id="progress-heading">Progress</h2>
      <p className="summary">{summaryLine(state)}</p>
      <StepList steps={state.steps} live={running} />
      {running && <button type="button" onClick={cancel}>Cancel</button>}
      {state.status === "cancelled" && <><p role="status">You stopped the search.</p><button type="button" onClick={runAgain}>Run again</button></>}
      {state.status === "error" && <><p role="alert">{state.error}</p><button type="button" onClick={runAgain}>Try again</button></>}
    </section>

    {result && (result.options.length
      ? <section aria-labelledby="options-heading"><h2 id="options-heading">Options</h2><OptionCards result={result} open={open} onToggle={toggle} now={now} /></section>
      : <p>Nothing at demo-store fits your contract right now.</p>)}
    {result && <CompareTableView result={result} />}
    <FilteredOut state={state} />
    {result && <OthersList result={result} shown={showMore} onShow={() => setShowMore(true)} />}
    <p><a href="/">Start a new goal</a></p>
  </main>;
}
