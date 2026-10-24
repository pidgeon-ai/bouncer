import { SiteFooter, SiteHeader } from "@/components/landing";

export function SmallPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-8">
        <h1 className="headline text-5xl">{title}</h1>
        <div className="mt-8 max-w-xl space-y-5 text-lg leading-relaxed">{children}</div>
      </main>
      <SiteFooter />
    </>
  );
}

export const buttonClass =
  "rounded-md bg-foreground px-5 py-3 text-base font-medium text-background hover:opacity-90";
