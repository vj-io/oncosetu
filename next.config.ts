import type { NextConfig } from "next";

// Cache Components off: every page here is per-request PHI behind auth; nothing should be cached.
const nextConfig: NextConfig = {
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
