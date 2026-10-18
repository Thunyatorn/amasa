import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NoticeBanner } from "./notice-banner.tsx";
import { SiteHeader, SiteFooter } from "./site-shell.tsx";

export const metadata: Metadata = {
  title: "Amasa",
  description: "A personal shopping agent that never pays without your OK.",
  icons: { icon: { url: "/brand/amasa-logo.svg", type: "image/svg+xml", sizes: "any" } },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body><SiteHeader /><NoticeBanner /><div id="main-content" tabIndex={-1}>{children}</div><SiteFooter /></body>
    </html>
  );
}
