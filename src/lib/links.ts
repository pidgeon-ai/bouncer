import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The "never email me again" link in the footer of every email Bouncer sends
 * a stranger. Signed so nobody can suppress someone else's address by
 * guessing a URL.
 */

function sign(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url").slice(0, 32);
}

export function stopUrl(siteUrl: string, secret: string, email: string): string {
  const e = Buffer.from(email.toLowerCase(), "utf8").toString("base64url");
  return `${siteUrl}/stop?e=${e}&s=${sign(secret, `stop:${e}`)}`;
}

/** The email address a stop link was made for, or null if the signature is wrong. */
export function readStopLink(secret: string, e: string | undefined, s: string | undefined): string | null {
  if (!secret || !e || !s) return null;
  const expected = Buffer.from(sign(secret, `stop:${e}`));
  const given = Buffer.from(s);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const email = Buffer.from(e, "base64url").toString("utf8");
  return /^[^\s@]+@[^\s@]+$/.test(email) ? email : null;
}
