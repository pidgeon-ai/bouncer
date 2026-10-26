import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite (local dev and tests) and the postgres driver are server-only packages.
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
