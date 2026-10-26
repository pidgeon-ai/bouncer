import { SmallPage } from "@/components/small-page";

/**
 * Bouncer has no website of its own: it's an email agent. This page only
 * tells someone who lands on a deployment what they've found.
 */
export default function Home() {
  return (
    <SmallPage title="This is a Bouncer">
      <p>
        An AI email assistant that politely declines cold sales email for the one person who runs it, and hands
        anything real back to them.
      </p>
      <p className="text-muted-foreground">
        Got an email from it you didn&apos;t want? Use the link at the bottom of that email to never hear from it again.
      </p>
    </SmallPage>
  );
}
