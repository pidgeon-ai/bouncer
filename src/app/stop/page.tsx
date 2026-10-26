import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SmallPage, buttonClass } from "@/components/small-page";
import { getApp } from "@/lib/app";
import { readStopLink } from "@/lib/links";

export const metadata: Metadata = { title: "Stop Bouncer email", robots: { index: false } };

type Search = Promise<{ e?: string; s?: string; done?: string }>;

/**
 * The opt-out link in every email Bouncer sends a stranger. A GET only shows
 * the button — link scanners and prefetchers follow GETs — and the POST does it.
 */
export default async function Stop({ searchParams }: { searchParams: Search }) {
  const { e, s, done } = await searchParams;
  const { config } = await getApp();
  const email = readStopLink(config.linkSecret, e, s);

  if (!email) {
    return (
      <SmallPage title="This link doesn't work">
        <p>
          It may have been cut short. Reply to the email instead, or report it to{" "}
          <a className="underline" href="mailto:abuse@pidgeon.ai">
            abuse@pidgeon.ai
          </a>
          .
        </p>
      </SmallPage>
    );
  }

  if (done) {
    return (
      <SmallPage title="Done">
        <p>
          This Bouncer will never email <span className="font-mono">{email}</span> again.
        </p>
      </SmallPage>
    );
  }

  async function stop() {
    "use server";
    const app = await getApp();
    const confirmed = readStopLink(app.config.linkSecret, e, s);
    if (!confirmed) return;
    await app.store.suppress(confirmed);
    redirect(`/stop?e=${encodeURIComponent(e!)}&s=${encodeURIComponent(s!)}&done=1`);
  }

  return (
    <SmallPage title="Stop all Bouncer email">
      <p>
        Bouncer is an AI assistant that declines cold sales email for the person who runs it. Press the button and
        this Bouncer will never email <span className="font-mono">{email}</span> again.
      </p>
      <form action={stop}>
        <button type="submit" className={buttonClass}>
          Stop all Bouncer email to me
        </button>
      </form>
    </SmallPage>
  );
}
