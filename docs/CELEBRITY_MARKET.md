# Celebrity virtual market

## Architecture and preserved investigation findings

This is an additive simulation in VU (virtual units). Phase 1 has no trades,
portfolios, payment integration, retrieval adapter, frontend, or AI calls.
The existing shopping agent and its Visa boundary remain separate.

The read-only investigation covered CLAUDE.md, apps/web/AGENTS.md, SPEC and
BUILD_ORDER, 163 authored source/test files (34 Vitest files and one Python test
module), 25 API route modules, frontend/screens, library modules, all four shared
packages, payments, evaluation/background scripts, and celebrity metadata/tooling.
Dependencies, caches, generated artifacts, secrets, archives and binary images
were excluded from substantive review. No `.env*` files were opened.

Existing architecture:

- `apps/web`: Next 16.4.2 App Router, React 19, strict TypeScript, AI SDK 7.0.143.
  Screens: `/`, `/contract/[id]`, `/shop/[contractId]`,
  `/receipt/[purchaseNumber]`, `/settings`; approval/blocked states live in shop.
- Existing API groups: CSRF/session, intake/drafts, contracts/read/edit, shopping
  SSE, carts/verify/approve, outcomes/receipt, profile CRUD/confirm, autonomy,
  notices/dismissal, audit/verify and deletion. The four mock-store endpoints
  remain an external HTTP boundary even though they run in the same app.
- `packages/schemas`: strict Zod schemas, canon/sha256, shopping cents/pricing.
  `packages/verifier`: pure deterministic rules. `packages/reader`: quarantined
  tool-free model extraction and injection detection. `packages/audit`: append-only
  hash-chained history with audited personal-payload erasure.
- `services/payments`: separate CommonJS process and database; the only Visa
  caller. Toolkit 0.0.96 uses its isolated older AI/Zod dependencies. No market
  module imports it or changes the existing schemas/pricing/payment code.
- `lib/agent/intake.ts`: existing `buildModel`, `modelsFromEnv`, `modelFromEnv`.
  `lib/env.ts`: lazy Anthropic/Ollama configuration; MODEL_READER falls back to
  MODEL_PLANNER. Ollama uses OpenAI-compatible `.chat()` with thinking disabled
  and a longer timeout. Historical docs mention qwen3.5:9b and gemma4; active
  settings were not inspected. Local `/api/tags` was unreachable during review.
- `lib/http.ts`: typed errors and strict input parsing. `lib/session.ts`: signed
  HttpOnly SameSite Strict demo cookie and double-submit CSRF. Existing storage
  represents one shared demo user, not multi-user account isolation.
- `lib/db/index.ts`: existing better-sqlite3 WAL connection, 5-second busy timeout,
  per-process connection cache, idempotent shopping schema additions. Existing
  tables: contract_drafts, contracts, carts, purchases, options, profile_entries,
  autonomy, notices, audit. Payments has a separate payments table. Before phase 1
  there were no market models or durable job infrastructure.
- `lib/shop/sse.ts`, `lib/ui/sse.ts`, `lib/ui/shop-state.ts` demonstrate validated
  streaming, cancellation and pure reducers; no durable replay/cross-process bus.
  `notice-banner.tsx` refreshes via navigation and `amasa:changed`.
- `app/globals.css`: light monochrome, local JetBrains Mono, CSS variables,
  cards/tables, responsive layout, visible focus and reduced-motion treatment.
  No charting library is necessary for a first frontend. Scope future market CSS.
- Python tooling uses bounded streaming reservoir sampling and strict asset
  validation. CSV has 997 labels/names/files, 18,184 source image counts, no
  biographies/financials. Dwayne Johnson and Dwayne "The Rock" Johnson are
  separate labels: labels are not canonical entities. Assets are outside public.
- Tests cover strict boundaries, mock models, pricing, signed verdicts, nonce
  consumption, autonomy, audit and UI. Live e2e/redteam scripts can create Visa
  sandbox links and are not market test harnesses. Replay/TAP are stretch work.

Preserve I1–I7: no model moves money; confirmed contracts/signatures/caps remain
authoritative; external text remains data; audit stays tamper-evident; no card
data; autonomy is read server-side. Market VU never enters USD/payment schemas.
The existing no-model/import guard remains enabled. Existing uncommitted
UI/fonts/logo/Python work must be preserved.

Relevant installed documentation for later implementation:

