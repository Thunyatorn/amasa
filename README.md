# Amasa

A personal AI shopping agent for the Visa hackathon track
"The Future of Shopping: Powered by AI, Secured by Visa".
AI does the shopping; only deterministic code and Visa move money. It learns how the user
shops and asks less over time ("earned autonomy").

- Rules for building it: [`CLAUDE.md`](CLAUDE.md) (invariants I1–I7, conventions)
- Technical spec: [`docs/SPEC.md`](docs/SPEC.md) (referenced below as §N)
- Milestones and acceptance checks: [`docs/BUILD_ORDER.md`](docs/BUILD_ORDER.md)

## Status

| Milestone | State |
| --- | --- |
| **M0** Scaffold and first Visa call | ✅ Done: all 5 acceptance checks pass |
| **M1** Schemas and verifier | ✅ Done: all 3 acceptance checks pass |
| **M2** Mock store, signed verdict, payments end to end | ✅ Done: all 5 acceptance checks pass; Visa amount fixed and verified (see M2 fix) |
| **M3** Intake, contract card, profile basics | ✅ All 3 acceptance checks pass (live model: local `gemma4` through Ollama; see M3 below) |
| M4–M8 | Not started |

M0 acceptance checks (docs/BUILD_ORDER.md):

| Check | Result |
| --- | --- |
| `pnpm install`, `pnpm typecheck` and `pnpm test` succeed | ✅ passes (7 packages typecheck; 2 test files, 6 tests) |
| `pnpm --filter payments link:test` prints a sandbox response that is not "Failed to create payment link" | ✅ passes: the sandbox created a $1.00 link with `status: "ACTIVE"` (2026-10-17) |
| Note which response field holds the link URL (SPEC §20 item 1) | ✅ `purchaseInformation.paymentLink` (recorded in SPEC §10.4 and §20) |
| `pnpm keys` writes the verifier key pair to the two env files and prints no private key | ✅ passes |
| `git status` shows no `.env` file | ✅ passes: `services/payments/.env` and `apps/web/.env.local` are ignored; only `.env.example` is listed |

Also checked by hand: `GET http://127.0.0.1:4100/health` returns `{"ok":true}`, the payments
service listens on `127.0.0.1` only, and the web app serves its placeholder page.

## Requirements

- Node.js `>= 22.12` (built and tested on Node 24.14.1)
- pnpm 10 (the repo pins `pnpm@10.33.0` in `packageManager`)
- For `link:test`: a Visa Acceptance **sandbox** account (merchant ID, API key ID, shared secret)

## Setup

```bash
pnpm install
pnpm keys          # creates the verifier key pair and SESSION_SECRET in the env files
```

Then add your Visa sandbox credentials to `services/payments/.env`. `pnpm keys` has already
put `VERIFIER_PUBLIC_KEY_B64` in that file, so keep that line and add:

```bash
VISA_ACCEPTANCE_MERCHANT_ID=...
VISA_ACCEPTANCE_API_KEY_ID=...
VISA_ACCEPTANCE_SECRET_KEY=...
VISA_ACCEPTANCE_ENVIRONMENT=SANDBOX
PAYMENTS_MAX_DAILY_CENTS=50000
```

`PAYMENTS_MAX_DAILY_CENTS` is the payments service's daily limit in cents ($500.00 here); the service
refuses to start without it. One demo order is $139.32, so $500.00 allows 3 links per UTC day:
raise it for rehearsals if needed.

From M3 the web app calls a model for intake. Pick one and add it to `apps/web/.env.local`:

