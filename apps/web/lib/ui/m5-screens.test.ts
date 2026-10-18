import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FailureCode } from "@amasa/schemas";
import { FAILURE_TEXT, failureClause } from "../failure-text.ts";
import { approvalChecks, ApprovalPanel, BlockedPanel, PaymentReady } from "../../app/shop/[contractId]/approval.tsx";

vi.mock("next/navigation", () => ({ usePathname: () => "/settings", useParams: () => ({}), useRouter: () => ({ push: () => {} }) }));
const html = (element: unknown) => renderToStaticMarkup(element as never);
const noop = () => {};
const URGENCY = /hurry|only \d+ left|limited time|act now|selling fast|last chance|don['’]t miss|today only|before it['’]s gone/i;

describe("every failure code has a plain sentence (SPEC §16 screen 6)", () => {
  it.each(FailureCode.options)("%s", (code) => {
    const sentence = FAILURE_TEXT[code];
    expect(sentence).toMatch(/^[A-Z].+\.$/);
    expect(sentence).not.toMatch(/[A-Z]{2,}_[A-Z]/);
    expect(failureClause(code)).toBe(sentence.charAt(0).toLowerCase() + sentence.slice(1, -1));
  });
});

describe("approval panel (screen 5)", () => {
  const panel = (expired = false) => html(createElement(ApprovalPanel, { title: "Tom Hanks", totalCents: 29376, budgetCapCents: 30000,
    checks: ["✓ oscar is yes"], busy: false, error: "", expired, onApprove: noop, onNotNow: noop, onCheckAgain: noop }));
  it("shows verifier-checked facts, the budget left and where the card is entered", () => {
    const markup = panel();
    expect(markup).toContain("Total 293.76 VU, including tax (= $293.76 at the demo rate of 1 VU = $1.00). 6.24 VU of your 300.00 VU budget left.");
    expect(markup).toContain("You&#x27;ll enter your card on Visa&#x27;s secure page.");
    expect(markup).toContain("<li>✓ oscar is yes</li>");
    expect(markup).not.toMatch(URGENCY);
  });
  it("gives Approve and Not now exactly the same weight", () => {
    const buttons = [...panel().matchAll(/<button type="button" class="([^"]+)"[^>]*>([^<]+)<\/button>/g)].map((m) => [m[1], m[2]]);
    expect(buttons).toEqual([["choice", "Approve"], ["choice", "Not now"]]);
  });
  it("offers Check again instead of Approve when the 5-minute approval expired", () => {
    expect(panel(true)).toContain(">Check again</button>");
    expect(panel(true)).not.toContain(">Approve</button>");
  });
  it("lists what the verifier checked from the contract", () => {
    expect(approvalChecks({ mustHave: [{ key: "oscar", op: "eq", value: "yes" }], minReturnDays: 14, quantity: 1, deadline: "2026-10-25" }))
      .toEqual(expect.arrayContaining(["✓ oscar is yes", "✓ Refund window: at least 14 days", "✓ Quantity: 1", "✓ Delivered by 2026-10-25"]));
  });
});

describe("blocked state (screen 6) and payment page", () => {
  it("shows sentences, never codes, with Pick another option and Edit the rule", () => {
    const markup = html(createElement(BlockedPanel, { codes: ["OVER_BUDGET", "WEEKLY_CAP_EXCEEDED", "OVER_BUDGET"], busy: false, error: "", onPickAnother: noop, onEditRule: noop }));
    expect(markup).toContain(FAILURE_TEXT.OVER_BUDGET.replace(/'/g, "&#x27;"));
    expect(markup).toContain("This order would go over your weekly limit.");
    expect(markup).not.toContain("OVER_BUDGET");
    expect(markup.match(/<li>/g)).toHaveLength(2);
    expect(markup).toContain('class="choice"');
    expect(markup).toContain("Nothing was charged.");
  });
  it("level 2 says the payment page is ready, never that Amasa paid", () => {
    const markup = html(createElement(PaymentReady, { purchaseNumber: "ABCDEF0123456789", paymentLinkUrl: "https://ebc2test.cybersource.com/pay/x", prepared: true, onClose: noop }));
    expect(markup).toContain("Ready to pay: one tap");
    expect(markup).toContain('target="_blank" rel="noopener noreferrer"');
    expect(markup).toContain('href="/receipt/ABCDEF0123456789"');
    expect(markup).toContain("Nothing is paid until you finish on Visa&#x27;s page.");
  });
});

describe("UI copy rules (CLAUDE.md, SPEC §16)", () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? (n === "api" ? [] : files(p)) : p.endsWith(".tsx") ? [p] : [];
  });
  it("no screen uses urgency copy or says Amasa pays by itself", () => {
    for (const file of files(join(import.meta.dirname, "../../app"))) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(URGENCY);
      expect(source, file).not.toMatch(/pays? (for you|automatically|unattended)|auto-?pay|paid automatically/i);
    }
  });
  it("settings shows the autonomy section and an easy-to-find delete", async () => {
    const { default: SettingsPage } = await import("../../app/settings/page.tsx");
    const markup = html(createElement(SettingsPage));
    expect(markup).toContain("How much Amasa does for you");
    expect(markup).toContain(">Delete all my data</button>");
  });
});
