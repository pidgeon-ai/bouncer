import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed links for the footer of every email Bouncer sends a stranger:
 * "never email me again" and "report abuse". Signed so nobody can suppress
 * someone else's address by guessing a URL.
 */

function sign(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url").slice(0, 32);
}

function encode(email: string): string {
  return Buffer.from(email.toLowerCase(), "utf8").toString("base64url");
}

export function stopUrl(siteUrl: string, secret: string, email: string): string {
  const e = encode(email);
  return `${siteUrl}/stop?e=${e}&s=${sign(secret, `stop:${e}`)}`;
}

export function reportUrl(siteUrl: string, secret: string, email: string): string {
  const e = encode(email);
  return `${siteUrl}/report?e=${e}&s=${sign(secret, `report:${e}`)}`;
}

/** The email address a stop/report link was made for, or null if the signature is wrong. */
export function readSignedEmail(
  secret: string,
  purpose: "stop" | "report",
  e: string | undefined,
  s: string | undefined,
): string | null {
  if (!secret || !e || !s) return null;
  const expected = Buffer.from(sign(secret, `${purpose}:${e}`));
  const given = Buffer.from(s);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const email = Buffer.from(e, "base64url").toString("utf8");
  return /^[^\s@]+@[^\s@]+$/.test(email) ? email : null;
}

/** LinkedIn's share composer, prefilled. */
export function linkedInShareUrl(siteUrl: string, count: number): string {
  const text = `My agent declined ${count} ${count === 1 ? "salesperson" : "salespeople"} this week. Free: ${siteUrl.replace(/^https?:\/\//, "")}/s/${count}`;
  return `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(text)}`;
}
