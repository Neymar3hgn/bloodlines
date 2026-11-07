import type { Snapshot } from "./types";

/**
 * Production reads only snapshot.json. The fixture branch is removed from the
 * build, because Vite replaces import.meta.env.DEV with false before bundling.
 * The check has to be written as that literal everywhere: the bundler folds it
 * at the call site, but would not fold a helper function that wraps it.
 */
export async function loadSnapshot(): Promise<Snapshot> {
  if (import.meta.env.DEV) {
    const kind = new URLSearchParams(location.search).get("fixture");
    if (kind) {
      const { makeFixture } = await import("../../dev/fixture.ts");
      return makeFixture(kind);
    }
  }
  const res = await fetch("./data/snapshot.json", { cache: "no-cache" });
  if (!res.ok) throw new Error(`snapshot.json answered ${res.status}`);
  return (await res.json()) as Snapshot;
}
