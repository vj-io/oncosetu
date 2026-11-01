import type { NextConfig } from "next";

// Cache Components off: every page here is per-request PHI behind auth; nothing should be cached.
const nextConfig: NextConfig = {
  // forbidden() → 403 page from requireStaff(roles) (src/server/session.ts).
  experimental: { authInterrupts: true },
  // Pipeline (src/server/pipeline): tesseract.js spawns a worker_thread from its own file path and loads its wasm
  // core at runtime, and unpdf lazy-loads PDF.js — all must stay plain node_modules requires, traced into every API
  // function that may run processing in after().
  serverExternalPackages: ["tesseract.js", "tesseract.js-core", "unpdf"],
  outputFileTracingIncludes: {
    "/api/**/*": [
      "./node_modules/tesseract.js/**/*", "./node_modules/tesseract.js-core/**/*", "./node_modules/wasm-feature-detect/**/*",
      "./node_modules/bmp-js/**/*", "./node_modules/zlibjs/**/*", "./node_modules/is-url/**/*", "./node_modules/regenerator-runtime/**/*",
      "./node_modules/unpdf/dist/**/*",
    ],
  },
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
