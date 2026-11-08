/** Small shared pieces of the page. */
import { useState, type ReactNode } from "react";
import { explorerUrl } from "../data/live";
import { money, tokenSymbol, type Units } from "../data/format";
import { useModel } from "../hooks";
import { agentHref } from "../router";

/** A drop of blood with a family tree inside it. */
export function Crest({ size = 22 }: { size?: number }) {
  return (
    <svg className="crest" width={size} height={size * 1.16} viewBox="0 0 24 28" aria-hidden="true">
      <path fill="#e0223d" d="M12 1S3 12 3 18a9 9 0 0 0 18 0C21 12 12 1 12 1Z" />
      <path fill="none" stroke="#09080b" strokeWidth="1.8" strokeLinecap="round" d="M12 24v-9m0 5.2-4-4.2m4 1.6 3.6-3.6" />
    </svg>
  );
}

/** An agent's name and a link to its page. Works for accounts that are not agents too. */
export function AgentName({ id, full = false }: { id: string; full?: boolean; plain?: boolean }) {
  const m = useModel();
  const agent = m.agents.get(id);
  if (!agent) {
    return <span className="mono">{id}</span>;
  }
  const dead = agent.status === "Dead";
  const name = full ? agent.id : agent.label;
  return (
    <a className={`agent-name${dead ? " is-dead" : ""}`} href={agentHref(agent.id)}>
      <span className="mono">
        {dead && <span aria-label="dead">† </span>}
        {name}
      </span>
    </a>
  );
}

export function Money({ units }: { units: Units }) {
  const m = useModel();
  return (
    <span className="mono">
      {money(units)} {tokenSymbol(m.snapshot.network)}
    </span>
  );
}

export function Account({ id, children }: { id: string; children?: ReactNode }) {
  const m = useModel();
  return (
    <a className={children ? undefined : "mono"} href={explorerUrl(m.snapshot.network, id)} target="_blank" rel="noreferrer">
      {children ?? id}
    </a>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function NotFound({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="prose">
      <h1>{title}</h1>
      <p>{children}</p>
      <p>
        <a href="#/">Back to the family</a>
      </p>
    </section>
  );
}

/** A block of code with a copy button. Falls back quietly if the browser refuses the clipboard. */
export function Code({ children, label }: { children: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="code">
      <div className="code-bar">
        <span>{label}</span>
        <button type="button" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre tabIndex={0}>
        <code>{children}</code>
      </pre>
    </div>
  );
}

export function Tip({ x, y, width, pinned, children }: { x: number; y: number; width: number; pinned?: boolean; children: ReactNode }) {
  const w = Math.min(244, width - 16);
  const left = x + w + 22 > width ? Math.max(8, x - w - 14) : x + 14;
  return (
    <div className={`tip${pinned ? " is-pinned" : ""}`} style={{ left, top: Math.max(4, y + 12), width: w }} role="status">
      {children}
    </div>
  );
}
