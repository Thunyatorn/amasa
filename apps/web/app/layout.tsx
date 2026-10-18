import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NoticeBanner } from "./notice-banner.tsx";

export const metadata: Metadata = {
  title: "Amasa",
  description: "A personal shopping agent that never pays without your OK.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body><NoticeBanner />{children}</body>
    </html>
  );
}
