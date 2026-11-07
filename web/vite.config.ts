import { join, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The repo path can be very long on Windows, so the dependency cache lives under
 * the portable tools folder when that folder exists. Elsewhere Vite's default is fine.
 */
const tools = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "clade-tools") : undefined;

export default defineConfig({
  // Relative paths, so dist/ works from any sub-path on GitHub Pages.
  base: "./",
  plugins: [react()],
  cacheDir: tools ? join(tools, "vite") : undefined,
  server: {
    // The Proof page imports ../engine/market.ts, which sits outside web/.
    fs: { allow: [resolve(__dirname, "..")] },
  },
  build: {
    outDir: "dist",
    target: "es2022",
    sourcemap: false,
  },
});
