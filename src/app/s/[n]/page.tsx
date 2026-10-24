import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Landing } from "@/components/landing";
import { parseCount } from "@/components/share-image";

/**
 * bouncer.pidgeon.ai/s/12 — what a weekly-tally share links to: the home
 * page, with a share card that carries the number.
 */
export async function generateMetadata({ params }: { params: Promise<{ n: string }> }): Promise<Metadata> {
  const count = parseCount((await params).n);
  if (count === undefined) return {};
  const title = `My agent declined ${count} ${count === 1 ? "salesperson" : "salespeople"} this week`;
  return {
    title: `${title} · Bouncer`,
    openGraph: { title, description: "Free: forward cold email to bouncer@pidgeon.ai and Bouncer says no for you." },
  };
}

export default async function Share({ params }: { params: Promise<{ n: string }> }) {
  const count = parseCount((await params).n);
  if (count === undefined) notFound();
  return <Landing count={count} />;
}
