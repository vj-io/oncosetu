import type { NextConfig } from "next";

// Cache Components off: every page here is per-request PHI behind auth; nothing should be cached.
const nextConfig: NextConfig = {
  // forbidden() → 403 page from requireStaff(roles) (src/server/session.ts).
  experimental: { authInterrupts: true },
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
