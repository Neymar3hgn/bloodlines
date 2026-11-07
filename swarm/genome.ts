/**
 * What an agent inherits, and how its numbers become an order. The model's
 * output only ever reaches this code as a number, which is clamped here (R5).
 */
import { createHash } from "node:crypto";

export interface Genome {
  /** Short name, also the label in the agent's account id. */
  name: string;
  /** A NEAR AI Cloud model id. */
  model: string;
  /** The agent's written way of thinking, handed down and rewritten by its parent. */
  strategy: string;
  temperature: number;
  /** Multiplies the model's log odds. Below 1 hedges toward 50, above 1 sharpens. */
  shrink: number;
  /** Fraction of the agent's credits staked per question. */
  size: number;
  /** Chance of taking a question, per category. A low number means the agent saves its bill. */
  focus: Record<string, number>;
}

export const CATEGORIES = ["sports", "politics", "world", "economy", "crypto", "tech", "other"];

const logit = (p: number) => Math.log(p / (1 - p));
const logistic = (x: number) => 1 / (1 + Math.exp(-x));

export interface Order {
  belief: number;
  stake: bigint;
}

/** R5: fixed code turns a model's probability into an order. Nothing else reaches the chain. */
export function toOrder(g: Genome, probability: number, credits: bigint, maxStake: bigint, reserve: bigint): Order | null {
  if (!Number.isFinite(probability)) return null;
  const p = Math.min(0.99, Math.max(0.01, probability));
  const belief = Math.min(99, Math.max(1, Math.round(100 * logistic(g.shrink * logit(p)))));
  const spendable = credits - reserve;
  if (spendable <= 0n) return null;
  let stake = BigInt(Math.floor((Number(spendable) * g.size) / 10_000));
  if (stake > maxStake) stake = maxStake;
  const lockPerShare = BigInt(Math.max(belief, 100 - belief)) * 100n;
  const affordable = spendable / lockPerShare;
  if (stake > affordable) stake = affordable;
  return stake > 0n ? { belief, stake } : null;
}

/** A stable coin flip per agent and question, so a run can be replayed exactly. */
export function engages(g: Genome, agent: string, questionId: string, category: string): boolean {
  const chance = g.focus[category] ?? 1;
  if (chance >= 1) return true;
  const h = createHash("sha256").update(`${agent}:${questionId}`).digest();
  return h.readUInt32LE(0) / 2 ** 32 < chance;
}

export type Rng = () => number;

export function gaussian(r: Rng): number {
  return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Changes a genome's numbers. The written strategy is changed separately, by a model. */
export function mutateNumbers(g: Genome, r: Rng, models: string[]): Genome {
  const focus: Record<string, number> = {};
  for (const c of CATEGORIES) focus[c] = clamp((g.focus[c] ?? 1) * Math.exp(0.25 * gaussian(r)), 0.05, 1);
  return {
    ...g,
    temperature: clamp(g.temperature + 0.1 * gaussian(r), 0, 1.2),
    shrink: clamp(g.shrink * Math.exp(0.12 * gaussian(r)), 0.35, 1.6),
    size: clamp(g.size * Math.exp(0.15 * gaussian(r)), 0.01, 0.25),
    focus,
    // A rare mutation moves a lineage to a different model.
    model: r() < 0.08 ? models[Math.floor(r() * models.length)] : g.model,
  };
}

const CONSONANTS = "bcdfghjklmnprstvwz";
const VOWELS = "aeiou";

/** A two-letter account label, unique among siblings. */
export function childLabel(r: Rng, taken: Set<string>): string {
  for (let i = 0; i < 500; i++) {
    const label = CONSONANTS[Math.floor(r() * CONSONANTS.length)] + VOWELS[Math.floor(r() * VOWELS.length)];
    if (!taken.has(label)) return label;
  }
  throw new Error("no labels left");
}
