import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NoticeBanner } from "./notice-banner.tsx";
import { SiteHeader } from "./site-shell.tsx";

export const metadata: Metadata = {
  title: "Amasa",
  icons: { icon: { url: "/brand/amasa-logo.svg", type: "image/svg+xml", sizes: "any" } },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body><SiteHeader /><NoticeBanner /><div id="main-content" tabIndex={-1}>{children}</div></body>
    </html>
  );
}
