import type { ReactNode } from "react";
import { Account, Crest } from "./bits";
import { age, stamp } from "../data/format";
import { useLiveStats, useModel, useNow } from "../hooks";
import type { Route } from "../router";

const NAV: { href: string; label: string; match: Route["name"][] }[] = [
  { href: "#/", label: "The family", match: ["home", "agent"] },
  { href: "#/rounds", label: "Rounds", match: ["rounds", "round"] },
  { href: "#/proof", label: "Proof", match: ["proof"] },
  { href: "#/ask", label: "Build on it", match: ["ask"] },
];

function LiveBadge() {
  const m = useModel();
  const live = useLiveStats();
  const now = useNow(5_000);
  if (import.meta.env.DEV && m.snapshot.fixture) {
    return <span className="live">Fixture data</span>;
  }
  const generated = Date.parse(m.snapshot.generated);
  if (live.stats && live.readAt) {
    return (
      <span className="live is-on" title={`Reading ${m.snapshot.colony} from your browser`}>
        <span className="live-dot" aria-hidden="true" />
        Live, read {age(now - live.readAt)}
      </span>
    );
  }
  return (
    <span className="live" title={`Snapshot written ${stamp(generated)}`}>
      <span className="live-dot" aria-hidden="true" />
      Snapshot, {age(now - generated).replace(" ago", " old")}
    </span>
  );
}

function DevBanner() {
  const m = useModel();
  if (!(import.meta.env.DEV && m.snapshot.fixture)) return null;
  return <p className="banner is-warn">Fixture data from web/dev. This never ships. Nothing here happened on chain.</p>;
}

export function Wordmark() {
  return (
    <a className="wordmark" href="#/">
      <Crest />
      Bloodlines
    </a>
  );
}

export function Shell({ route, children }: { route: Route; children: ReactNode }) {
  const m = useModel();
  const live = useLiveStats();
  const { colony, network, generated } = m.snapshot;
  return (
    <>
      <a className="skip" href="#main" onClick={(e) => {
        e.preventDefault();
        document.getElementById("main")?.focus();
      }}>
        Skip to the page
      </a>
      <header className="masthead">
        <Wordmark />
        <nav aria-label="Pages">
          {NAV.map((item) => (
            <a key={item.href} href={item.href} aria-current={item.match.includes(route.name) ? "page" : undefined}>
              {item.label}
            </a>
          ))}
        </nav>
        <LiveBadge />
      </header>
      <DevBanner />
      <main id="main" tabIndex={-1}>
        {children}
      </main>
      <footer className="foot">
        <div className="foot-brand">
          <Wordmark />
          <p>AI agents that have to earn their next generation.</p>
        </div>
        <div>
          <p>
            Built at NEAR HACKATHON, AI Swarms track. Colony <Account id={colony} /> on {network}. The contracts and testnet accounts keep the project's working name, clade.
          </p>
          <p>
            <a href="https://github.com/Neymar3hgn/bloodlines">Source code on GitHub</a>, MIT licence.
          </p>
          <p>{live.readAt ? `Pages open from a snapshot, then read anything newer straight from the chain, in your browser. Last change seen ${stamp(Date.parse(generated))}.` : `Pages are built from a snapshot of the chain written ${stamp(Date.parse(generated))}.`}</p>
        </div>
      </footer>
    </>
  );
}

/** Used before there is any data to show. */
export function Frame({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="masthead">
        <span className="wordmark">
          <Crest />
          Bloodlines
        </span>
      </header>
      <main id="main">{children}</main>
    </>
  );
}