**Local model, free** (needs [Ollama](https://ollama.com) running on this machine). `gemma4`
passed the M3 checks in about 7 seconds per goal on an Apple M5 with 24 GB:

```bash
MODEL_PROVIDER=ollama
MODEL_PLANNER=gemma4:latest
# OLLAMA_BASE_URL=http://127.0.0.1:11434/v1   (this is the default)
```

**Claude through the Anthropic API** (billed by the Anthropic Console, separately from any Claude
subscription; type the key yourself and set a spending cap):

```bash
MODEL_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
MODEL_PLANNER=claude-sonnet-5-5
```

The full list of variables (all of SPEC §19) is in [`.env.example`](.env.example).

## Commands

| Command | What it does |
| --- | --- |
| `pnpm install` | Installs every workspace package |
| `pnpm dev` | Runs the web app (Next.js) on http://127.0.0.1:3000, reachable only from this machine |
| `pnpm --filter payments dev` | Runs the payments service on http://127.0.0.1:4100 |
| `pnpm --filter payments link:test` | Creates one $1.00 SANDBOX payment link and prints the raw response once |
| `pnpm test` | Runs Vitest across the repo |
| `pnpm typecheck` | Runs `tsc --noEmit` in every workspace package (the web app runs `next typegen` first) |
| `pnpm keys` | Generates the verifier key pair (SPEC §10.1) and `SESSION_SECRET` |
| `pnpm e2e:hardcoded` | M2 end-to-end run: contract → cart → verify → approve → sandbox payment link (needs both servers running) |
| `pnpm seed` | Adds the demo profile entries (SPEC §17.3: size 10.5 and width wide confirmed, one suggestion). Safe to run twice. Purchases and autonomy seeds come in M5 |
| `pnpm check:intake` | M3 acceptance check against the live model (2 model calls); needs the model variables above |
| `pnpm redteam` | Stub for now: prints "not implemented until M6" and exits 0 |

## Repository layout

```text
.env.example               every variable from SPEC §19, values empty except safe defaults
.gitignore
package.json               root scripts; dev deps: typescript, vitest, vite, @types/node
pnpm-workspace.yaml        workspace members + packages allowed to run install scripts
tsconfig.base.json         shared strict TypeScript settings
vitest.config.ts           one Vitest run for the whole repo
apps/web/                  Next.js 16 app (package name "web")
  app/layout.tsx           root layout
  app/page.tsx             screen 1: goal box (M3)
  app/contract/[id]/       screen 2: review and edit the draft contract (M3)
  app/shop/[contractId]/   placeholder after confirming; the shopping screen is M4
  app/globals.css          plain CSS, light and dark (M3)
  app/api/                 app API: csrf, contracts, carts, verify, approve, audit/verify (M2);
                           intake, drafts, profile (M3)
  app/api/store/           MOCK MERCHANT demo-store: search, products, page, quote (M2)
  lib/                     env, http errors, session/CSRF, db/, store + payments clients,
                           signing, pipeline/ (one file per stage) (M2)
  lib/agent/               the only code that calls a model: intake prompt, call, stage (M3)
  lib/store-attributes.ts  the store's attribute keys per category (M3)
  lib/ui/                  browser-side schemas and helpers for the screens (M3)
  scripts/e2e-hardcoded.ts pnpm e2e:hardcoded (M2)
  scripts/seed.ts          pnpm seed (M3, profile part)
  scripts/intake-check.ts  pnpm check:intake (M3)
  next.config.ts
  tsconfig.json
  AGENTS.md                generated by `next dev` itself (not hand-written)
packages/schemas/          @amasa/schemas   zod schemas, canon/sha256, cartHash, pricing (M1)
packages/verifier/         @amasa/verifier  pure verify() + one function per rule (M1)
packages/reader/           @amasa/reader    empty stub (M4)
packages/audit/            @amasa/audit     hash-chained audit log (M2)
services/payments/         isolated payments service (package name "payments")
  src/server.ts            node:http server, 127.0.0.1 only, GET /health, POST /pay
  src/pay.ts               the §10.3 checks, in order (M2)
  src/schema.ts            zod 3 copy of SignedFields / PaymentRequest (M2)
  src/verdict.ts, db.ts    Ed25519 check, payments.db (M2)
  src/visa.ts              the only Visa caller (SPEC §10.4)
  src/link-test.ts         the M0 $1.00 sandbox payment-link check
  src/server.test.ts
evals/                     @amasa/evals     empty stub (M6)
scripts/
  gen-keys.mjs             pnpm keys
  gen-keys.test.ts
  seed.mjs                 runs apps/web/scripts/seed.ts
  redteam.mjs              stub (M6)
data/products.json         the mock store's 50 products (M2); amasa.db and payments.db
                           are created here at runtime and git-ignored
docs/                      SPEC.md, BUILD_ORDER.md
```

Files that exist locally but are git-ignored: `apps/web/.env.local`, `services/payments/.env`,
`node_modules/`, `apps/web/.next/`, `apps/web/next-env.d.ts`, `*.tsbuildinfo`.

## What was built in M0, in detail

### Workspace
- A pnpm workspace with members `apps/*`, `packages/*`, `services/*` and `evals`.
- Pinned versions from `CLAUDE.md`: `next` 16.4.2, `vitest` 5.0.5. React resolves to 19.3.1.
  `ai`, `zod` and `better-sqlite3` are not installed yet, because nothing in M0 uses them.
  They get added in the milestone that first needs them.
- `vite` is a dev dependency because Vitest 5 lists it as a required peer.
- `pnpm-workspace.yaml` sets `onlyBuiltDependencies` (`better-sqlite3`, `esbuild`, `sharp`),
  because pnpm 10 blocks dependency install scripts by default.
- Every TypeScript package is `strict`, plus `noUncheckedIndexedAccess`.

### Payments service (`services/payments`)
- Its own `package.json` pins `@visaacceptance/agent-toolkit` to exactly `0.0.96`. That
  package brings in `ai` 4 and `zod` 3. pnpm's strict layout keeps them inside this package's
  dependency tree, and nothing in `apps/web` or `packages/*` imports this service.
- `src/server.ts`: plain `node:http`, bound to `127.0.0.1` (SPEC §10.3 step 1), on port `PORT`
  (default 4100). `GET /health` returns `{ "ok": true }`. Every other route returns
  `404 { "code": "NOT_FOUND", "message": "No such route." }`. `POST /pay` arrives in M2.
- `src/visa.ts`: the code from SPEC §10.4 with these safeguards:
  - It always passes `"SANDBOX"` to the toolkit constructor.
  - It refuses to run if `VISA_ACCEPTANCE_ENVIRONMENT` is set to anything other than `SANDBOX`.
  - It loads the toolkit only when a link is first created (see the findings below).
  - `newPurchaseNumber()` makes a 16-character `[A-Z0-9]` purchase number using
    `crypto.randomInt` (SPEC §2.9, §10.2).
  - `createLink()` takes a local `LinkRequest` type, the subset of `PaymentRequest` (§2.9) it
    needs, because the shared schemas arrive in M1.
- `src/link-test.ts`: checks that the three credentials are set, creates one $1.00 link
  (one line item, "Amasa link test", no tax or shipping), and prints the purchase number and
  the raw response once. It exits with code 1 on any error, including the toolkit's
  "Failed to create payment link".
- `dev` loads `.env` if it exists. `link:test` requires `.env`.

### Verifier keys (`scripts/gen-keys.mjs`, `pnpm keys`)
- Generates an Ed25519 key pair exactly as in SPEC §10.1 (SPKI and PKCS8, PEM, then base64).
- Writes `VERIFIER_PRIVATE_KEY_B64` to `apps/web/.env.local` and `VERIFIER_PUBLIC_KEY_B64` to
  `services/payments/.env`.
- Only writes a variable when it is not already set. An empty placeholder line
  (`NAME=`) gets filled in; every other line is kept.
- If only one half of the pair exists, it exits with an error instead of writing a new half
  that would not match.
- Creates files with permission `0600`. Prints file names only, never key material.

#### What the verifier keys are for (SPEC §9, §10; invariants I1, I2, I3)
The payments service pays only for purchases the verifier has approved, and the key pair is
how it tells an approval is real. In M0 the keys only exist; signing and checking arrive in M2.

1. The verifier (plain code, no model) checks the cart against the confirmed contract:
   budget, must-haves, return window, merchant, quantity and so on.
2. If every rule passes, the web app signs the purchase details (`SignedFields`: purchase
   number, contract hash, cart hash, merchant, total, budget cap, and an expiry 5 minutes
   ahead) with `VERIFIER_PRIVATE_KEY_B64`.
3. The payments service checks that signature with `VERIFIER_PUBLIC_KEY_B64` before it calls
   Visa. If anything changed after signing, such as the total, an item or the cart, the
   signature fails and the payment is refused.

Why this matters:
- **No model can approve a payment (I1, I2).** Only code holding the private key can sign,
  and no model ever sees it. A prompt-injected model cannot forge an approval.
- **Two processes check the spend cap (I3).** The web app holds only the private key and the
  payments service only the public key, so the payments service can check approvals but never
  create them.
- **Approvals can't be reused.** Each has a unique purchase number (a repeat gets 409) and
  expires after 5 minutes.

Handling rules: the private key lives only in `apps/web/.env.local` (git-ignored, `0600`).
It must never reach the browser, logs or prompts, so it never gets a `NEXT_PUBLIC_` prefix.
The signature itself is never sent to the browser (SPEC §10.2). If the key leaks, delete
both variables and run `pnpm keys` again to make a new pair.

### Tests (`pnpm test`)
- `scripts/gen-keys.test.ts` (3 tests): writes a matching pair that loads and signs/verifies
  as SPEC §10.1 describes; prints no key material; files are `0600`; a second run changes
  nothing; existing lines are kept and an empty placeholder is filled; refuses to write half
  a pair.
- `services/payments/src/server.test.ts` (3 tests): binds to `127.0.0.1`; `/health` returns
  200 `{ ok: true }`; unknown routes return the typed 404; `PORT` parsing defaults to 4100.

### Other files
- `.gitignore` ignores `.env*` **except** `.env.example`, plus `*.db`, `*.db-*` (SQLite WAL
  files), `data/replay/`, `node_modules/`, `.next/`, `next-env.d.ts`, `*.tsbuildinfo`.
- `.env.example` lists every variable in SPEC §19. Values are empty except
  `VISA_ACCEPTANCE_ENVIRONMENT=SANDBOX`, `PORT=4100`, `PAYMENTS_URL=http://127.0.0.1:4100`,
  `STORE_BASE_URL=http://127.0.0.1:3000/api/store`, `DEMO_REPLAY=false`, `TAP_ENABLED=false`.

## Findings about `@visaacceptance/agent-toolkit@0.0.96`

These come from reading the published package source. Two of them differ from SPEC §10.4.

| Topic | SPEC §10.4 says | Actual 0.0.96 behavior | What the code does |
| --- | --- | --- | --- |
| Constructor | Positional `(merchantId, apiKeyId, secretKey, environment, config)` | Confirmed | Uses it as written |
| Tools | Keyed by method name, e.g. `create_payment_link` | Confirmed | Same |
| Errors | `create_payment_link` resolves to `"Failed to create payment link"` | Confirmed: the real error is swallowed, so the cause is not visible | `link:test` exits 1 with that message |
| Environment | `"SANDBOX"` | Sandbox host (`apitest.cybersource.com`) **only** when the value is exactly `"SANDBOX"`; any other value uses **production** (`api.cybersource.com`) | Hard-codes `"SANDBOX"` and also rejects any other `VISA_ACCEPTANCE_ENVIRONMENT` |
| Import side effect | Builds a default toolkit from env vars; "harmless" | **Not harmless:** without credentials it throws `MerchantID is mandatory` at import time | The toolkit is loaded with `require` inside `createLink`, so the server and tests run without credentials |
| Module format | Not mentioned | The ESM build cannot load its `cybersource-rest-client` dependency (dynamic `require` fails) | `services/payments` is `"type": "commonjs"` and loads the CommonJS build |

Answered by the first real `link:test` run: the link URL is `purchaseInformation.paymentLink`
(SPEC §20 item 1). SPEC §20 item 2 was answered in M2: Visa charges only the first line item, so
the link uses one line priced at the full total (see "M2 fix").

## Decisions not stated in the docs

- **TypeScript is pinned to 5.9.3.** The npm "latest" tag is 7.0.2, the new Go-based compiler,
  and its compatibility with Next 16 was not confirmed.
- **`skipLibCheck: true`**, because the Visa toolkit ships type declarations for `ai` 4 and
  `zod` 3.
- **Package names:** shared packages are `@amasa/<name>` (SPEC §10.2 imports
  `@amasa/schemas`). The web app is `web` and the payments service is `payments`, so
  `pnpm --filter payments …` works as `CLAUDE.md` describes.

## M0 result

- `link:test` created a real $1.00 sandbox payment link (`status: "ACTIVE"`). The link URL is in
  **`purchaseInformation.paymentLink`**. The response also has `id` (equal to the purchase
  number) and echoes amounts without trailing zeros (`"1"` for `"1.00"`).
- Getting there took one credential fix: the first key ID / shared secret / merchant ID did not
  belong together (HTTP 401 `Authentication Failed`). Our request signing was confirmed correct
  with Visa's public sandbox merchant `testrest` before the fix.
- Git: `git init` done (branch `main`, remote `origin` = `https://github.com/Thunyatorn/Amasa.git`,
  a private repo). M0 was committed and pushed.

## M1: schemas and verifier

Acceptance checks (docs/BUILD_ORDER.md):

| Check | Result |
| --- | --- |
| Every row of SPEC §9.3 has a test, and all pass | ✅ 19 rows, 19 tests (`packages/verifier/src/verify.test.ts`) |
| The no-model test fails if `import "ai"` is temporarily added to the verifier | ✅ checked: it failed naming `verify.ts`, then passed again once removed |
| Pricing: $129.00 → $139.32; $117.00 → $126.36 | ✅ (`packages/schemas/src/schemas.test.ts`) |

`pnpm test`: 5 test files, 62 tests, all passing. `pnpm typecheck`: clean.

### `packages/schemas` (zod 4.6.7)
- `canon.ts`: `canon()` and `sha256()`, exactly SPEC §2.1.
- Every schema from SPEC §2.2 to §2.14, copied as written, all strict objects, each with a matching
  TypeScript type: `contract.ts`, `store.ts` (StoreListing, ProductPage, Quote), `reader.ts`,
  `options.ts`, `cart.ts`, `payment.ts` (FailureCode, Verdict, SignedFields, PaymentRequest),
  `profile.ts` (ProfileEntry, AutonomyState), `purchase.ts` (Purchase, AuditEntry), `progress.ts`.
- `payment.ts` also has `cartHash()`, the §2.9 formula, hashing only the listed fields.
- `pricing.ts`: the §4.1 rules (`taxCents`, `shippingCents`, `priceLines`), integer cents only.
  It is at `src/pricing.ts` (the spec says `packages/schemas/pricing.ts`) so that it is inside
  `src/` with the rest of the package and inside the folder the §9.4 no-model test scans.

### `packages/verifier` (pure: no network, no model, no clock reads)
- `rules.ts`: one function per §9.2 rule, plus `ruleHolds()` for the must-have operators. These are
  exported so the shopping-run prefilter (§7.4 step 5) can reuse them in M4.
- `verify.ts`: `verify(input)` per §9.1. Collects every failure; `EMPTY_CART` and
  `SKU_NOT_IN_QUOTE` stop evaluation. Money checks use only the quote. The result is checked with
  the `Verdict` schema; failure details are capped at 200 characters.

### Interpretations and decisions
- **`SKU_NOT_IN_QUOTE` also fails when the quote has a line that is not in the cart.** §9.2 only
  names the other direction, but otherwise the quoted total (which gets signed and paid) could
  include items nobody chose. SPEC §9.2 is updated to say so.
- **No-model test patterns:** besides the two §9.4 patterns, it also catches `import "ai"` and
  `import("ai")`. Without that, the M1 acceptance check (`import "ai"`) would not fail.
  SPEC §9.4 is updated.
- **Must-have `includes`:** comma-separated attributes need a whole-item match (so `"0.5"` does
  not match `"10.5"`). Other strings use a case-insensitive substring match, as §9.2 says. A
  numeric rule value is compared as text (`10.5` matches `"10.5"`). Mixed types fail `eq`.
- **`DEADLINE_MISSED`:** the arrival date is the UTC date of `now` + the slowest line's delivery
  days. Arriving on the deadline date passes; one day later fails.
- **Duplicate SKU lines** in a cart or quote are summed per SKU before comparing quantities.
- **Imports between files use `.ts` extensions** (`allowImportingTsExtensions` in
  `tsconfig.base.json`), which Node, Vitest and Next.js all resolve.
- SPEC §2.7 comment typo fixed: `Option.estimate` uses the §4.1 rules (it said §4.4).

## M2: mock store, signed verdict, payments end to end

Acceptance checks (docs/BUILD_ORDER.md):

| Check | Result |
| --- | --- |
| `pnpm e2e:hardcoded` prints a sandbox payment link for $139.32 | ✅ live run 2026-10-17: verdict PASS, total $139.32, purchase `A7WWPD4FCG40M755`, link created, audit chain ok (5 entries) |
| The same signed request to `/pay` twice: the second gets 409 and no Visa call | ✅ `services/payments/src/pay.test.ts` (real handler, real Ed25519 signature, real SQLite, Visa call recorded) |
| Editing one line's `unitCents` makes `/pay` reject it | ✅ same file: `CART_HASH_MISMATCH`, no Visa call |
| A verdict older than 5 minutes is rejected | ✅ same file (`/pay`: `VERDICT_EXPIRED`) and `apps/web/lib/pipeline/stages.test.ts` (`/api/approve`) |
| `GET /api/audit/verify` returns `ok: true`; editing one row makes it return that row's seq | ✅ live: ok → edited row 3 → `brokenAt: 3` → restored → ok |

The signature never leaves the server (SPEC §10.2), so the `/pay` replay checks are proven in tests
rather than by replaying a live request from outside. `pnpm test`: 12 files, 125 tests, all passing.

### What was built
- **`data/products.json`:** 50 hand-written products (20 shoes, 20 groceries, 10 household). The
  four §17.2 products are exact. The other shoes each fail the demo contract for one reason
  (standard width, trail/walking, no size 10.5, 7-day returns, over budget, out of stock), so only
  SHOE-WIDE-01 and SHOE-WIDE-02 pass it, which keeps M4's comparison predictable (covered by a test).
  Groceries have 30-day returns so default contracts (14-day minimum) can buy them. Two items are
  sponsored. Only SHOE-LUX-01's attack review matches the §8.1 scanner patterns.
- **Mock store** (`app/api/store/`): §4.2 search (keyword match on title, brand and attributes,
  category filter, max 12), §4.3 product and page, §4.4 quote (unknown SKU or short stock → 400).
  It imports nothing from the app's `lib/`, and the app reaches it only over HTTP (boundary test).
- **App API:** `GET /api/csrf`, `POST /api/contracts`, `GET /api/contracts/[id]`, `POST /api/carts`,
  `POST /api/verify`, `POST /api/approve`, `GET /api/audit/verify`. Every route except `/api/csrf`
  and the store needs the signed HttpOnly session cookie; POST routes also need `x-csrf-token` to
  match the CSRF cookie. Bodies are strict zod objects; errors are `{ code, message }`.
- **Verify** (§9, §10.2): fresh quote and listings from the store, autonomy read from the database
  (I7), pure `verify()`. Pass → purchase number, `cartHash` from the quote, `SignedFields` (expires
  in 5 minutes) signed with Ed25519, single-use nonce returned; fail → `blocked` row with codes.
- **Approve** (§5, §10): rejects expired verdicts, consumes the nonce atomically, re-reads autonomy,
  sends the signed `PaymentRequest` to the payments service, records `link_created` or
  `payment_failed`.
- **Payments `POST /pay`** (§10.3): the 10 checks in order: loopback only, zod 3 parse, signature,
  expiry, reserve the purchase number (duplicate → 409) before any Visa call, rebuild `cartHash`,
  total = lines + tax + shipping, total ≤ budget cap, daily limit, then Visa. Refuses to start
  without `VERIFIER_PUBLIC_KEY_B64` and `PAYMENTS_MAX_DAILY_CENTS`. Logs only purchase number + result.
- **Audit** (`packages/audit`, §13): IMMEDIATE-transaction appends, `verifyAudit`, `chainHead`, and
  `eraseAuditPayloads` for M5. Payloads hold only ids, hashes, codes and totals.

### Decisions
- **Database additions to SPEC §14** (SPEC updated): `carts.quote_json` (the quote snapshot approve
  needs), `purchases.failure_codes` (§3 says blocked rows record their codes), and a new
  `options(contract_id, json, flagged_json, created_at)` table (M4's shopping run writes options and
  flagged SKUs; verify reads `flaggedSkus` from it). `pnpm e2e:hardcoded` seeds one option row,
  then calls `POST /api/carts { contractId, rank: 1 }` exactly as specified.
- **One copy of the hashing code:** the payments service imports `canon`/`sha256` and `cartHash`
  from zod-free subpaths of `@amasa/schemas` (`/canon`, `/cart-hash`), and keeps its own zod 3 copy
  of the payment schemas, with a parity test against the zod 4 originals.
- **Contracts may only list known stores** (`demo-store`), so a client cannot add a merchant.
- **Env:** `pnpm keys` now also writes `SESSION_SECRET`. `PAYMENTS_MAX_DAILY_CENTS=50000` ($500/day)
  was added to `services/payments/.env`. `STORE_BASE_URL`, `PAYMENTS_URL` and the database paths
  default to localhost values.
- Autonomy demotion and profile updates after a block or outcome are M5, as planned.

### M2 fix: Visa amount (SPEC §20 item 2 answered) and council findings

**What went wrong.** The first live run signed $139.32 but Visa's hosted page asked for $129.00.
Sandbox tests (2026-10-17/18) showed Visa Pay by Link charges **only the first line item's unit
price, once**: it ignores `totalAmount`, quantities and every other line (item + tax line → item
only; two products → first only; quantity 2 → one unit; tax line first → tax only). A single line
priced at the full total is charged correctly.

**Fix.**
- `services/payments/src/visa.ts`: the link has exactly **one line item**, `Amasa order <purchase
  number>`, quantity 1, priced at the full signed total. The itemized cart goes in the line's
  description, filtered to the characters Visa accepts (letters, numbers, spaces and
  `!@#$%?&'(),/_+=.-`; a `;` made Visa reject the request).
- `services/payments/src/pay.ts` step 10: the link is handed out **only if the amount Visa echoes
  equals the signed total**; otherwise the payment is marked `failed` (`AMOUNT_MISMATCH`).
- Live re-run: Visa stored `totalAmount: 139.32` for purchase `L928FHHYZPFXM1Q1`.

**Council review fixes** (a four-model review of M0–M2):
- The web app listened on every network interface (Next's default `0.0.0.0`), so devices on the
  same Wi-Fi could reach it. `pnpm dev`/`start` now bind to `127.0.0.1`; verified that the LAN
  address is refused.
- Audit: a row marked erased must have exactly `{}` as its payload, so the `erased` flag can no
  longer hide an edited payload. The chain still has no outside anchor (the receipts in M5 show
  the head), which is stated in the code.
- Daily limit (`/pay`) also counts requests still waiting on Visa; the weekly cap counts approved
  purchases, and its level-2 check now runs in the same transaction that consumes the nonce.
- Approve builds the payment request before spending the nonce, so a bad stored quote cannot leave
  a purchase stuck in `approved`. The Visa call has its own 60 s timeout, shorter than the web
  client's 90 s, so the web side always gets a definite answer.
- The no-model test now also scans the web app's money path (`lib/pipeline`, `lib/db`, signing,
  store and payments clients, session).
- Smaller: strict zod for the payments error reply, a malformed cookie is treated as missing (not a
  500), the payments log sanitizes the purchase number, README setup lists `PAYMENTS_MAX_DAILY_CENTS`.
- New tests: Visa request mapping and amount parsing, amount mismatch, in-flight daily limit,
  level-2 weekly cap on approve (I7), erased-flag tampering, malformed cookie. `pnpm test`: 13 files,
  136 tests, all passing.

## M3: intake, contract card, profile basics

**Status:** done. All three acceptance checks pass. The two live-model checks were run with
`pnpm check:intake` against local `gemma4` through Ollama (2026-10-18). The Anthropic path is
covered by tests with a mock model but has not been run live yet (no key).

| M3 acceptance check | Result |
| --- | --- |
| "wide running shoes for a half marathon, size 10.5, under $140, must be returnable" → budget 14000, width wide, size 10.5, minReturnDays ≥ 14 | ✅ `pnpm check:intake` with `gemma4`: budget 14000, `width eq wide`, `sizes_available includes "10.5"`, 14 return days |
| A goal with no budget → `budgetCapCents: null` and a question | ✅ Same run: `null` and "What is your budget for these shoes?" |
| Every chip on screen 2 is editable by keyboard; "Looks right" confirms and stores the hash | ✅ Walked through in Chrome with the keyboard only; the stored contract and hash matched |

### How it was built
Codex (`gpt-6.1-sol`) wrote the code in four slices from briefs Claude wrote, and Claude reviewed
each slice. A four-reviewer council run by Codex, then a line-by-line review by Claude with a
browser walk-through, found problems that were fixed afterwards (listed under "Review fixes").

### Intake (screen 1 → `POST /api/intake`)
- `lib/agent/intake.ts` calls Claude through AI SDK v7: `generateText` with
  `Output.object({ schema: ContractDraft })`. The system prompt is SPEC §7.1 word for word (a test
  compares it with the SPEC). The user message is JSON: the goal, today's UTC date, the allowed
  merchants, the confirmed profile entries (category, key, value only) and the store's attribute
  keys per category. Temperature 0, 800 output tokens, 1 retry, 30 s timeout, **no tools**.
- The Anthropic provider moves schema constraints Anthropic doesn't accept into field descriptions
  and the SDK still validates the reply against the full zod schema.
- Code then corrects what the model is not trusted with: the goal is the user's own text, the
  merchants are forced to `demo-store`, an exact shoe size becomes `sizes_available includes "10.5"`
  (the store's key), and any requirement the store can't check (an unknown attribute, or a size
  range such as "10 or larger") goes into a separate `unsupported` list. Those are **never** part of
  the contract, and screen 2 shows every one of them.
- Errors: a model failure answers `502 INTAKE_FAILED` and logs the error class (plus the provider's
  status and message for API errors), never the goal or model output. Missing model settings answer
  `503 MODEL_NOT_CONFIGURED` and log which variables are missing, never their values.
- Limit: 20 intake calls per session per hour (in memory).
- The draft is stored in `contract_drafts` (with `unsupported_json`; older databases get the column
  added automatically) and read back by `GET /api/drafts/[id]`.

### Local model (Ollama)
- `MODEL_PROVIDER=ollama` uses `@ai-sdk/openai` pointed at Ollama's OpenAI-compatible Chat
  Completions endpoint (`.chat()`, since Ollama has no Responses API), no key. CLAUDE.md lists one
  provider package; both are installed so either provider can be chosen.
- Thinking is switched off (`reasoningEffort: "none"`). With thinking on, `qwen3.5:9b` ran for over
  3 minutes and returned nothing, and `gemma4` took 35–45 s; with it off, `gemma4` takes about
  7–10 s and `qwen3.5:9b` about 12–16 s, both valid. The timeout is 90 s for Ollama (loading the
  model on the first call) and 30 s for Anthropic.
- Measured through the app: `POST /api/intake` with "red wide running shoes … under $140" answered
  in 5 s, and "color is red" appeared under "Amasa can't check these at demo-store".
- `:cloud` models in `ollama list` run on Ollama's servers, not on this machine.

### Review screen (screen 2, `/contract/[id]`)
- Typed controls: budget (dollars on screen, integer cents underneath, $0.01–$5,000.00), quantity,
  minimum return days, deadline (not in the past), and for running shoes only, width and size.
- Every other requirement (e.g. "use is road") is an editable field with a Remove button; numbers
  stay numbers.
- "Amasa can't check these at demo-store" lists the unsupported requirements. Each must be removed
  before confirming, and the server refuses a confirm that skips this.
- If intake asked a question, a checkbox "My edits address the question above" must be ticked.
- "Looks right" stays disabled until a budget is set. Focus moves to the heading when the draft
  loads and to the field with the problem on an error.
- `POST /api/contracts { draftId, draft, acknowledgedUnsupported? }`: the contract id is the draft
  id, the draft is consumed in the same transaction (a second confirm gets 409), every rule must be
  on a store attribute for the category, and the hash plus audit `contract_confirmed` are stored.

### Profile and seed
- `GET/POST /api/profile`, `PATCH /api/profile/[id] { value }`, `POST /api/profile/[id]/confirm`,
  `DELETE /api/profile/[id]` (returns `{ ok }`). A user's own edit is always confirmed (SPEC §12).
  Every change appends audit `profile_changed` with ids and keys only.
- `pnpm seed` adds the three SPEC §17.3 profile entries with fixed ids; running it again changes
  nothing.

### Review fixes (after the four slices)
- Requirements the store can't check were dropped silently when the model had already asked a
  question; they are now always listed and must be acknowledged.
- "Other requirements" could only be removed; they are now editable (the acceptance check needs it).
- A size range was narrowed to one exact size; it is now reported as unsupported.
- Width was offered for groceries and household; it is now shoes only, and the server rejects any
  rule the store can't check.
- Server errors had stopped being logged, so a missing key failed silently; logging is back.
- `intake-stage.ts` sat in `lib/pipeline` (a money-path folder) while calling the model through
  `lib/agent`; it moved to `lib/agent`, and the no-model test now also forbids money-path imports
  of `lib/agent`.
- `/api/csrf` issued a new token on every call, so two requests at once could fail; it now reuses
  the session's token.
- Profile edits could stay "suggested"; `PATCH` now takes only `{ value }` and confirms, and
  `DELETE` returns `{ ok }` as SPEC §5 says.

### Tests
`pnpm test`: 19 files, 265 tests (mock models only; nothing in the suite calls a real model).
`pnpm typecheck` is clean.

### Try it
1. Put the model variables in `apps/web/.env.local` (see Setup).
2. `pnpm check:intake`: both goals print PASS.
3. `pnpm dev`, type a goal on screen 1, confirm it on screen 2.

## Notes

- During testing, something else on this machine was already listening on port 3000. If
  `pnpm dev` fails with `EADDRINUSE`, close that program first.
- If `pnpm dev` keeps reloading a page on its own, restart it. Creating and deleting `.ts` files
  under `apps/web` while it runs left it in a reload loop once during M3 testing.
- Next milestone: **M4, shopping run, options and compare**.
