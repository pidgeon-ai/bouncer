/**
 * The two scheduled jobs: the weekly tally and the 30-day deletion.
 */

import { sendToUser, type GuardDeps } from "./guard";
import { linkedInShareUrl } from "./links";
import { hashEmail } from "./store";
import { MINUTES_SAVED_PER_EMAIL, tallyEmail } from "./templates";

const DAY = 24 * 60 * 60 * 1000;

/** ISO week label, e.g. 2026-W43: one tally per user per week, however often the cron fires. */
export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / DAY + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export async function sendWeeklyTally(deps: GuardDeps): Promise<{ sent: number }> {
  const now = deps.now();
  const since = new Date(now.getTime() - 7 * DAY);
  const week = isoWeek(now);
  let sent = 0;

  for (const user of await deps.store.verifiedUsers()) {
    const count = await deps.store.declinesSince(user.email, since);
    if (count === 0) continue;
    const email = tallyEmail({
      userFirstName: user.firstName,
      count,
      minutes: count * MINUTES_SAVED_PER_EMAIL,
      shareUrl: linkedInShareUrl(deps.config.siteUrl, count),
      siteUrl: deps.config.siteUrl,
    });
    const result = await sendToUser(deps, {
      user,
      subject: email.subject,
      text: email.text,
      idempotencyKey: `bouncer:tally:${hashEmail(user.email).slice(0, 16)}:${week}`,
    });
    if (result) sent++;
  }
  return { sent };
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
