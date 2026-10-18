"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { api } from "../lib/ui/contracts.ts";
import { NoticesResult, OkResult } from "../lib/ui/purchase-api.ts";
import type { z } from "zod";

type Notice = z.infer<typeof NoticesResult>["notices"][number];

// SPEC §16 "Change notices (all screens)": whenever an autonomy level or profile entry changes, say
// what changed and why, with a link to Settings. Shown until dismissed.
export function NoticeBanner() {
  const pathname = usePathname();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    const load = () => api("/api/notices", NoticesResult, undefined, abort.signal).then(({ notices: list }) => setNotices(list)).catch(() => {});
    void load();
    window.addEventListener("amasa:changed", load);
    return () => { abort.abort(); window.removeEventListener("amasa:changed", load); };
  }, [pathname]);
  const dismiss = (id: string) => {
    setNotices((list) => list.filter((n) => n.id !== id));
    api(`/api/notices/${id}/seen`, OkResult, {}).catch(() => {});
  };
  const dismissAll = () => {
    const ids = notices.map((n) => n.id);
    setNotices([]);
    for (const id of ids) api(`/api/notices/${id}/seen`, OkResult, {}).catch(() => {});
  };
  if (!notices.length) return null;
  // The newest changes first; older ones stay one tap away.
  const newest = [...notices].reverse();
  const shown = showAll ? newest : newest.slice(0, 3);
  return <aside className="notices" aria-label="Changes" aria-live="polite">
    <ul>{shown.map((notice) => <li key={notice.id}>
      <span>{notice.text}</span>
      <span className="notice-actions"><a href="/settings">Settings</a>
        <button type="button" className="secondary" onClick={() => dismiss(notice.id)} aria-label={`Dismiss: ${notice.text}`}>Dismiss</button></span>
    </li>)}</ul>
    {notices.length > 1 && <p className="notice-actions">
      {notices.length > 3 && <button type="button" className="secondary" onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer" : `Show all (${notices.length})`}</button>}
      <button type="button" className="secondary" onClick={dismissAll}>Dismiss all</button>
    </p>}
  </aside>;
}
