"use client";

import { usePathname } from "next/navigation";

export function SiteHeader() {
  const pathname = usePathname();
  const stage = pathname.startsWith("/contract/") ? "Review contract" : pathname.startsWith("/shop/") ? "Explore options" : pathname.startsWith("/receipt/") ? "Order receipt" : null;
  return <>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <header className="site-header"><div className="header-inner">
      <a className="wordmark" href="/" aria-label="Amasa home"><img className="brand-logo" src="/brand/amasa-logo.svg" width="120" height="60" alt="Amasa" /></a>
      <nav aria-label="Main navigation"><a href="/" aria-current={pathname === "/" ? "page" : undefined}>Home</a>{stage && <span className="current-stage" aria-current="page">{stage}</span>}<a href="/settings" aria-current={pathname === "/settings" ? "page" : undefined}>Settings</a></nav>
    </div></header>
  </>;
}