- `apps/web/node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
- `apps/web/node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`
- `apps/web/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`
- `apps/web/node_modules/ai/docs/03-ai-sdk-core/10-generating-structured-data.mdx`
- `apps/web/node_modules/ai/docs/03-ai-sdk-core/55-testing.mdx`
- `apps/web/node_modules/ai/docs/07-reference/01-ai-sdk-core/01-generate-text.mdx`
- `apps/web/node_modules/@ai-sdk/openai/docs/03-openai.mdx`
- `apps/web/node_modules/@ai-sdk/anthropic/docs/05-anthropic.mdx`

`after()` is response-following work bounded by route duration, not a durable
scheduler. Phase 1 makes no Next/AI API calls and requires no new secrets.

## Exact mathematical contract

For the n valid actual signals present at processing time:

    S = sum(A_i * W_i) / n
    P_new = P_previous * (1 + sigma * tanh(S))

When n=0, S=0 and price is unchanged, but the independently scheduled event is
still committed to history and receives a new due time. Missing values are omitted,
not replaced by zero. A is finite in [-1,1]; W is finite in [-1,1]. Sigma is
strictly between 0 and 1, default 0.0002. Initial price is exactly 100 VU.
There is no log-price or reversion term.

Prices are integer micros: 1 VU = 1,000,000 micros. The formula operates on the
previous integer micros in JS double precision, then uses Math.round exactly once
to the nearest micro (positive ties round upward). Each tick compounds from that
rounded previous result. History `pct` is the pre-round fractional change, not a
percent multiplied by 100. `formatVU` returns a six-decimal string; no USD formatter.

Reject nonfinite, nonpositive, unsafe-integer and out-of-circuit results. The
default circuit is [1 VU, 1,000,000 VU], inclusive, independently configurable via
validated config. A circuit failure retains price, pauses the entity/job, clears
next_tick and records last_error. It is never silently clamped. An operator must
investigate and explicitly restore a paused schedule; restart/seed does not reset it.
Finite normalization saturation at [-1,1] is a separate, documented transform.

With these input bounds, |S|<=1 and per-event movement is at most
sigma*tanh(1), approximately 0.015232% at the default sigma. Ignoring micro-rounding
and circuit stops, the same-direction compounding envelope at the shortest 75s
interval is:

| Horizon | Maximum ticks | All-positive | All-negative |
| --- | ---: | ---: | ---: |
| Hour | 48 | +0.733754% | -0.728519% |
| Day | 1,152 | +19.179185% | -16.094973% |
| Week | 8,064 | +241.509571% | -70.723722% |

These are deliberately extreme path envelopes, not expected volatility. Sigma alone
gives a looser +0.964526%, +25.907455%, +401.602979% positive envelope respectively.
Rounding can matter at tiny prices. Expected volatility depends on signal counts,
correlation and refresh activity; no claim of calibrated real-world valuation is made.

## Signals and randomness

`features.ts` is the inspectable whitelist and normalization version 1:

- followers, public_mentions, earnings, net_worth: bounded
  `(log1p(new)-log1p(old))/log(2)` changes.
- awards, career_events: bounded signed `log1p(abs(increment))/log(11)`.
- Age, nationality and birthplace are excluded. Dataset image count is excluded.
- First observations establish baselines and produce no signal. Wealth/earnings
  require matching datatypes and currencies across observations. There is no
  implicit FX conversion; phase 2 must provide a separately sourced derived series
  if explicit FX is supported. Financial assets retain currency, amount, confidence,
  effective date, retrieval time, source URL and reported/estimated/etc. status.
- Changes decay linearly to zero over 60 minutes by default. Today's date-only
  changes start at observation time; older effective dates use that date's UTC
  midnight so stale facts cannot be made fresh by fetching. Future dates are refused.
  A later unchanged fetch never renews changedAt/expiresAt or a value version.
- Attributes/asset value changes create immutable snapshots; fetch-only validator
  and retrieval updates do not create attribute changes or price events.

Backend seed is randomly generated on first import and persisted. Context-derived
integer RNG streams independently sample every entity/event interval and feature
weight. Weights use symmetric discrete support [-1,1], with theoretical mean zero.
Retries of an event reproduce its intended weights. This controls stochastic
movement without permanent upward pressure from high follower counts/wealth.
Unknown/all-missing entities honestly remain flat at 100 VU. Different seeds give
different simulations; RNG version is recorded. No client randomness is used.

## Persistence and independent worker

`lib/market/db.ts` reuses getDb/openDb and adds `migrateMarket`. The versioned
market_migrations ledger and all market_* tables live in data/amasa.db. Migrations
are immediate, idempotent transactions. FK enforcement is enabled per market
connection; declared market FKs and price/status/lease constraints are checked.

Tables cover celebrities/identity, config snapshots and seed, source cache with
validators/checkedAt/payload hashes, immutable evidence with original source payload,
current attributes/assets, immutable value changes/snapshots, normalized features,
actual current per-feature weights, immutable price history, durable jobs, worker
heartbeats and per-host rate state. History has unique event ID and entity/version,
scheduled and processed timestamps, prev/new micros, S/sigma/pct, complete feature,
weight and config snapshots, config hash and snapshot hash. Hashes use canon/sha256
from @amasa/schemas. SQL triggers prevent history/config/evidence/snapshot/change
updates/deletes. Hashes detect accidental inconsistency, not a malicious DB owner
rebuilding the database; there is no external market audit anchor yet.

Import validates all 997 CSV labels and filenames without opening JPEGs, supports
quoted commas/quotes/newlines, creates one initial row per label and two jobs, and
never resets prices, versions, seed, schedules or existing identities on reimport.
Canonical QID is unique when present. assignQid marks conflicts needs_review and
links the conflicting label to the current owner instead of assigning duplicates.
This is a review relationship, not an automatic merge; aliases must be resolved
before phase 2 treats two labels as one pricing entity.

MarketScheduler wakes once per second in a separate persistent CLI process. It
does not depend on browsers, routes, sessions or 997 timers. Price claims and
enrichment claims use separate bounded pools (100 prices/wake, 4 enrichments by
default). Claims take short immediate transactions. Network/model promises execute
outside transactions; bounded timeout/abort and lease-token checks fence commits.
Unexpected commit failures leave leases recoverable.

Expired running jobs recover in bounded indexed batches. Tokens, expiry, entity
version compare-and-swap, unique event IDs and a one-live-job-per-entity/kind index
prevent double application across processes. A price commit atomically updates
price/history/weights, completes its job and inserts the next job. Each next interval
is independently sampled in inclusive [75,150] seconds after actual processing;
there is one overdue event per entity after downtime, not a catch-up storm. Config
cannot lower/raise the allowed interval beyond those limits.

The injected async EnrichmentHandler receives celebrityId, jobId and AbortSignal
and returns strict EnrichmentResult. A missing adapter records deferred/retry
ENRICHMENT_ADAPTER_UNAVAILABLE, with no successful refresh timestamp. Failed adapters
back off; price events continue. A late timed-out/stale response cannot commit.
SIGTERM/SIGINT stops the CLI wakeup, aborts enrichment, settles the pool, records a
stopped heartbeat, and closes the connection. Phase 2 adapters must honor aborts.

SQLite WAL supports several processes sharing a local file on one host; it is not
a multi-host horizontally distributed scheduler. Multi-host deployment requires a
shared transactional database/coordination design. Keep transactions small to avoid
blocking shopping writes. Existing DELETE /api/me enumerates shopping personal
tables; future personal market data needs explicit deletion semantics. Public
market history presently has no personal accounts or portfolio data.

## Commands, phase 2 interfaces and validation

- `pnpm market:seed`: explicitly import real CSV/assets into the configured/default
  app DB. Phase 1 development/tests do not invoke this against the actual database.
- `pnpm market:worker`: run the independent worker; no phase 2 adapter is installed.
- `pnpm market:simulate`: run a standalone synthetic simulation with no database,
  network, model calls, secrets, waiting or wall-clock advancement.

Commands use the installed `node --import tsx` loader without tsx CLI IPC listeners.
DATABASE_PATH may be supplied by the process. No config/session/Visa secret is
required for seed or math; these scripts do not read env files.

Phase 2 can use browser-safe schemas.ts, getMarketDb/openMarketDb, celebrity,
marketState/setMarketConfig, storedFeatures, assignQid, reserveHost, and transactional
saveEnrichment. Inject retrieval/extraction via MarketScheduler.enrichmentHandler.
Sources/evidence must pass provenance/hash validation. Reuse existing model factories
after reading installed provider/AI docs; keep model imports outside lib/db and
money-path modules. Add typed market API reads and durable history sequence/snapshot
recovery for live frontend updates in later phases.

Tests use temporary SQLite files/memory only. Coverage includes reference formula
vectors, missing/finite/range checks, rounding, polarity, bounds and compounding,
deterministic RNG and independent intervals, normalization/currency/demographic
exclusion, migrations/import idempotency, unique QIDs, immutable provenance,
two connections and two independent Node processes, lease recovery/fencing,
replay/config changes, restart, hourly scheduling, and slow/missing/error/late
enrichment. A three-day 997-entity heap simulation reuses production math, weights
and interval functions; only a small subset persists full history for replay tests.

Measured standalone fixture (seed market-simulation-v1): 2,296,416 events over
three simulated days, min 99.471420 VU, max 100.533283 VU, runtime 3,269 ms on the
development machine. These synthetic changes exist only inside the simulation;
they are never imported as real celebrity attributes. Runtime varies by machine.
