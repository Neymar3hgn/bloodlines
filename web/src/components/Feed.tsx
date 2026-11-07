import { AgentName, Empty } from "./bits";
import { plural, stamp } from "../data/format";
import { roundState, type FeedItem } from "../data/model";
import type { Question } from "../data/types";
import { useModel, useNow } from "../hooks";
import { roundHref } from "../router";

/** One short factual line about where a round stands. */
function roundLine(q: Question, now: number): string {
  const state = roundState(q, now);
  if (state === "sealing") return `Open. ${plural(q.commits, "sealed bid")} so far.`;
  if (state === "revealing") return `Revealing. ${q.reveals} of ${q.commits} bids open.`;
  if (state === "void") return "Void. Nobody revealed a bid.";
  if (state === "voided") return `The swarm said ${q.price}%. Voided, costs refunded.`;
  if (state === "waiting") return `The swarm said ${q.price}%. Waiting for the result.`;
  return `The swarm said ${q.price}%. The answer was ${q.yes_won ? "YES" : "NO"}.`;
}

function Row({ item, now }: { item: FeedItem; now: number }) {
  const when = <time dateTime={new Date(item.at).toISOString()}>{stamp(item.at)}</time>;
  if (item.kind === "round") {
    const q = item.question;
    return (
      <li className="feed-round">
        {when}
        <a href={roundHref(q.id)}>
          Round {q.id}
          <span className="feed-q">{q.text}</span>
        </a>
        <span className="feed-note">{roundLine(q, now)}</span>
      </li>
    );
  }
  if (item.kind === "death") {
    return (
      <li className="feed-death">
        {when}
        <span>
          <AgentName id={item.agent.id} /> died
        </span>
        <span className="feed-note">After {plural(item.agent.questions, "question")}.</span>
      </li>
    );
  }
  return (
    <li className="feed-birth">
      {when}
      <span>
        <AgentName id={item.agent.id} /> was born
      </span>
      <span className="feed-note">
        Child of <AgentName id={item.agent.parent} plain />, generation {item.agent.generation}.
      </span>
    </li>
  );
}

export function Feed({ limit = 12 }: { limit?: number }) {
  const m = useModel();
  const now = useNow(30_000);
  const items = m.feed.slice(0, limit);
  if (!items.length) return <Empty>Nothing has happened yet.</Empty>;
  return (
    <ol className="feed">
      {items.map((item) => (
        <Row key={`${item.kind}-${item.kind === "round" ? item.question.id : item.agent.id}`} item={item} now={now} />
      ))}
    </ol>
  );
}
