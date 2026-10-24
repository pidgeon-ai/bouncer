# Bouncer

**Forward a cold sales email. Your AI says no for you.**

Forward any cold email to **bouncer@pidgeon.ai**. Bouncer replies to the salesperson on your behalf with a short, polite decline that says it's from an AI assistant. It asks a sequence to stop once, then goes quiet, and it hands anything genuine back to you. There's no sign-up form: your first forward is the sign-up.

It's free and MIT-licensed, and it's small enough to read in an evening. It's built on [Pidgeon](https://pidgeon.ai), the email inbox API for AI agents, so it doubles as an example: **build your own email agent in a weekend.**

## How it works

```
you ──forward──▶ bouncer@pidgeon.ai ──webhook──▶ Bouncer
                                                  │
     first time:  preview to YOU ◀────────────────┤  "Here's what I'd send to Mark (Acme): …"
     you reply YES (must pass DMARC) ─────────────┤  verifies you, picks a style,
                                                  │  creates sam@bouncer.pidgeon.email (own pod)
     after that:  decline ──▶ salesperson ◀───────┘  from your Bouncer address, "Re: <subject>"

salesperson replies ──▶ sam@bouncer.pidgeon.email ──webhook──▶ Bouncer
     "just following up"      → one please-stop, then silence
     a real question          → thread handed to you (Pidgeon hand-off) and forwarded
     out-of-office            → ignored
```

Styles: **1** polite no · **2** not now, try next quarter · **3** ask me first (a one-line summary, then decline on YES). Email the front door `1`, `2` or `3` to switch, or `DELETE` to remove everything.

## The safety rules, and where they live

Every one of these has tests in [`tests/safety.test.ts`](tests/safety.test.ts).

| Rule | Where |
| --- | --- |
| Replies **only** to the sender of the email you forwarded. The recipient isn't a parameter; it's read from the case | [`src/lib/guard.ts`](src/lib/guard.ts) |
| One decline per thread, at most one please-stop. **A unique index in Postgres** enforces it, not only the code | [`src/lib/store/schema.ts`](src/lib/store/schema.ts) |
| Nothing goes to a third party until you've replied from your own address with DMARC passing (or SPF and DKIM both passing, where the domain has no DMARC) | [`src/lib/auth.ts`](src/lib/auth.ts) |
| Ignores auto-forwarded and BCC'd mail, whose From is the salesperson, not you | [`src/lib/bouncer.ts`](src/lib/bouncer.ts) |
| 25 replies per user per day, a global cap, and 3 previews a day to an unverified address | [`src/lib/guard.ts`](src/lib/guard.ts) |
| A stop link and a report link in every footer; a suppression list (stored as hashes) | [`src/lib/links.ts`](src/lib/links.ts), [`src/app/stop`](src/app/stop/page.tsx) |
| Email content is untrusted: replies are **fixed templates**, and the model only sorts and extracts a first name, which is sanitised | [`src/lib/templates.ts`](src/lib/templates.ts), [`src/lib/classify.ts`](src/lib/classify.ts) |
| Pidgeon Firewall says "suspicious" → no automatic action; the user is asked | [`src/lib/bouncer.ts`](src/lib/bouncer.ts) |
| Not cold sales, or can't tell → ask the user | [`src/lib/bouncer.ts`](src/lib/bouncer.ts) |
| Signed webhooks, verified on the raw bytes; redeliveries de-duplicated | [`src/app/api/webhooks/pidgeon/route.ts`](src/app/api/webhooks/pidgeon/route.ts) |
| An `Idempotency-Key` on every send | [`src/lib/guard.ts`](src/lib/guard.ts) |
| Message content deleted after 30 days, in Pidgeon and here | [`src/lib/jobs.ts`](src/lib/jobs.ts) |

## The code

```
src/lib/
  bouncer.ts      the whole flow: one function per thing that can arrive
  guard.ts        the only two ways an email can leave. Keep this file if you fork
  templates.ts    every word Bouncer sends
  classify.ts     the model: one short call, a closed set of answers, a daily budget
  forward.ts      finding the original email inside a forward (inline or .eml)
  auth.ts         is this email really from who it says?
  mail/port.ts    the 9 things Bouncer needs from an email API
  mail/pidgeon.ts …implemented with @pidgeon-ai/sdk
  store/          Postgres, no ORM: the queries are the documentation
  jobs.ts         the weekly tally and the 30-day deletion
src/app/          the one-page site, /stop, /report, /s/[n] share cards, the webhook and crons
tests/            an in-memory Pidgeon double and the tests
```

