import type { Sql } from "./index";

/**
 * Postgres when DATABASE_URL is set (production: any Postgres, e.g. Neon from
 * the Vercel Marketplace), otherwise PGlite — real Postgres compiled to WASM,
 * kept in `.data/` — so `pnpm dev` works with nothing installed.
 */
export async function connectSql(databaseUrl = process.env.DATABASE_URL): Promise<Sql> {
  if (databaseUrl) {
    const { default: postgres } = await import("postgres");
    const db = postgres(databaseUrl, { max: 5, prepare: false });
    return {
      query: async (text, params = []) =>
        (await db.unsafe(text, params as never[])) as unknown as never[],
      exec: async (text) => {
        await db.unsafe(text);
      },
    };
  }
  if (process.env.VERCEL) {
    throw new Error("DATABASE_URL is not set. On Vercel, Bouncer needs a real Postgres (README → Deploy).");
  }
  return pglite(process.env.PGLITE_DIR ?? ".data/pglite");
}

/** An in-process Postgres. Pass undefined for a throwaway in-memory one (tests). */
export async function pglite(dataDir?: string): Promise<Sql> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (dataDir) {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(dataDir, { recursive: true });
  }
  const db = dataDir ? new PGlite(dataDir) : new PGlite();
  return {
    query: async (text, params = []) => (await db.query(text, params)).rows as never[],
    exec: async (text) => {
      await db.exec(text);
    },
  };
}
