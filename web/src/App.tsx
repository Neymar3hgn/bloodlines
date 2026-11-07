import { useEffect, useMemo, useRef, useState } from "react";
import { Frame, Shell } from "./components/Shell";
import { NotFound } from "./components/bits";
import { useLive } from "./data/live";
import { loadSnapshot } from "./data/load";
import { buildModel } from "./data/model";
import type { Snapshot } from "./data/types";
import { LiveContext, ModelContext, useTitle } from "./hooks";
import { AgentPage } from "./pages/Agent";
import { AskPage } from "./pages/Ask";
import { HomePage } from "./pages/Home";
import { ProofPage } from "./pages/Proof";
import { RoundPage } from "./pages/Round";
import { RoundsPage } from "./pages/Rounds";
import { useRoute, type Route } from "./router";

type Load = { state: "loading" } | { state: "failed"; why: string } | { state: "ready"; snapshot: Snapshot };

function Page({ route }: { route: Route }) {
  switch (route.name) {
    case "home":
      return <HomePage />;
    case "rounds":
      return <RoundsPage />;
    case "round":
      return <RoundPage key={route.id} id={route.id} />;
    case "agent":
      return <AgentPage key={route.id} id={route.id} />;
    case "proof":
      return <ProofPage />;
    case "ask":
      return <AskPage />;
    default:
      return <Missing />;
  }
}

function Missing() {
  useTitle("Not found");
  return <NotFound title="Not found">There is no page at this address.</NotFound>;
}

export function App() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const route = useRoute();
  const published = load.state === "ready" ? load.snapshot : null;
  const live = useLive(published);
  // The chain's newer data, merged over the published file. It is the same object until something changes.
  const snapshot = live.snapshot ?? published;
  const model = useMemo(() => (snapshot ? buildModel(snapshot) : null), [snapshot]);

  const firstRoute = useRef(true);
  useEffect(() => {
    if (firstRoute.current) {
      firstRoute.current = false;
      return;
    }
    scrollTo(0, 0);
    document.getElementById("main")?.focus({ preventScroll: true });
  }, [route]);

  useEffect(() => {
    let stopped = false;
    loadSnapshot().then(
      (snapshot) => !stopped && setLoad({ state: "ready", snapshot }),
      (e: Error) => !stopped && setLoad({ state: "failed", why: e.message }),
    );
    return () => {
      stopped = true;
    };
  }, []);

  if (load.state === "loading") {
    return (
      <Frame>
        <p className="empty">Reading the snapshot.</p>
      </Frame>
    );
  }
  if (load.state === "failed" || !model) {
    return (
      <Frame>
        <section className="prose">
          <h1>The snapshot could not be read</h1>
          <p>The site is built from data/snapshot.json, and that file did not load. Reloading may help.</p>
          {load.state === "failed" && <p className="mono small">{load.why}</p>}
        </section>
      </Frame>
    );
  }
  return (
    <ModelContext.Provider value={model}>
      <LiveContext.Provider value={live}>
        <Shell route={route}>
          <Page route={route} />
        </Shell>
      </LiveContext.Provider>
    </ModelContext.Provider>
  );
}