**The model.** Claude Haiku 5.5 (`anthropic/claude-haiku-5.5`) through the Vercel AI Gateway, routed only to zero-data-retention providers that don't train on prompts. One call per email, input capped at 6,000 characters and output at 200 tokens: about $0.0002–0.0005 an email. `BOUNCER_AI_DAILY_CALL_CAP` (default 5,000) stops spending; past it, every verdict is "unsure" and Bouncer asks the person instead of guessing. Without a gateway key (local dev), timid keyword rules stand in.

## Run it locally

Needs Node 22+ and pnpm.

```bash
pnpm install
```

```bash
cp .env.example .env.local
```

```bash
pnpm dev
```

The site is at http://localhost:3100. With no `DATABASE_URL`, Bouncer uses PGlite (Postgres compiled to WASM) under `.data/`, so there's nothing else to install.

```bash
pnpm test
```

```bash
pnpm demo
```

`pnpm demo` plays the whole journey in-process and prints every email: preview, YES, decline, bump, please-stop, hand-off and the weekly tally.

### Test mode against the real Pidgeon API

A Pidgeon **test key** (`pgn_test_…`) runs everything for real (threads, the Firewall, idempotency, webhooks), but no mail ever leaves Pidgeon. `POST /test/inbound` plays the user and the salesperson.

Test keys can't create pods or addresses, so make a few addresses once with a live key and give them to the test key:

1. With a live key, create the front door and a pool of personal addresses (for example `bouncer-test@yourname.pidgeon.email` and `bouncer-pool-1@yourname.pidgeon.email`).
2. Mint a test key for those addresses: `POST /api-keys` with `{ "name": "Bouncer test", "identity_ids": [...], "test": true }`.
3. Run the smoke test:

```bash
PIDGEON_API_KEY=pgn_test_… BOUNCER_FRONT_DOOR=bouncer-test@yourname.pidgeon.email BOUNCER_PERSONAL_DOMAIN=yourname.pidgeon.email BOUNCER_TEST_ADDRESS_POOL=bouncer-pool-1@yourname.pidgeon.email BOUNCER_TRUST_TEST_AUTH=1 pnpm smoke
```

Test inbound mail carries no SPF, DKIM or DMARC results, so `BOUNCER_TRUST_TEST_AUTH=1` treats test messages as authenticated. It only takes effect with a `pgn_test_` key **and** a message Pidgeon marked `test`, so it can't apply to real mail.

## Deploy your own

1. A Pidgeon workspace and a live key that can create pods and addresses.
2. A domain for personal addresses, connected in Pidgeon (`POST /domains`; publish the records it returns).
3. The front-door address, and a webhook to `https://<your-site>/api/webhooks/pidgeon` for `message.received` on every address (`POST /webhooks`). Keep the secret it shows once.
4. A Postgres database: any will do (Supabase, Neon, RDS). Set `DATABASE_URL`; Bouncer creates its tables on first request.
5. Deploy to Vercel with the variables in [`.env.example`](.env.example). The crons in [`vercel.ts`](vercel.ts) send the weekly tally (Monday 08:00 UTC) and delete old mail (daily).

## Known limits

- **Threading with the salesperson.** The decline goes out as `Re: <their subject>`, but Pidgeon's send API threads by Pidgeon message id, not by an outside `Message-ID`. So even when the forward kept the original `Message-ID`, the decline can't set `In-Reply-To`, and some clients will show it as a new conversation.
- **Forwarded-as-attachment** emails are parsed by Bouncer itself, so the Pidgeon Firewall doesn't screen their content. The reply is a fixed template either way.
- No auto-forwarding: Bouncer only acts on email you deliberately forward to it.

## Licence

The code is MIT. See [LICENSE](LICENSE). The Pidgeon name and logo (`public/brand`, `src/app/icon.svg` and the other icons) are Pidgeon's trademarks and aren't covered by the MIT licence: if you fork Bouncer, swap them for your own. Archivo is under the SIL Open Font License (`src/assets/README.md`).
