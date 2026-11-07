/**
 * The founding population: sixteen ways of thinking, spread across NEAR AI
 * Cloud's models that sign their answers inside a secure enclave. Nothing here
 * is tuned. Which of these survive is what the experiment is for.
 */
import { CATEGORIES, type Genome } from "./genome.ts";

/** Models whose answers are signed in a secure enclave, from cloud-api.near.ai/v1/model/list. */
export const MODELS = [
  "deepseek-ai/DeepSeek-V4.1-Flash-1017",
  "Qwen/Qwen3.8-27B",
  "Qwen/Qwen3.6-35B-A3B-FP8",
  "levanto/sage-2",
  "moonshotai/kimi-k2.6",
];

const everything = () => Object.fromEntries(CATEGORIES.map((c) => [c, 1]));

const STRATEGIES: [string, string, number, number, number][] = [
  // name, strategy, temperature, shrink, size
  ["ivy", "Start from the base rate: how often do events of this exact kind happen? Only move away from that number for specific, concrete evidence.", 0.2, 1.0, 0.08],
  ["oak", "The status quo usually wins. Things change more slowly than people expect, and most deadlines pass with nothing happening.", 0.2, 1.0, 0.1],
  ["elm", "Read the resolution rules like a lawyer. Work out exactly what must happen, by exactly when, and how many separate things must all go right.", 0.3, 1.0, 0.08],
  ["ash", "Follow the incentives. Ask who wants this outcome, who can make it happen, and what it would cost them.", 0.4, 1.0, 0.07],
  ["fir", "Think like a calibrated superforecaster. Split the question into parts, estimate each one, and combine them. Avoid certainty.", 0.3, 0.9, 0.09],
  ["yew", "Trust the first strong signal you see. Most questions are less uncertain than they look, so commit to a clear view.", 0.5, 1.3, 0.12],
  ["bay", "Find the closest historical parallels and count how they ended. Use that count as your estimate.", 0.4, 1.0, 0.08],
  ["fig", "Assume the favourite wins. Reputation, resources and recent form predict results better than stories do.", 0.3, 1.1, 0.1],
  ["rue", "Assume the obvious answer is priced into everyone's thinking. Look for why the popular view is wrong and lean against it.", 0.6, 0.9, 0.07],
  ["gum", "Momentum carries. If the trend before the question date points one way, assume it continues.", 0.4, 1.0, 0.08],
  ["sal", "Be humble. You rarely know enough, so stay close to 50 unless the evidence is overwhelming.", 0.2, 0.7, 0.05],
  ["tea", "Weigh the time left. Divide the remaining time by how long such things usually take, and scale your estimate by that.", 0.3, 1.0, 0.08],
  ["box", "Think about what could go wrong. Name the most likely way the outcome fails, and estimate that first.", 0.4, 1.0, 0.07],
  ["nut", "Think about who is reporting this and why the question was asked at all. Questions get written when something feels possible, which makes dramatic outcomes look likelier than they are.", 0.4, 1.0, 0.07],
  ["lin", "Take two views: one as an optimist and one as a sceptic. Average them, then adjust for which view had the better evidence.", 0.5, 1.0, 0.08],
  ["sol", "Prefer simple rules of thumb over long reasoning. A short, plain estimate beats a clever story.", 0.3, 1.0, 0.09],
];

export function founders(models: string[] = MODELS): Genome[] {
  return STRATEGIES.map(([name, strategy, temperature, shrink, size], i) => ({
    name,
    model: models[i % models.length],
    strategy,
    temperature,
    shrink,
    size,
    focus: everything(),
  }));
}
