/**
 * The two scheduled jobs: a weekly summary for the owner and the 30-day
 * deletion. Both run from vercel.ts crons, or call them yourself.
 */

import { sendToOwner, type GuardDeps } from "./guard";
import { MINUTES_SAVED_PER_EMAIL, cleanFirstName, tallyEmail } from "./templates";

const DAY = 24 * 60 * 60 * 1000;

/** ISO week label, e.g. 2026-W43: one summary per week, however often the cron fires. */
export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / DAY + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export async function sendWeeklyTally(deps: GuardDeps): Promise<{ sent: boolean }> {
  const now = deps.now();
  const count = await deps.store.declinesSince(new Date(now.getTime() - 7 * DAY));
  if (count === 0) return { sent: false };
  const email = tallyEmail({
    ownerFirstName: cleanFirstName(deps.config.ownerName),
    count,
    minutes: count * MINUTES_SAVED_PER_EMAIL,
  });
  const sent = await sendToOwner(deps, {
    subject: email.subject,
    text: email.text,
    idempotencyKey: `bouncer:tally:${isoWeek(now)}`,
  });
  return { sent: Boolean(sent) };
}

/** Deletes message content older than the retention period, in Pidgeon and here. */
export async function deleteOldMail(deps: GuardDeps): Promise<{ deleted: number }> {
  const cutoff = new Date(deps.now().getTime() - deps.config.retentionDays * DAY);
  let deleted = 0;
  for (;;) {
    const ids = await deps.store.messagesOlderThan(cutoff);
    if (ids.length === 0) break;
    await deps.mail.deleteMessages(ids);
    await deps.store.forgetMessages(ids);
    deleted += ids.length;
  }
  await deps.store.purgeOlderThan(cutoff);
  return { deleted };
}
