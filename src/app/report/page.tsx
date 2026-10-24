import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SmallPage, buttonClass } from "@/components/small-page";
import { getApp } from "@/lib/app";
import { readSignedEmail } from "@/lib/links";

export const metadata: Metadata = { title: "Report Bouncer abuse", robots: { index: false } };

type Search = Promise<{ e?: string; s?: string; done?: string }>;

export default async function Report({ searchParams }: { searchParams: Search }) {
  const { e, s, done } = await searchParams;
  const { config } = await getApp();
  const email = readSignedEmail(config.linkSecret, "report", e, s);

  if (done) {
    return (
      <SmallPage title="Thanks, we've got it">
        <p>A person at Pidgeon reads every report. Bouncer won&apos;t email you again.</p>
      </SmallPage>
    );
  }

  async function report(form: FormData) {
    "use server";
    const app = await getApp();
    const confirmed = readSignedEmail(app.config.linkSecret, "report", e, s);
    if (!confirmed) return;
    await app.store.addReport(confirmed, String(form.get("note") ?? ""));
    // Reporting also opts you out: nobody who reports should hear from it again.
    await app.store.suppress(confirmed);
    redirect(`/report?e=${encodeURIComponent(e!)}&s=${encodeURIComponent(s!)}&done=1`);
  }

  return (
    <SmallPage title="Report abuse">
      <p>
        Did Bouncer send you something it shouldn&apos;t have? Tell us what happened. You can also write to{" "}
        <a className="underline" href="mailto:abuse@pidgeon.ai">
          abuse@pidgeon.ai
        </a>
        .
      </p>
      {email ? (
        <form action={report} className="space-y-4">
          <textarea
            name="note"
            rows={5}
            maxLength={2000}
            className="w-full rounded-md border border-border bg-card p-3 text-base"
            placeholder="What happened?"
          />
          <button type="submit" className={buttonClass}>
            Send report
          </button>
        </form>
      ) : (
        <p className="text-muted-foreground">This link doesn&apos;t work, so please email us instead.</p>
      )}
    </SmallPage>
  );
}
