# Amasa build order

Nine milestones for a solo build, matching the Solo plan in the design doc.
Do them in order. Each has a prompt to paste into Claude Code and acceptance checks.
Do not start the next milestone until every check passes.

Tip: start each milestone in a fresh Claude Code session so the context holds only
`CLAUDE.md`, the rules, and the spec sections that milestone needs.

---

## M0 · Scaffold and first Visa call (hours 0–3)

**You do first (not Claude Code):**
- Install Node 22+ and pnpm.
- Create a Visa Acceptance sandbox account and copy the merchant ID, API key ID and
  shared secret into `services/payments/.env` (template in `.env.example`).
- Ask the Visa mentors whether Visa Intelligent Commerce sandbox access is available.

**Prompt:**

```text
Read CLAUDE.md and docs/SPEC.md §1, §10.1, §10.4, §14, §19.
Implement milestone M0 from docs/BUILD_ORDER.md:
- pnpm workspace with apps/web (Next.js 16, TypeScript strict), packages/schemas,
  packages/verifier, packages/reader, packages/audit, services/payments, evals, scripts.
- services/payments has its own package.json pinning @visaacceptance/agent-toolkit to
  exactly 0.0.96, a node:http server bound to 127.0.0.1:4100 with GET /health, and a
  script `pnpm --filter payments link:test` that creates one $1.00 sandbox payment link
  using the code in §10.4 and logs the raw response once.
- scripts/gen-keys.mjs per §10.1, wired to `pnpm keys`.
- Root scripts: dev, test, typecheck, keys, seed, redteam (seed and redteam can be stubs).
- .gitignore covering .env*, *.db, data/replay/.
Stop when the acceptance checks pass. Do not start M1.
```

**Acceptance checks**
- [ ] `pnpm install`, `pnpm typecheck` and `pnpm test` succeed
- [ ] `pnpm --filter payments link:test` prints a sandbox response that is not "Failed to create payment link"
- [ ] You noted which response field holds the link URL (SPEC §20 item 1)
- [ ] `pnpm keys` writes the verifier key pair to the two env files and prints no private key
- [ ] `git status` shows no `.env` file

---

## M1 · Schemas and verifier (hours 3–6)

**Prompt:**

```text
Read CLAUDE.md and docs/SPEC.md §2, §4.1, §9.
Implement milestone M1: all schemas in packages/schemas (including canon, sha256 and
pricing.ts), and packages/verifier with verify() and every rule in §9.2.
Write every unit test in §9.3, the canon tests, and the no-model test in §9.4.
No network calls, no model imports. Stop when the acceptance checks pass.
```

**Acceptance checks**
- [ ] Every row of SPEC §9.3 has a test, and all pass
- [ ] The no-model test fails if you temporarily add `import "ai"` to the verifier (then remove it)
- [ ] Pricing test: $129.00 → total $139.32; $117.00 → $126.36

---

## M2 · Mock store, signed verdict, payments end to end (hours 6–9)

**Prompt:**

```text
Read CLAUDE.md and docs/SPEC.md §3, §4, §5 (contracts, carts, verify, approve rows), §10, §13, §14, §17.1–§17.2.
Implement milestone M2:
- data/products.json with the 4 required demo products from §17.2 plus at least 10 others.
- The mock store routes in §4, reached only over HTTP via STORE_BASE_URL.
- SQLite access in apps/web/lib/db, the audit log package (§13).
- /api/contracts, /api/carts, /api/verify, /api/approve, and services/payments POST /pay
  with every check in §10.3, in order.
- A script `pnpm e2e:hardcoded` that confirms a hard-coded contract for SHOE-WIDE-01,
  builds a cart, verifies it and approves it, printing the payment link.
No model calls in this milestone. Stop when the acceptance checks pass.
```

**Acceptance checks**
- [ ] `pnpm e2e:hardcoded` prints a sandbox payment link for $139.32
- [ ] Sending the same signed request to `/pay` twice: the second gets 409 and no Visa call
- [ ] Editing one line's `unitCents` in the request makes `/pay` reject it
- [ ] A verdict older than 5 minutes is rejected
- [ ] `GET /api/audit/verify` returns `ok: true`; editing one audit row by hand makes it return that row's seq

---

## M3 · Intake, contract card, profile basics (hours 9–12)

**Prompt:**

```text
Read CLAUDE.md, .claude/rules/llm-code.md, .claude/rules/ui.md and docs/SPEC.md §2.2, §2.10, §5 (intake, contracts, profile rows), §7.1, §12, §16 screens 1–2.
Read node_modules/ai/docs before writing AI SDK code.
Implement milestone M3: /api/intake with the exact prompt in §7.1, screens 1 and 2,
the profile API, and seeded profile entries from §17.3. Stop when the acceptance checks pass.
```

