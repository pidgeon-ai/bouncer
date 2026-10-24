import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  framework: "nextjs",
  crons: [
    // Monday 08:00 UTC: the weekly tally email.
    { path: "/api/cron/weekly", schedule: "0 8 * * 1" },
    // Every day 03:00 UTC: delete message content older than 30 days.
    { path: "/api/cron/cleanup", schedule: "0 3 * * *" },
  ],
};
