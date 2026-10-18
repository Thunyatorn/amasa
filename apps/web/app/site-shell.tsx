"use client";

import { usePathname } from "next/navigation";

export function SiteHeader() {
  const pathname = usePathname();
  const stage = pathname.startsWith("/contract/") ? "Review contract" : pathname.startsWith("/shop/") ? "Explore options" : pathname.startsWith("/receipt/") ? "Order receipt" : null;
  return <>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <header className="site-header"><div className="header-inner">
      <a className="wordmark" href="/" aria-label="Amasa home"><img className="brand-logo" src="/brand/amasa-logo.svg" width="120" height="60" alt="Amasa" /></a>
      <span className="environment-label">Personal shopping · Demo</span>
      <nav aria-label="Main navigation"><a href="/" aria-current={pathname === "/" ? "page" : undefined}>New goal</a>{stage && <span className="current-stage" aria-current="page">{stage}</span>}<a href="/settings" aria-current={pathname === "/settings" ? "page" : undefined}>Settings</a></nav>
    </div></header>
  </>;
}

export function SiteFooter() {
  return <footer className="site-footer"><div><a className="wordmark" href="/" aria-label="Amasa home"><img className="brand-logo" src="/brand/amasa-logo.svg" width="120" height="60" alt="Amasa" /></a><p>Thoughtful shopping. Your rules.</p></div><p>You choose the goal. You control the budget.<br/>Payment completes on Visa&apos;s hosted page.</p><a href="/settings">Your preferences &amp; data ↗</a></footer>;
}
