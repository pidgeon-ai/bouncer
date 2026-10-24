import { AtMark, Lockup, Plate } from "@/components/brand";
import { declineText, stopText } from "@/lib/templates";

const FRONT_DOOR = process.env.BOUNCER_FRONT_DOOR ?? "bouncer@pidgeon.ai";
const REPO = "https://github.com/pidgeon-ai/bouncer";

export function SiteHeader() {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-5 sm:px-8">
        <Lockup />
        <nav className="flex items-center gap-5 text-sm text-muted-foreground">
          <a href={REPO} className="hover:text-foreground">
            GitHub
          </a>
          <a href="https://pidgeon.ai" className="hidden hover:text-foreground sm:inline">
            pidgeon.ai
          </a>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-border">
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-12 text-sm text-muted-foreground sm:px-8">
        <AtMark className="h-[30px] w-[30px] opacity-80" />
        <p className="max-w-md text-base">
          Bouncer is a free, open-source tool from{" "}
          <a href="https://pidgeon.ai" className="text-foreground underline">
            Pidgeon
          </a>
          , the email inbox API for AI agents. Hosted in the EU.
        </p>
        <p>
          Got an email from Bouncer you didn&apos;t want? Use the link at the bottom of it, or write to{" "}
          <a href="mailto:abuse@pidgeon.ai" className="underline">
            abuse@pidgeon.ai
          </a>
          .
        </p>
        <nav className="flex flex-wrap gap-x-5 gap-y-2">
          <a href={REPO} className="hover:text-foreground">
            GitHub
          </a>
          <a href="https://pidgeon.ai/docs" className="hover:text-foreground">
            Pidgeon docs
          </a>
          <a href="https://pidgeon.ai/legal/privacy" className="hover:text-foreground">
            Privacy
          </a>
          <a href="https://pidgeon.ai/legal/notice" className="hover:text-foreground">
            Imprint
          </a>
        </nav>
      </div>
    </footer>
  );
}

function Section({ id, eyebrow, title, children }: { id?: string; eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="border-t border-border py-12 sm:py-16">
      <p className="eyebrow text-muted-foreground">{eyebrow}</p>
      <h2 className="headline mt-3 text-4xl sm:text-5xl">{title}</h2>
      <div className="mt-8 space-y-5 text-lg leading-relaxed">{children}</div>
    </section>
  );
}

