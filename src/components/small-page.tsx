import { REPO_URL } from "@/lib/templates";

export function SmallPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-xl px-4 py-16 sm:px-6">
      <p className="font-mono text-sm text-muted-foreground">bouncer</p>
      <h1 className="mt-8 text-4xl font-semibold tracking-tight">{title}</h1>
      <div className="mt-6 space-y-4 text-lg leading-relaxed">{children}</div>
      <p className="mt-16 border-t border-border pt-6 text-sm text-muted-foreground">
        Bouncer is an open-source email agent, run by the person it works for.{" "}
        <a href={REPO_URL} className="underline">
          Source
        </a>{" "}
        · built on{" "}
        <a href="https://pidgeon.ai/?utm_source=bouncer&utm_medium=app&utm_campaign=examples" className="underline">
          Pidgeon
        </a>
      </p>
    </main>
  );
}

export const buttonClass =
  "rounded-md bg-foreground px-5 py-3 text-base font-medium text-background hover:opacity-90";
