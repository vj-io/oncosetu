import type { NextConfig } from "next";

// Cache Components off: every page here is per-request PHI behind auth; nothing should be cached.
const nextConfig: NextConfig = {
  poweredByHeader: false, // ASVS 14.3.3: no framework banner
  // forbidden() → 403 page from requireStaff(roles) (src/server/session.ts).
  experimental: { authInterrupts: true },
  // Pipeline (src/server/pipeline): tesseract.js spawns a worker_thread from its own file path and loads its wasm
  // core at runtime, and unpdf lazy-loads PDF.js — all must stay plain node_modules requires, traced into every API
  // function that may run processing in after().
  serverExternalPackages: ["tesseract.js", "tesseract.js-core", "unpdf", "@cornerstonejs/codec-openjpeg", "@cornerstonejs/codec-charls", "jpeg-lossless-decoder-js"],
  outputFileTracingIncludes: {
    "/api/**/*": [
      "./node_modules/tesseract.js/**/*", "./node_modules/tesseract.js-core/**/*", "./node_modules/wasm-feature-detect/**/*",
      "./node_modules/bmp-js/**/*", "./node_modules/zlibjs/**/*", "./node_modules/is-url/**/*", "./node_modules/regenerator-runtime/**/*",
      "./node_modules/unpdf/dist/**/*",
      // DICOM preview decoders (src/server/pipeline/codecs.ts): exactly the files opened at run time, each .wasm found next to its .js
      "./node_modules/@cornerstonejs/codec-openjpeg/package.json", "./node_modules/@cornerstonejs/codec-openjpeg/dist/openjpegwasm_decode.js",
      "./node_modules/@cornerstonejs/codec-openjpeg/dist/openjpegwasm_decode.wasm",
      "./node_modules/@cornerstonejs/codec-charls/package.json", "./node_modules/@cornerstonejs/codec-charls/dist/charlswasm_decode.js",
      "./node_modules/@cornerstonejs/codec-charls/dist/charlswasm_decode.wasm",
      "./node_modules/jpeg-lossless-decoder-js/package.json", "./node_modules/jpeg-lossless-decoder-js/release/cjs/lossless.cjs",
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
