# Amasa: instructions for Claude Code

## What this project is

Amasa is a personal AI shopping agent for the Visa hackathon track
"The Future of Shopping: Powered by AI, Secured by Visa".
AI does the shopping; only deterministic code and Visa move money.
It learns how the user shops and asks less over time ("earned autonomy").

Solo hackathon build: one Next.js app (which also serves one mock store),
one isolated payments service, shared packages. No team workflow.

- Full technical spec: `docs/SPEC.md` (section numbers are referenced below as §N)
- Milestones, acceptance checks and prompts: `docs/BUILD_ORDER.md`

These two files are NOT auto-imported, to keep context small.
Before writing code for a task, open `docs/SPEC.md` and read the sections the
task names. Work on one milestone at a time.

## Invariants: never break these

If a task seems to require breaking one, stop and ask the user.

- **I1 No model can move money.** No LLM ever gets a tool that creates invoices,
  payment links or payments. Only `services/payments` talks to Visa.
- **I2 Every payment matches a confirmed contract.** Carts carry `contractHash`;
  the verifier signs a verdict; the payments service checks the signature (§9, §10).
- **I3 Spend never exceeds the cap.** Checked in the verifier AND again in the
  payments service, in separate processes.
- **I4 Untrusted text never becomes instructions.** Merchant page text goes only
  to the reader model, which has no tools. The planner sees typed fields only (§7).
- **I5 Tamper-evident history.** The audit log is append-only and hash-chained (§13).
- **I6 No card data.** Cards are entered only on Visa's hosted payment-link page.
  Never accept, store or log a card number.
- **I7 Revocation is immediate.** Autonomy level is read server-side at verify and
  at pay time, never trusted from the client (§11).

## Repo layout

```text
apps/web/                  Next.js 16 App Router (UI + API routes + mock store)
  app/(screens)/           the 8 screens (§16)
  app/api/                 app API (§5)
  app/api/store/           MOCK MERCHANT: treat as an external system (§4)
  lib/agent/               planner loop (§7)
  lib/db/                  SQLite access (§14)
packages/schemas/          zod schemas, canonical JSON, hashing (§2)
packages/verifier/         pure verification rules (§9)
packages/reader/           quarantined reader + injection scanner (§7, §8)
packages/audit/            hash-chained audit log (§13)
packages/tap-signer/       STRETCH ONLY, milestone M7 (§15)
services/payments/         isolated Node service, the only Visa caller (§10)
data/                      products.json, seeds, replay cache (§17)
evals/                     naive agent + red-team suite (§18)
scripts/                   gen-keys, seed, setup
```

## Commands (create them in M0 and keep them working)

- `pnpm install`
- `pnpm dev` runs the web app on http://localhost:3000
- `pnpm --filter payments dev` runs the payments service on 127.0.0.1:4100
- `pnpm test` (Vitest), `pnpm typecheck` (tsc --noEmit across the workspace)
- `pnpm keys` generates Ed25519 key pairs into `.env.local` files (§10)
- `pnpm seed` loads demo data (§17); `pnpm redteam` runs the red-team suite (§18)

## Tech and versions (checked on npm, 2026-10-17)

- Node >= 22 (required by `ai` 7 and `better-sqlite3` 13)
- `next` 16.4.2 (App Router), React, TypeScript in strict mode
- `ai` 7.0.143 plus one provider package (`@ai-sdk/anthropic` 4.0.82 or `@ai-sdk/openai` 4.0.96)
- `zod` 4.6.7 in apps/web and packages/*
- `better-sqlite3` 13.0.3, `vitest` 5.0.5, pnpm workspaces
- `services/payments` pins `@visaacceptance/agent-toolkit` at exactly `0.0.96`.
  That package depends on `ai` ^4.3.11 and `zod` ^3.24.3, so it must never be
  imported from apps/web or packages/*. It has its own package.json and node_modules.

## Writing AI SDK code

AI SDK v7 renamed many APIs from earlier versions. Before writing or changing
any AI SDK call, read the docs bundled in `node_modules/ai/docs` and the
provider package's docs. Never write AI SDK code from memory or from old tutorials.
If an API in this spec does not exist in the installed version, use the documented
equivalent and say so.

## Coding conventions

- Money is integer cents everywhere. Format to dollars only in UI code.
- Validate with zod at every boundary: API input, model output, store responses,
  calls between services. Use strict objects (unknown keys rejected).
- `packages/verifier` is pure: no network, no LLM, no clock reads inside rules
  (pass `now` in as an argument).
- Every hash and signature uses `canon()` and `sha256()` from `packages/schemas`.
  Never hash `JSON.stringify` output directly.
- Render model-written text as plain text, never as HTML.
- No secrets in prompts, client code or logs. Never prefix server env vars with
  `NEXT_PUBLIC_`. Redact keys, tokens and emails in logs.
- Errors are typed `{ code, message }`; the UI shows a plain-language message.
- Keep modules small: one file per pipeline stage.

## Testing and definition of done

- Every verifier rule has at least one passing and one failing unit test (§9).
- Run `pnpm test` and `pnpm typecheck` before saying a task is done.
- A milestone is done only when its acceptance checks in `docs/BUILD_ORDER.md` pass.

## Do not

- Add features outside the current milestone.
- Give the naive evaluation agent a real payment tool; it gets a fake recorder (§18).
- Fork Visa's TAP sample repo (out of scope for a solo build).
- Use dark patterns: timers, urgency copy, pre-checked add-ons, guilt-trip buttons (§16).
- Say in UI copy that Amasa pays unattended. Level 2 prepares a one-tap payment.
- Commit `.env*` files or the SQLite database files.

## When unsure

Ask instead of guessing about anything that touches the money path, signature
formats, or the Visa toolkit's behavior.

## Delegation rule (saving Claude tokens)

- Do NOT write or edit code yourself. Delegate all implementation by running:
  `codex exec -s workspace-write -o /tmp/codex_out.txt "<task>" > /dev/null 2>&1; cat /tmp/codex_out.txt`
- Give Codex the full context in the prompt: goal, file paths, constraints, how to verify.
- Tell Codex in every task never to open, print or edit `.env*` files (they hold the Visa secret and
  the signing key), and to read the relevant CLAUDE.md invariants and SPEC sections first.
- For follow-up fixes on the same task, continue Codex's session instead of re-explaining:
  `codex exec resume --last -o /tmp/codex_out.txt "<fix>" > /dev/null 2>&1; cat /tmp/codex_out.txt`
- Codex tasks can take several minutes. Use a long Bash timeout (up to 10 min) or run it in the background.
- Verify cheaply: `git diff --stat`, run tests, read only changed lines. Review every money-path change
  (invariants I1–I7) before accepting it.
- If Codex's result is wrong, send a follow-up with the specific fix. Don't fix it yourself.
- Docs and README edits, git commits (user picks the message, no Claude co-author line) and running
  commands stay with Claude. Keep replies to the user short.
