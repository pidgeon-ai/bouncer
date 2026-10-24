import Link from "next/link";

import { SmallPage } from "@/components/small-page";

export default function NotFound() {
  return (
    <SmallPage title="Nothing here">
      <p>
        <Link href="/" className="underline">
          Back to Bouncer
        </Link>
      </p>
    </SmallPage>
  );
}
