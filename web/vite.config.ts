import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // Relative paths, so dist/ works from any sub-path on GitHub Pages.
  base: "./",
  plugins: [react()],
  server: {
    // The Proof page imports ../engine/market.ts, which sits outside web/.
    fs: { allow: [resolve(import.meta.dirname, "..")] },
  },
  build: {
    outDir: "dist",
    target: "es2022",
  },
});
