/** A hash router, so the site works as static files under any sub-path. */
import { useEffect, useState } from "react";

export type Route =
  | { name: "home" }
  | { name: "rounds" }
  | { name: "round"; id: number }
  | { name: "agent"; id: string }
  | { name: "proof" }
  | { name: "ask" }
  | { name: "missing" };

export function parseHash(hash: string): Route {
  let path = hash.replace(/^#\/?/, "").replace(/\/+$/, "");
  try {
    path = decodeURIComponent(path);
  } catch {
    return { name: "missing" };
  }
  if (path === "") return { name: "home" };
  if (path === "rounds") return { name: "rounds" };
  if (path === "proof") return { name: "proof" };
  if (path === "ask") return { name: "ask" };
  const round = /^round\/(\d+)$/.exec(path);
  if (round) return { name: "round", id: Number(round[1]) };
  const agent = /^agent\/(.+)$/.exec(path);
  if (agent) return { name: "agent", id: agent[1] };
  return { name: "missing" };
}

export const roundHref = (id: number) => `#/round/${id}`;
export const agentHref = (id: string) => `#/agent/${id}`;

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(location.hash));
    addEventListener("hashchange", onChange);
    return () => removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
