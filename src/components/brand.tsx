import Link from "next/link";

/*
 * Pidgeon's marks, from the generated asset files in the Pidgeon repo
 * (public/brand, `pnpm brand:assets`). Copied as files, never redrawn, so
 * they can't drift from the original.
 */

/** "Pidgeon @ bouncer": the lockup, qualified after an `@`, as the brand guide does for sub-products. */
export function Lockup() {
  return (
    <Link href="/" aria-label="Bouncer, by Pidgeon" className="inline-flex items-center gap-2 rounded-sm">
      {/* eslint-disable-next-line @next/next/no-img-element -- an SVG logo needs no optimisation */}
      <img src="/brand/logo-light.svg" alt="" width={94} height={24} className="h-6 w-auto sm:h-[30px]" />
      <span aria-hidden className="machine text-sm text-muted-foreground/60">
        @
      </span>
      <span className="eyebrow text-muted-foreground">bouncer</span>
    </Link>
  );
}

/** The figure alone, for the footer sign-off. */
export function AtMark({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- see above
    <img src="/icon.svg" alt="" width={30} height={30} className={className} />
  );
}

/** A plate: content located by four corner ticks rather than boxed. */
export function Plate({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={`plate ${className ?? ""}`}>
      <span className="plate-marks" aria-hidden />
      {children}
    </div>
  );
}
