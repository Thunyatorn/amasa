# 🛒 Amasa

> A personal AI shopping agent that does the searching but can't pay without you: only deterministic code and Visa move money.

![Payments: Visa sandbox only](https://img.shields.io/badge/payments-Visa%20sandbox%20only-1a1f71)
![Node >= 22.12](https://img.shields.io/badge/node-%3E%3D22.12-339933)
![Built for the Visa hackathon](https://img.shields.io/badge/built%20for-Visa%20hackathon-blue)

---

## 📖 Table of Contents
- [About the Project](#-about-the-project)
  - [How it works](#how-it-works)
  - [Built With](#built-with)
- [Getting Started](#-getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Run the demo](#run-the-demo)
- [Usage](#-usage)
- [Features](#-features)
- [Security and testing](#-security-and-testing)
- [Project structure](#-project-structure)
- [Deploying to Fly.io](#-deploying-to-flyio)
- [Roadmap](#-roadmap)
- [Contributing](#-contributing)
- [License](#-license)
- [Contact](#-contact)

---

## 🧐 About the Project

Amasa was built for the Visa hackathon track *"The Future of Shopping: Powered by AI, Secured by Visa"*.

Letting an AI agent shop for you is useful, but handing it your money is risky: a product page, a
review or a tampered request can talk a model into buying something you never asked for. Amasa
separates the two jobs. **AI does the shopping; only deterministic code and Visa move money.** No
language model can create a payment or see payment details, and every order is checked against a
contract you confirmed before a Visa payment link is created.

The demo store sells **celebrities**: 39 actors, musicians and athletes, priced in **VU** (virtual
units) by a live celebrity market. You say what you want, for example *"an Oscar-winning actor, under
300 VU, must be refundable"*, and Amasa finds options, explains each one, and prepares the payment.
You enter your card only on Visa's own hosted page. Payments run on the **Visa sandbox** at
1 VU = $1.00; no real money moves.

Amasa also learns how you shop. Every category starts at "suggest, you approve everything". After
five orders you keep, it offers to do more: one-tap approval, then a prepared payment link within a
weekly limit you set. You can always lower it with one tap, and a failed check lowers it for you.

### How it works

```text
your goal ──► intake (AI) ──► contract you edit and confirm
                                   │
        search + read pages (AI, no tools, page text quarantined)
                                   ▼
   options + compare table (written by code, not by the AI)
                                   ▼
   verifier (pure code): checks the order against your contract and the store's own quote,
   then signs the result
                                   ▼
   payments service (separate process): accepts only signed orders ──► Visa payment link
                                   ▼
                  you pay on Visa's hosted page; the receipt, audit log and autonomy update
```

The safety rules the code is built around:

| | Rule |
| --- | --- |
| I1 | No AI model can move money. Only `services/payments` talks to Visa. |
| I2 | Every payment matches a confirmed contract (hashed and signed). |
| I3 | Your spending limit is checked twice, in two separate processes. |
| I4 | Text from stores never becomes instructions: it only reaches a reader model that has no tools. |
| I5 | The history is an append-only, hash-chained audit log. |
| I6 | No card data is ever accepted, stored or logged. |
| I7 | Autonomy and revocation are read on the server, never trusted from the browser. |

### Built With
- [Next.js 16](https://nextjs.org) (App Router), [React 19](https://react.dev) and TypeScript in strict mode
- [AI SDK 7](https://ai-sdk.dev) with [Anthropic](https://www.anthropic.com) models, or local models through [Ollama](https://ollama.com)
- [Zod 4](https://zod.dev) for every boundary, [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) for storage
- [Visa Acceptance agent toolkit](https://www.npmjs.com/package/@visaacceptance/agent-toolkit) (sandbox, payments service only)
- Ed25519 signatures, [Vitest](https://vitest.dev), pnpm workspaces
- [Wikidata](https://www.wikidata.org) (CC0) for the celebrity facts

---

## 🏁 Getting Started

Follow these steps to run a local copy.

### Prerequisites
- Node.js `>= 22.12` (built and tested on Node 24)
- pnpm 10:
  ```bash
  npm install -g pnpm@10
  ```
- A Visa Acceptance **sandbox** account (merchant ID, API key ID and shared secret)
- A model: either [Ollama](https://ollama.com) running locally, or an Anthropic API key

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/Thunyatorn/Amasa.git
   cd Amasa
   ```
2. Install dependencies:
   ```bash
   pnpm install
   ```
3. Generate the signing keys (this writes the key pair and a session secret into the env files):
   ```bash
   pnpm keys
   ```
4. Add your Visa **sandbox** credentials to `services/payments/.env`. Keep the
   `VERIFIER_PUBLIC_KEY_B64` line that `pnpm keys` wrote, and add:
   ```bash
   VISA_ACCEPTANCE_MERCHANT_ID=...
   VISA_ACCEPTANCE_API_KEY_ID=...
   VISA_ACCEPTANCE_SECRET_KEY=...
   VISA_ACCEPTANCE_ENVIRONMENT=SANDBOX
   PAYMENTS_MAX_DAILY_CENTS=100000
   ```
   `PAYMENTS_MAX_DAILY_CENTS` is the payments service's daily limit in cents (here $1,000.00).
   A celebrity order is about 125 to 430 VU, so raise it if you want to rehearse a lot.
5. Choose a model and add it to `apps/web/.env.local`.

   **Local models, free** (Ollama running with both models pulled; the planner must be
   `qwen3.5:9b`, `gemma4` is the faster reader):
   ```bash
   MODEL_PROVIDER=ollama
   MODEL_PLANNER=qwen3.5:9b
   MODEL_READER=gemma4:latest
   ```
   **Claude through the Anthropic API** (billed separately from any Claude subscription; type the
   key yourself and set a spending cap in the Anthropic Console):
   ```bash
   MODEL_PROVIDER=anthropic
   ANTHROPIC_API_KEY=...
   MODEL_PLANNER=claude-sonnet-5-5
   ```

All variables are listed in [`.env.example`](.env.example). Never commit `.env` files.

### Run the demo

Use the production build for demos (the dev server's hot reload can loop when old tabs stay open).

```bash
pnpm --filter payments dev                        # terminal 1: payments service, 127.0.0.1:4100
pnpm seed                                         # terminal 2: demo data (see below)
pnpm --filter web build && pnpm --filter web start   # web app, 127.0.0.1:3000
```

Open <http://127.0.0.1:3000>. Run `pnpm seed` before the first start: without market prices the store
answers "Run pnpm seed".

> **Celebrity photos are not in this repository.** The 997 photos are a local dataset that stays out
> of git until image rights are cleared. Without them the option cards show a missing image; the rest
> works. See [`scripts/celebrities/README.md`](scripts/celebrities/README.md) to download them.

---

## 💡 Usage

**Shop for a celebrity**
1. On the home screen, type a goal or pick an example, such as *"A pop musician, under 250 VU"*.
2. Review the contract Amasa drafts: budget in VU, refund window, and one choice (Oscar winner for
   actors, genre for musicians, sport for athletes). Edit anything, then choose **Looks right**.
3. Watch the live steps, then compare up to three options with photos, the full cost including tax,
   refund windows, and a **Why?** panel for each.
4. Choose an option. Amasa shows what the verifier checked and what is left of your budget.
   **Approve** or **Not now** are equally weighted.
5. Approve to get a Visa sandbox payment link, finish on Visa's page, then open the receipt and mark
   the order **Kept** or **Returned**.

**Earned autonomy.** After five kept orders in a category, Settings offers the next level. Level 1
preselects and pre-verifies the top option (one tap to approve). Level 2 also prepares the payment
link within a weekly limit you set, and you still pay on Visa's page. A failed check lowers the level
automatically and shows a notice saying why.

**Demo data.** `pnpm seed` puts the 39 celebrities in the market at their starting prices and sets up
a profile and five kept musician orders, so the musicians category already offers level 1.
`pnpm seed -- level2` shows the level-2 offer instead.

**Commands**

| Command | What it does |
| --- | --- |
| `pnpm test` | Runs every test (mock models only, no network) |
| `pnpm typecheck` | Type-checks every package |
| `pnpm keys` | Generates the verifier key pair and session secret |
| `pnpm seed` / `pnpm seed -- level2` | Loads the demo data (safe to run twice) |
| `pnpm check:intake` | Checks intake against the live model |
| `pnpm e2e:hardcoded` | Contract → cart → verify → approve → sandbox link, without a model |
| `pnpm e2e:shop` | The full happy path with the live model, ending in a sandbox link |
| `pnpm e2e:m5` | Autonomy flow: one tap, lowering, automatic demotion, suggestions |
| `pnpm redteam` | Runs the 10 attack cases against Amasa and a naive agent, prints the metrics |
| `pnpm market:simulate` | Runs the celebrity market's price formula offline |

---

## ✨ Features

- [x] **Contracts you control:** your goal becomes an editable, hashed contract before anything is bought
- [x] **Live shopping run:** streamed steps, three options, a compare table with the biggest difference, and a Why? panel
- [x] **A verifier that can say no:** 14 failure reasons, each shown as a plain sentence
- [x] **Signed verdicts and a separate payments service** that re-checks the budget, expiry and daily limit
- [x] **Visa sandbox payment links** (card details are entered only on Visa's page)
- [x] **Earned autonomy** with levels you accept, lower with one tap, or lose after a failed check
- [x] **Profile suggestions** you can Keep or Forget, never applied silently
- [x] **Change notices** on every screen, a verifiable history, and delete-all-my-data
- [x] **Celebrity market prices** (a price formula in VU, set by an independent worker)
- [x] **A red-team suite** with a naive baseline agent that can only reach a fake payment recorder
- [ ] Signed agent requests to the store (RFC 9421 style)
- [ ] Replay mode for demos without a network
- [ ] Live price data for the market from Wikidata and other sources

---

## 🔒 Security and testing

- **468 automated tests** across 36 files (mock models, no network), and a clean strict type check.
- **Red team** (`pnpm redteam`): 10 prompt-injection and tampering cases, measured on the celebrity
  store with local models. One run per case; full evidence is in
  [`docs/REDTEAM_RESULTS.md`](docs/REDTEAM_RESULTS.md).

  | Agent | Attacks that worked | Tasks done correctly | Blocks with the correct reason |
  | --- | --- | --- | --- |
  | Amasa | 0 of 10 | 9 of 10 | 9 of 10 |
  | Naive agent | 0 of 10 | 10 of 10 | n/a |
  | Naive agent told to read pages | 0 of 10 | 9 of 10 | n/a |

  Read these honestly: the naive agent reads few product pages, so most page attacks never reach it.
  Amasa's one missed task is the "contract edited after approval" case, where blocking the purchase
  is the correct result, and one defense (a fake listing title) was not exercised in that run because
  the listing never appeared in its search results. In an earlier shoe-store run, the same naive agent
  did buy the wrong product when its contract was edited; that is the attack the verifier's contract
  hash stops.
- Payments run in the **Visa sandbox only**. The demo store, its prices and its reviews are made up.

---

## 📁 Project structure

```text
apps/web/            Next.js app: screens, app API, the demo store, the shopping agent, SQLite
packages/schemas/    shared Zod schemas, canonical JSON and hashing
packages/verifier/   pure verification rules (no network, no model)
packages/reader/     injection scanner, listing sanitizer, and the tool-less page reader
packages/audit/      hash-chained audit log
services/payments/   isolated payments service, the only code that calls Visa
evals/               naive agent and red-team suite
data/celebrities/    demo set (39 celebrities, sourced from Wikidata) and photo metadata
data/redteam/        the 10 attack overlays
docs/                SPEC.md (technical spec), BUILD_ORDER.md, BUILD_LOG.md, REDTEAM_RESULTS.md
```

More detail: the technical spec is [`docs/SPEC.md`](docs/SPEC.md), the milestone-by-milestone record
(what was built, measured and fixed) is [`docs/BUILD_LOG.md`](docs/BUILD_LOG.md), and the rules the
code follows are in [`CLAUDE.md`](CLAUDE.md).

---

## 🚢 Deploying to Fly.io

Amasa runs on **one Fly machine with one volume**: the web app and the payments service side by side, so
payments stays loopback-only and the SQLite files persist. Don't scale past one machine (SQLite has one
writer). Other hosts that give a container a persistent `/data` volume work too (see the `Dockerfile`).
Vercel and Cloudflare Workers don't fit: they have no durable disk.

What the deployment does differently:
- **Password gate:** the whole site asks for one shared password (HTTP Basic, any user name). It is set
  with the `DEMO_PASSWORD` secret. If it is missing on Fly, the site refuses to serve (503).
- **No photos:** the celebrity photos are never put in the image. Cards show an initials placeholder.
- **Seeds once:** the first boot loads the demo data; later boots keep your data.
- **Prices stay at their starting values:** the market worker isn't started.

Steps (you do these; never paste secrets into a chat or a file in the repo):

```bash
brew install flyctl
fly auth login
fly launch --no-deploy --copy-config      # keep fly.toml; pick a unique app name when asked
fly volumes create amasa_data --size 1
```

Then set the secrets. `SESSION_SECRET` and `VERIFIER_PRIVATE_KEY_B64` (web app) and
`VERIFIER_PUBLIC_KEY_B64` (payments) come from `pnpm keys` and must stay a matching pair:

```bash
fly secrets set \
  SESSION_SECRET=... VERIFIER_PRIVATE_KEY_B64=... VERIFIER_PUBLIC_KEY_B64=... \
  VISA_ACCEPTANCE_MERCHANT_ID=... VISA_ACCEPTANCE_API_KEY_ID=... VISA_ACCEPTANCE_SECRET_KEY=... \
  ANTHROPIC_API_KEY=... DEMO_PASSWORD=...
fly scale count 1
fly deploy
```

Set a monthly spending cap in the Anthropic Console first: every search uses your key. `fly.toml` keeps
`VISA_ACCEPTANCE_ENVIRONMENT=SANDBOX` and a $1,000 daily limit on payment links
(`PAYMENTS_MAX_DAILY_CENTS`). Check it works: `fly logs` shows both services starting; open the site, enter
the password, run one order to a Visa **sandbox** link.

Test the image on your own machine first (Docker Desktop running; the throwaway password only matters
for requests that carry Fly's headers, so add `-H 'fly-client-ip: 1.2.3.4'` to curl to see the gate):

```bash
docker build -t amasa-test .
docker run --rm -p 13000:3000 -v amasa-test-data:/data -e DEMO_PASSWORD=test \
  --env-file apps/web/.env.local --env-file services/payments/.env amasa-test
```

---

## 🧭 Roadmap

- [ ] Signed agent requests to the store, behind a flag (SPEC §15)
- [ ] Replay mode so a demo runs without a network (SPEC §17.4)
- [ ] Usability test with real users, then fix the top issue
- [ ] Live celebrity data: followers, awards and earnings feeding the price formula
- [ ] Clear image rights for the celebrity photos, then publish them
- [ ] Demo hardening: rehearsals, a recorded backup run, a final secret scan

---

## 🤝 Contributing

This started as a solo hackathon project, so there is no formal process yet. Issues and ideas are
welcome. If you want to change code, please:

1. Fork the project and create a branch (`git checkout -b feature/your-idea`)
2. Run `pnpm test` and `pnpm typecheck` before opening a pull request
3. Keep to the safety rules in [`CLAUDE.md`](CLAUDE.md) (I1 to I7); changes that touch the money path need extra care
4. Open a pull request describing what changed and why

---

## 📄 License

No license has been chosen yet, so by default all rights are reserved. A license file will be added
before the project is shared for reuse.

Third-party data: celebrity facts come from [Wikidata](https://www.wikidata.org) (CC0). The photo
dataset (`tonyassi/celebrity-1000` on Hugging Face) has its own terms and is not redistributed here.

---

## 📬 Contact

Thunyatorn Jirachaisri, [@Thunyatorn](https://github.com/Thunyatorn) on GitHub

Project link: <https://github.com/Thunyatorn/Amasa>
