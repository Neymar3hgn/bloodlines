/**
 * A season on past questions, with each answer sealed before anyone bids.
 *
 *   node swarm/season.ts --questions 12              scripted agents, no key needed
 *   NEARAI_API_KEY=... node swarm/season.ts --ai     real forecasts
 */
import { readFileSync } from "node:fs";
import * as c from "./colony.ts";
import { colonyConfig, defaults, ensureFounders, finishRound, fundFounders, playRound, refuel, selection, type RoundInput } from "./runner.ts";

const arg = (name: string, dflt: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};

const ai = process.argv.includes("--ai");
const count = Number(arg("questions", "12"));
const offset = Number(arg("offset", "0"));
const timing = { commitSecs: Number(arg("commit", "45")), revealSecs: Number(arg("reveal", "120")) };
const settings = defaults(ai);

const questions: (RoundInput & { yes: boolean })[] = JSON.parse(readFileSync("data/questions.json", "utf8")).questions;

console.log(`Season on ${c.deployment.colony} (${c.deployment.network}), ${ai ? "real AI" : "scripted agents"}`);
const cfg = await colonyConfig();
await ensureFounders(Number(arg("founders", "16")));
await c.finishOpenWork();
await fundFounders();

let played = 0;
for (const q of questions.slice(offset, offset + count)) {
  if (played++ % 12 === 11) await refuel();
  const id = await playRound(q, cfg, timing, settings);
  if (id === null) continue;
  await c.resolveSealed(id, q.yes, c.sealFor(id, await c.getQuestion(id)));
  await finishRound(id, q.text, q.yes);
  const done = await c.getQuestion(id);
  console.log(`  the answer was ${q.yes ? "YES" : "NO"}, paid ${done.paid}, rewarded ${done.rewarded}`);
  await selection(cfg, settings);
}
console.log("Stats:", await c.getStats());
