/**
 * Attacks on the market. Each function plays one strategy against honest agents
 * and reports what it earned, so the numbers can be checked rather than claimed.
 */
import { clear, settle, type Order } from "../engine/market.ts";
import { gauss, makeRng } from "./world.ts";

/** Expected value of one agent's report, given what it truly believes. */
function expectedValue(orders: Order[], agent: string, trueBelief: number, pool: bigint): number {
  const c = clear(orders);
  const yes = settle(c, true, pool).rows.find((x) => x.agent === agent);
  const no = settle(c, false, pool).rows.find((x) => x.agent === agent);
  if (!yes || !no) return 0;
  const p = trueBelief / 100;
  return p * Number(yes.pnl + yes.reward) + (1 - p) * Number(no.pnl + no.reward);
}

export interface LieReport {
  trials: number;
  crowd: number;
  /** Trials where at least one lie beat telling the truth. */
  lieWins: number;
  /** Mean gain from the best possible lie, over all trials, as a share of the stake. */
  meanBestGainPct: number;
  /** Mean loss from a typical lie (a random other number), as a share of the stake. */
  meanRandomLiePct: number;
}

/** Can an agent do better by sealing a number other than its true belief? */
export function lyingAudit(trials: number, crowd: number, seed: number): LieReport {
  const r = makeRng(seed);
  let lieWins = 0;
  let gainSum = 0;
  let randomSum = 0;
  const pool = 40_000n;
  for (let t = 0; t < trials; t++) {
    const center = 8 + r() * 84;
    const others: Order[] = [];
    for (let i = 0; i < crowd; i++) {
      others.push({
        agent: `a${i}`,
        belief: Math.min(99, Math.max(1, Math.round(center + 12 * gauss(r)))),
        stake: BigInt(5 + Math.floor(r() * 55)),
      });
    }
    const stake = BigInt(5 + Math.floor(r() * 55));
    const truth = Math.min(99, Math.max(1, Math.round(center + 18 * gauss(r))));
    const value = (report: number) => expectedValue([...others, { agent: "liar", belief: report, stake }], "liar", truth, pool);
    const honest = value(truth);
    let best = honest;
    let total = 0;
    for (let report = 1; report <= 99; report += 1) {
      const v = value(report);
      total += v;
      if (v > best) best = v;
    }
    const worth = Number(stake) * 10_000;
    if (best > honest) lieWins += 1;
    gainSum += (best - honest) / worth;
    randomSum += (total / 99 - honest) / worth;
  }
  return {
    trials,
    crowd,
    lieWins,
    meanBestGainPct: (100 * gainSum) / trials,
    meanRandomLiePct: (100 * randomSum) / trials,
  };
}

export interface BlindLie {
  label: string;
  /** Mean change in expected value against telling the truth, as a share of stake. */
  meanPct: number;
}

/**
 * Sealed orders mean nobody knows the book, so the lies that matter are fixed
 * habits: always exaggerate, or always hedge toward 50.
 */
export function blindLieAudit(trials: number, crowd: number, seed: number): BlindLie[] {
  const r = makeRng(seed);
  const habits = [
    { label: "exaggerate by 5 points", shift: 5 },
    { label: "exaggerate by 15 points", shift: 15 },
    { label: "hedge by 5 points", shift: -5 },
    { label: "hedge by 15 points", shift: -15 },
  ];
  const sums = habits.map(() => 0);
  const pool = 40_000n;
  for (let t = 0; t < trials; t++) {
    const center = 8 + r() * 84;
    const others: Order[] = [];
    for (let i = 0; i < crowd; i++) {
      others.push({
        agent: `a${i}`,
        belief: Math.min(99, Math.max(1, Math.round(center + 12 * gauss(r)))),
        stake: BigInt(5 + Math.floor(r() * 55)),
      });
    }
    const stake = BigInt(5 + Math.floor(r() * 55));
    const truth = Math.min(99, Math.max(1, Math.round(center + 18 * gauss(r))));
    const value = (report: number) => expectedValue([...others, { agent: "liar", belief: report, stake }], "liar", truth, pool);
    const honest = value(truth);
    const worth = Number(stake) * 10_000;
    habits.forEach((h, i) => {
      const away = truth >= 50 ? 1 : -1;
      const report = Math.min(99, Math.max(1, truth + away * h.shift));
      sums[i] += (value(report) - honest) / worth;
    });
  }
  return habits.map((h, i) => ({ label: h.label, meanPct: (100 * sums[i]) / trials }));
}

export interface PumpReport {
  trials: number;
  honestPriceError: number;
  pumpedPriceError: number;
  /** Mean whale result per pump, in share values. */
  whaleLossPerPump: number;
  /** Share of pumps that lost the whale money in expectation. */
  losingPumps: number;
}

/** A whale seals 99 on questions whose true chance is low, to pull the answer up. */
export function pumpAttack(trials: number, crowd: number, whaleShare: number, seed: number): PumpReport {
  const r = makeRng(seed);
  let honestErr = 0;
  let pumpedErr = 0;
  let lossSum = 0;
  let losing = 0;
  for (let t = 0; t < trials; t++) {
    const truth = 5 + Math.floor(r() * 30);
    const honest: Order[] = [];
    let crowdStake = 0n;
    for (let i = 0; i < crowd; i++) {
      const stake = BigInt(10 + Math.floor(r() * 50));
      crowdStake += stake;
      honest.push({
        agent: `a${i}`,
        belief: Math.min(99, Math.max(1, Math.round(truth + 8 * gauss(r)))),
        stake,
      });
    }
    const whaleStake = BigInt(Math.max(1, Math.floor(Number(crowdStake) * whaleShare)));
    const c = clear(honest);
    honestErr += Math.abs(c.price - truth);
    const pumped = clear([...honest, { agent: "whale", belief: 99, stake: whaleStake }]);
    pumpedErr += Math.abs(pumped.price - truth);
    const fill = pumped.fills.find((f) => f.agent === "whale")!;
    // In expectation the whale pays the price for something worth `truth`.
    const ev = (Number(fill.filled) * (truth - pumped.price)) / 100;
    lossSum += -ev;
    if (ev < 0) losing += 1;
  }
  return {
    trials,
    honestPriceError: honestErr / trials,
    pumpedPriceError: pumpedErr / trials,
    whaleLossPerPump: lossSum / trials,
    losingPumps: losing / trials,
  };
}
