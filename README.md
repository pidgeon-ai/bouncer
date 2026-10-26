# Bouncer

**An email agent that declines cold sales email for you. Run it on your own Pidgeon account in about 20 minutes.**

Forward a cold sales email to your Bouncer. It shows you the polite, honest decline it would send, says it's an AI, and sends it when you reply YES. If the sequence keeps going, it asks them once to stop, then goes quiet. If a real person answers with a real question, it hands the thread back to you.

It's a small, readable example of an email agent built on [Pidgeon](https://pidgeon.ai/?utm_source=github&utm_medium=bouncer&utm_campaign=examples), the email inbox API for AI agents. Fork it to build your own: [Build your own email agent](#build-your-own-email-agent) shows which files to change.

```
you ──forward──▶ bouncer-you@pidgeon.email ──webhook──▶ Bouncer
                                                          │
     "Here's what I'd send to Mark (Acme): …" ◀───────────┤  ask first (the default)
     you reply YES (must pass DMARC) ─────────────────────┤
     decline ──▶ Mark ◀───────────────────────────────────┘

Mark replies ──▶ bouncer-you@pidgeon.email ──webhook──▶ Bouncer
     "just following up"   → one please-stop, then silence
     a real question       → thread handed to you (Pidgeon hand-off) and forwarded
     out-of-office         → ignored
```

## Quickstart

You need Node 22+, pnpm, and a Postgres database for production (locally, Bouncer runs Postgres in-process).

### 1. A Pidgeon account and an address for Bouncer