**Acceptance checks**
- [ ] "wide running shoes for a half marathon, size 10.5, under $140, must be returnable" produces a draft with budget 14000, width wide, size 10.5, minReturnDays ≥ 14
- [ ] A goal with no budget returns `budgetCapCents: null` and a question
- [ ] Every chip on screen 2 is editable by keyboard; "Looks right" confirms and stores the hash

---

## M4 · Shopping run, options and compare (hours 12–15)

**Prompt:**

```text
Read CLAUDE.md, both rules files for model code and UI, and docs/SPEC.md §2.3–§2.7, §2.14, §6, §7.2–§7.4, §8, §16 screens 3–4.
Read node_modules/ai/docs before writing AI SDK code.
Implement milestone M4: /api/shop following §7.4 exactly, the scanner and sanitizing in §8,
the reader with the exact prompt in §7.3, the planner with exactly two tools and the exact
prompt in §7.2, the SSE progress stream in §6, and screens 3–4 including the compare table
and the "Filtered out" list. Stop when the acceptance checks pass.
```

**Acceptance checks**
- [ ] With the seeded profile, the options include SHOE-WIDE-01 and SHOE-WIDE-02, and the compare table highlights "$12.96 cheaper but 14-day returns"
- [ ] SHOE-LUX-01 appears under "Filtered out" with a plain-language reason
- [ ] Each option has a one-line reason on the card and a "Why?" toggle with the full reasons and data used
- [ ] The contract card appears before shopping finishes; review quotes are labeled "Store review"
- [ ] Progress steps appear live, and Cancel stops the run
- [ ] A run never exceeds MAX_STEPS model steps (check the log)
- [ ] Gate: the full personalized happy path works live, ending in a payment link

---

## M5 · Approval, receipt, autonomy, audit in the UI (hours 15–19)

**Prompt:**

```text
Read CLAUDE.md, .claude/rules/ui.md, .claude/rules/money-path.md and docs/SPEC.md §3, §5 (outcomes, autonomy, me rows), §11, §12, §13, §16 screens 5–8, §17.3.
Implement milestone M5: the approval panel, the blocked state with a sentence for every
FailureCode, the receipt with Kept/Returned and profile suggestions, the settings screen
with the autonomy dial and delete-all, the level 2 flow in §5, and `pnpm seed` from §17.3.
Stop when the acceptance checks pass.
```

**Acceptance checks**
- [ ] After `pnpm seed`, the groceries category shows a level-1 offer; accepting it makes the next order one tap
- [ ] Lowering a level takes one tap and the very next purchase asks for approval
- [ ] An automatic demotion (a verifier block in that category) shows a change notice saying what changed and why
- [ ] Returning a size-10.5 shoe as too small creates a suggested `size = 11` entry with Keep / Forget
- [ ] Every FailureCode shows a plain sentence, not a code
- [ ] "Approve" and "Not now" look equally weighted; no urgency copy anywhere

---

## M6 · Naive agent and red-team suite (hours 19–22)

**Prompt:**

```text
Read CLAUDE.md, .claude/rules/llm-code.md and docs/SPEC.md §18.
Implement milestone M6: the naive agent with a FAKE pay tool, the 10 red-team overlays,
and `pnpm redteam`, which runs both agents on every case and prints the metrics table in §18.3.
Never import services/payments from evals. Stop when the acceptance checks pass.
```

**Acceptance checks**
- [ ] `pnpm redteam` runs all 10 cases for both agents and prints the table
- [ ] The naive agent's pay calls go only to the fake recorder
- [ ] You copied the real numbers into the pitch, including any attack that got through

---

## Hours 22–24 · Usability test (you, not Claude Code)

Run the five-minute test from the design doc's UX playbook with 3 people. Fix the top
issue (a small prompt to Claude Code naming the exact screen and change), then retest.

---

## M7 · Polish and stretch (hours 24–28)

Only if M0–M6 all pass. Pick in this order and stop at hour 28:

1. UI polish from the usability test.
2. RFC 9421-style agent signing, SPEC §15 (prompt: "Read docs/SPEC.md §15 and implement it behind TAP_ENABLED").
3. Replay mode, SPEC §17.4.

**Acceptance checks**
- [ ] With `TAP_ENABLED=true`, a request with a reused nonce or a 2-minute-old `created` is rejected by the store
- [ ] With `DEMO_REPLAY=true` and Wi-Fi off, the demo runs end to end

---

## M8 · Demo hardening (hours 28–36)

- Sleep at least 4 hours.
- Rehearse the demo 5 times; record a backup video of a full run.
- Run `pnpm test`, `pnpm redteam`, `GET /api/audit/verify` one last time.
- Pre-demo checklist from the Security design tab: secret scan, client bundle has no
  server-only variable names, every service on SANDBOX, spend cap on the model key.
