"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, ContractResult, Id } from "../../../lib/ui/contracts.ts";

export default function ShopPage() {
  const { contractId } = useParams<{ contractId: string }>();
  const [hash, setHash] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setHash(""); setError("");
    const id = Id.safeParse(contractId);
    if (!id.success) { setError("Choose a valid contract to continue."); return; }
    api(`/api/contracts/${id.data}`, ContractResult, undefined, controller.signal).then((result) => { if (!controller.signal.aborted) setHash(result.contractHash); }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "We couldn't load this contract. Please try again."); });
    return () => controller.abort();
  }, [contractId]);
  return <main className="screen"><h1>{hash ? "Contract confirmed" : "Your contract"}</h1>
    {hash && <><h2>Contract hash</h2><p className="hash">{hash}</p><p role="status">Shopping...</p><p className="hint">Shopping results will be available in milestone M4.</p></>}
    <p aria-live="polite" role="status">{error || (!hash ? "Loading your contract..." : "")}</p><a href="/">Back to home</a>
  </main>;
}