[Sign up for Pidgeon](https://pidgeon.ai/signup?utm_source=github&utm_medium=bouncer&utm_campaign=examples). The free plan is enough: it sends 25 emails a day from `pidgeon.email`, and Bouncer's daily cap is 25.

Give Bouncer an address of its own, separate from your normal one: in the dashboard, add a **New address**. Any free name on `pidgeon.email` works without DNS, for example `bouncer-sam@pidgeon.email`. Give it a display name like `Sam via Bouncer`: that's what salespeople see beside the address.

### 2. A key that can do only what Bouncer needs

In **Developers → API keys → New key**, make a key that reaches **only Bouncer's address**, with access **`send`**. That's the narrowest level that works: Bouncer reads mail, sends and forwards (`send`), hands threads to you and deletes old mail (`draft`), and the webhook in step 4 needs `read`. It never needs `admin`.

To try it with nothing leaving Pidgeon, make it a **test** key (`pgn_test_…`) instead: see [Test mode](#test-mode).

### 3. Run it

```bash
git clone https://github.com/pidgeon-ai/bouncer && cd bouncer
```

```bash
pnpm install
```

```bash
cp .env.example .env.local
```

Fill in `.env.local`: `BOUNCER_ADDRESS`, `BOUNCER_OWNER_EMAIL` (your normal address), `BOUNCER_OWNER_NAME`, `PIDGEON_API_KEY`, and a random `BOUNCER_LINK_SECRET` and `CRON_SECRET` (`openssl rand -base64 32`). Every variable is explained in [`.env.example`](.env.example).

**Locally, with a tunnel** so Pidgeon can reach you:

```bash
pnpm dev
```

```bash
npx cloudflared tunnel --url http://localhost:3100
```

Set `BOUNCER_SITE_URL` to the tunnel's `https://…trycloudflare.com` address: the "never hear from me again" link in every decline points there.

**Or on Vercel:** import the repo, add a Postgres database (any provider; set `DATABASE_URL`), add the same variables with `BOUNCER_SITE_URL` set to your deployment's URL, and deploy. The crons in [`vercel.ts`](vercel.ts) send you a weekly summary and delete mail older than 30 days. On Vercel, the AI Gateway authenticates itself; elsewhere, set `AI_GATEWAY_API_KEY`, or leave it out and Bouncer uses cautious keyword rules and asks you more often.

### 4. Register the webhook

Tell Pidgeon where to send Bouncer's mail. First, the address's `id` (the key reaches only this one address):

```bash
curl https://pidgeon.ai/api/v1/identities -H "Authorization: Bearer $PIDGEON_API_KEY"
```

Then the webhook:

```bash
curl https://pidgeon.ai/api/v1/webhooks -H "Authorization: Bearer $PIDGEON_API_KEY" -H "Content-Type: application/json" -d '{ "url": "https://YOUR-SITE/api/webhooks/pidgeon", "identity_id": "ADDRESS-ID", "event_types": ["message.received"] }'
```

The response includes a `secret`, shown once. Put it in `PIDGEON_WEBHOOK_SECRET` and restart (or redeploy). Bouncer rejects any delivery whose signature doesn't match.

### 5. Forward yourself a cold email

Forward a cold sales email from your inbox to Bouncer's address. Forwarding as an attachment works best (Gmail: ⋮ → Forward as attachment); a normal forward works too.

Bouncer replies **to you**, never to them: who it's from, a one-line summary, and the exact decline it would send. Reply **YES** to send it, **NO** to leave it, or **1** or **2** to send it and stop asking from then on. Email Bouncer just `1`, `2` or `3` at any time to switch:

| Style | What happens |
| --- | --- |
| **3 · ask me first** (default) | You approve every decline |
| **1 · polite no** | Declined straight away |
| **2 · not now, try next quarter** | Declined straight away, with an opening for later |

Even in styles 1 and 2, Bouncer asks first when an email doesn't look like cold sales, or when the Pidgeon Firewall finds text aimed at AI agents.

## Test mode

A Pidgeon **test key** (`pgn_test_…`) runs everything for real (threads, the Firewall, idempotency, webhooks), but no mail leaves Pidgeon. `POST /test/inbound` plays you and the salesperson:

```bash
PIDGEON_API_KEY=pgn_test_… BOUNCER_ADDRESS=bouncer-sam@pidgeon.email pnpm smoke
```

It forwards a cold email, says YES, bumps the sequence twice and checks each step. Test mail carries no SPF, DKIM or DMARC results, so test runs treat messages Pidgeon marked `test` as authenticated. That needs a `pgn_test_` key **and** the `test` mark, so it can't apply to real mail.

No keys at all? `pnpm demo` plays the whole journey in-process and prints every email, and `pnpm test` runs the test suite.

## The safety rules, and where they live

An agent that writes to strangers in your name needs rules it can't talk itself out of. Each has tests in [`tests/safety.test.ts`](tests/safety.test.ts).

| Rule | Where |
| --- | --- |
| Asks first by default: nothing goes to anyone until you reply YES | [`src/lib/config.ts`](src/lib/config.ts) |
| Acts only on mail from you that passes DMARC (or SPF and DKIM both, where your domain has no DMARC). Anyone can type your address into a From line | [`src/lib/auth.ts`](src/lib/auth.ts) |
| Replies **only** to the sender of the email you forwarded. The recipient isn't a parameter; it's read from the stored case | [`src/lib/guard.ts`](src/lib/guard.ts) |
| One decline per thread and at most one please-stop, enforced by **a unique index in Postgres**, not only by code | [`src/lib/store/schema.ts`](src/lib/store/schema.ts) |
| Replies are **fixed templates**. The model only sorts the email and reads a first name, which is sanitised | [`src/lib/templates.ts`](src/lib/templates.ts), [`src/lib/classify.ts`](src/lib/classify.ts) |
| Not cold sales, Firewall says "suspicious", or the model can't tell → asks you | [`src/lib/bouncer.ts`](src/lib/bouncer.ts) |
| Every decline says it's an AI and carries a signed "never hear from me again" link; a suppression list (stored as hashes) | [`src/lib/links.ts`](src/lib/links.ts), [`src/app/stop`](src/app/stop/page.tsx) |
| Ignores auto-forwarded and BCC'd mail, robots and out-of-office replies | [`src/lib/bouncer.ts`](src/lib/bouncer.ts) |
| 25 declines a day, 40 emails a day to you, a daily budget for model calls | [`src/lib/guard.ts`](src/lib/guard.ts) |
| Signed webhooks verified on the raw bytes; redeliveries de-duplicated; an `Idempotency-Key` on every send | [`src/app/api/webhooks/pidgeon/route.ts`](src/app/api/webhooks/pidgeon/route.ts), [`src/lib/guard.ts`](src/lib/guard.ts) |
| Message content deleted after 30 days, in Pidgeon and here | [`src/lib/jobs.ts`](src/lib/jobs.ts) |

### One owner, on purpose

A Bouncer works for one person. An earlier design ([`v0.1.0`](https://github.com/pidgeon-ai/bouncer/tree/v0.1.0)) served many people from one deployment: a sign-up by email, a DMARC-verified reply, a pod and an address per user. It worked, but it was most of the code, and it isn't needed when everyone runs their own. For a team, run one Bouncer per person, each with its own address and key; that keeps every person's sending reputation separate, which is what the pods were for.

## Build your own email agent

Bouncer is three layers. Swap the middle one and you have a different agent.

| Layer | Files | Change it? |
| --- | --- | --- |
| **The safety core** | [`guard.ts`](src/lib/guard.ts) (the only code that sends), [`auth.ts`](src/lib/auth.ts), [`templates.ts`](src/lib/templates.ts) (fixed words) | Keep. Edit the words in `templates.ts`; keep them fixed |
| **The behaviour** | [`bouncer.ts`](src/lib/bouncer.ts) (one function per thing that can arrive), [`classify.ts`](src/lib/classify.ts) (what the model decides) | This is your agent |
| **The mail API** | [`mail/port.ts`](src/lib/mail/port.ts): the six calls Bouncer needs; [`mail/pidgeon.ts`](src/lib/mail/pidgeon.ts) implements them with [`@pidgeon-ai/sdk`](https://www.npmjs.com/package/@pidgeon-ai/sdk) | Keep. Tests swap in a fake |

Some agents that are a weekend from here: an out-of-office that answers only real people, a support triager that hands anything angry to a person, a recruiter-reply bot, an invoice catcher that files PDFs. For each, change what `classify.ts` asks the model and what `bouncer.ts` does with the answer, write the replies as templates, and keep sending through `guard.ts`.

**The model.** Claude Haiku 5.5 (`anthropic/claude-haiku-5.5`) through the Vercel AI Gateway, routed only to zero-data-retention providers that don't train on prompts. One short call per email: input capped at 6,000 characters, output at 200 tokens, roughly $0.0002–0.0005 an email. `BOUNCER_AI_DAILY_CALL_CAP` stops spending; past it, every verdict is "unsure" and Bouncer asks you.

## Known limits

- **Threading with the salesperson.** The decline goes out as `Re: <their subject>`, but Pidgeon threads sends by Pidgeon message id, not by an outside `Message-ID`. So the decline can't set `In-Reply-To`, and some clients will show it as a new conversation.
- **Forwarded-as-attachment** emails are parsed by Bouncer itself, so the Pidgeon Firewall doesn't screen their content. The reply is a fixed template either way.
- No auto-forwarding: Bouncer only acts on email you deliberately forward to it.

## Licence

MIT. See [LICENSE](LICENSE). Changes: [CHANGELOG.md](CHANGELOG.md).