/** An email drawn as a record: label column, value column, then the body. */
function Email({ label, from, children }: { label: string; from: string; children: string }) {
  return (
    <Plate className="bg-card">
      <dl className="grid grid-cols-[4.5rem_1fr] gap-y-1 border-b border-border px-5 py-4">
        <dt className="eyebrow self-center text-muted-foreground">Style</dt>
        <dd className="text-base font-medium">{label}</dd>
        <dt className="eyebrow self-center text-muted-foreground">From</dt>
        <dd className="machine text-sm">{from}</dd>
      </dl>
      <pre className="whitespace-pre-wrap px-5 py-5 font-sans text-base leading-relaxed">{children}</pre>
    </Plate>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="machine text-[0.92em]">{children}</span>;
}

export function Landing({ count }: { count?: number }) {
  const names = { sender: "Mark", user: "Sam" };
  const signature = "\n\nBouncer, Sam's AI email assistant · bouncer.pidgeon.ai";
  const from = "sam@bouncer.pidgeon.email";

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 sm:px-8">
        <section className="pb-14 pt-12 sm:pb-20 sm:pt-20">
          <p className="eyebrow text-muted-foreground">
            {count !== undefined
              ? `Someone's agent declined ${count} ${count === 1 ? "salesperson" : "salespeople"} this week`
              : "A free tool from Pidgeon"}
          </p>
          <h1 className="headline mt-5 text-[2.75rem] sm:text-7xl">Forward the cold email. Bouncer says no for you.</h1>
          <p className="mt-7 max-w-xl text-xl leading-relaxed text-muted-foreground">
            An AI email assistant that politely declines cold sales email on your behalf, deals with the
            &ldquo;just following up&rdquo;, and hands anything real back to you.
          </p>

          <Plate className="mt-10 bg-card px-5 py-6 sm:px-7">
            <p className="eyebrow text-muted-foreground">Forward cold email to</p>
            <p className="machine mt-3 text-2xl font-medium sm:text-4xl">
              <a href={`mailto:${FRONT_DOOR}`}>{FRONT_DOOR}</a>
            </p>
            <p className="mt-4 text-base text-muted-foreground">
              No sign-up form: your first forward is the sign-up. Free.
            </p>
          </Plate>
        </section>

        <Section id="how" eyebrow="01 · How it works" title="Three emails, then it runs itself">
          <ol className="space-y-6">
            {[
              [
                "Forward a cold email",
                <>
                  to <Mono>{FRONT_DOOR}</Mono>. Forwarding as an attachment works best (Gmail: ⋮ → Forward as
                  attachment); a normal forward works too.
                </>,
              ],
              [
                "Bouncer replies to you",
                <>
                  not to them, with the decline it would send. Reply <strong>YES</strong>, or pick a style. Your reply
                  confirms the address is yours; nothing goes to anyone before that.
                </>,
              ],
              [
                "Bouncer declines",
                <>
                  from your own Bouncer address, like <Mono>{from}</Mono>, under their subject line. After that, every
                  forward is answered straight away.
                </>,
              ],
            ].map(([title, body], i) => (
              <li key={i} className="grid grid-cols-[2.5rem_1fr] gap-2">
                <span className="machine pt-1 text-sm text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                <p>
                  <strong>{title}</strong> {body}
                </p>
              </li>
            ))}
          </ol>
          <p>
            If they keep the sequence going, Bouncer asks them once to stop, then goes quiet. If a real person answers
            with a real question, Bouncer stops and passes it to you.
          </p>
        </Section>

        <Section id="styles" eyebrow="02 · Styles" title="Pick how it says no">
          <p>Reply 1, 2 or 3 to Bouncer at any time to switch.</p>
          <Email label="1 · Polite no (the default)" from={from}>
            {declineText(1, names) + signature}
          </Email>
          <Email label="2 · Not now, try next quarter" from={from}>
            {declineText(2, names) + signature}
          </Email>
          <p>
            <strong>3 · Ask me first.</strong> Bouncer sends you a one-line summary of each pitch, and declines only when
            you reply YES.
          </p>
          <Email label="If the sequence keeps going: one last reply, then silence" from={from}>
            {stopText(names) + signature}
          </Email>
          <p className="text-base text-muted-foreground">
            Every email says it&apos;s from an AI assistant, and carries a link to stop all Bouncer mail and one to
            report abuse.
          </p>
        </Section>

        <Section id="rules" eyebrow="03 · What it won't do" title="The rules it can't break">
          <ul className="space-y-3">
            {[
              "It only ever replies to the person who sent the email you forwarded. Never anyone else.",
              "One decline per thread, and at most one “please stop”.",
              "Nothing goes out in your name until you've confirmed it's you.",
              "If an email doesn't look like cold sales (a customer, a colleague, a warm intro), it asks you first.",
              "Emails with hidden instructions aimed at AI agents are never acted on automatically: it asks you.",
              "The reply is a fixed template. The AI only sorts the email and reads the sender's first name.",
              "At most 25 replies a day per person, and anyone can opt out of Bouncer mail for good.",
              "It only acts on email you deliberately forward. No auto-forwarding, no inbox access.",
            ].map((rule) => (
              <li key={rule} className="grid grid-cols-[2.5rem_1fr] gap-2 border-b border-border pb-3">
                <span aria-hidden className="machine text-muted-foreground">
                  —
                </span>
                <span>{rule}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="privacy" eyebrow="04 · Privacy" title="Stores little, keeps it briefly">
          <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-[9rem_1fr]">
            <dt className="eyebrow pt-1.5 text-muted-foreground">Stored</dt>
            <dd>
              Your address and style, and one short record per email it handles: who sent it, their first name and
              company, the subject and a one-line summary.
            </dd>
            <dt className="eyebrow pt-1.5 text-muted-foreground">Kept for</dt>
            <dd>30 days. Message content is then deleted, from Bouncer and from its mail provider.</dd>
            <dt className="eyebrow pt-1.5 text-muted-foreground">Training</dt>
            <dd>Never. Your mail is not used to train any model.</dd>
            <dt className="eyebrow pt-1.5 text-muted-foreground">The AI</dt>
            <dd>
              A small model through the Vercel AI Gateway, routed only to providers with zero data retention that
              don&apos;t train on prompts.
            </dd>
            <dt className="eyebrow pt-1.5 text-muted-foreground">Mail</dt>
            <dd>
              Handled by <a href="https://pidgeon.ai" className="underline">Pidgeon</a>, hosted in the EU.
            </dd>
            <dt className="eyebrow pt-1.5 text-muted-foreground">Delete</dt>
            <dd>
              Email <Mono>DELETE</Mono> to <Mono>{FRONT_DOOR}</Mono> and your account and everything stored about you is
              removed.
            </dd>
          </dl>
        </Section>

        <Section id="source" eyebrow="05 · Open source" title="Build your own email agent in a weekend">
          <p>
            Bouncer is MIT-licensed and small enough to read in an evening. It&apos;s built on{" "}
            <a href="https://pidgeon.ai" className="underline">
              Pidgeon
            </a>
            , the email inbox API for AI agents: addresses by API, threads, signed webhooks, a prompt-injection firewall,
            hand-off to a person, and a test mode where no mail leaves.
          </p>
          <p className="flex flex-wrap gap-3">
            <a href={REPO} className="rounded-md bg-foreground px-5 py-3 text-base font-medium text-background hover:opacity-90">
              Read the code on GitHub
            </a>
            <a href="https://pidgeon.ai" className="rounded-md border border-border px-5 py-3 text-base font-medium hover:bg-muted">
              Get a Pidgeon inbox
            </a>
          </p>
        </Section>
      </main>
      <SiteFooter />
    </>
  );
}
