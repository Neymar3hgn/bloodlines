/**
 * The Clade market rules (RULES.md R9-R11, R15, R17, R18, R20) as pure functions.
 *
 * This file is the reference implementation. The Rust contract in
 * contracts/core implements the same arithmetic, and both are checked against
 * shared test vectors in data/vectors.json. All amounts are bigint units so
 * nothing here depends on floating point.
 */

/** A share pays this many token units if its side is right. */
export const SHARE_UNITS = 10_000n;
/** One percentage point of a share. */
export const POINT_UNITS = 100n;
/** How many questions of evidence a parent's reputation counts for (R15). */
export const PRIOR_WEIGHT = 5n;

export type Side = "YES" | "NO" | "NONE";

export interface Order {
  agent: string;
  /** Sealed probability, 1 to 99. */
  belief: number;
  /** Shares the agent will trade, above zero. */
  stake: bigint;
}

export interface Fill extends Order {
  side: Side;
  /** Shares actually traded. */
  filled: bigint;
  /** Units locked at reveal (R7). */
  lock: bigint;
  /** Units paid for the filled shares. */
  cost: bigint;
  /** lock - cost, returned after clearing. */
  refund: bigint;
}

export interface Clearing {
  /** Clearing price, or 0 when there were no orders (void, R9). */
  price: number;
  fills: Fill[];
  /** Shares matched on each side. YES total always equals NO total. */
  matched: bigint;
}

export interface Settlement {
  rows: {
    agent: string;
    payout: bigint;
    reward: bigint;
    points: bigint;
    /** Signed edge against the swarm, in percent squared (R15). */
    edge: number;
    /** Trading profit in units, before the reward. */
    pnl: bigint;
  }[];
  /** Reward units left after the floor division, plus the whole pool if nobody earned points. */
  dust: bigint;
}

const divideUp = (a: bigint, b: bigint) => (a + b - 1n) / b;

/** What each buyer pays to join a pool (R26): the most it could ever owe. */
export const poolPledge = (price: bigint, minBuyers: number) => divideUp(price, BigInt(minBuyers));

/** What each buyer really pays once the pool closes (R27). */
export const poolShare = (price: bigint, buyers: number) => divideUp(price, BigInt(buyers));

/** Units an agent must lock for an order (R7). */
export function lockFor(belief: number, stake: bigint): bigint {
  return stake * BigInt(Math.max(belief, 100 - belief)) * POINT_UNITS;
}

function compareAgent(a: { agent: string }, b: { agent: string }): number {
  return a.agent < b.agent ? -1 : a.agent > b.agent ? 1 : 0;
}

/** Stake-weighted median (R9): the lowest p whose stake above is no more than its stake at or below. */
export function clearingPrice(orders: Order[]): number {
  if (orders.length === 0) return 0;
  const byBelief = new Array<bigint>(101).fill(0n);
  let total = 0n;
  for (const o of orders) {
    byBelief[o.belief] += o.stake;
    total += o.stake;
  }
  let atOrBelow = 0n;
  for (let p = 1; p <= 99; p++) {
    atOrBelow += byBelief[p];
    if (total - atOrBelow <= atOrBelow) return p;
  }
  return 99;
}

/** Clears one sealed round (R9-R11). */
export function clear(orders: Order[]): Clearing {
  for (const o of orders) {
    if (!Number.isInteger(o.belief) || o.belief < 1 || o.belief > 99) throw new Error(`bad belief ${o.belief}`);
    if (o.stake <= 0n) throw new Error(`bad stake ${o.stake}`);
  }
  const price = clearingPrice(orders);
  if (price === 0) return { price: 0, fills: [], matched: 0n };

  const sorted = [...orders].sort(compareAgent);
  let yes = 0n;
  let no = 0n;
  let at = 0n;
  for (const o of sorted) {
    if (o.belief > price) yes += o.stake;
    else if (o.belief < price) no += o.stake;
    else at += o.stake;
  }

  const gap = yes > no ? yes - no : no - yes;
  const shortSide: Side = yes > no ? "NO" : yes < no ? "YES" : "NONE";
  if (gap > at) throw new Error("invariant: stake at the median must cover the gap");

  // R11: split the gap across the agents at the median, in proportion to stake.
  const atShares = new Map<string, bigint>();
  let given = 0n;
  if (gap > 0n) {
    for (const o of sorted) {
      if (o.belief !== price) continue;
      const share = (gap * o.stake) / at;
      atShares.set(o.agent, share);
      given += share;
    }
    // Hand out what floor division left, one share at a time, in account order.
    for (const o of sorted) {
      if (given === gap) break;
      if (o.belief !== price) continue;
      const cur = atShares.get(o.agent) ?? 0n;
      if (cur < o.stake) {
        atShares.set(o.agent, cur + 1n);
        given += 1n;
      }
    }
    if (given !== gap) throw new Error("invariant: median fill must close the gap");
  }

  const fills: Fill[] = sorted.map((o) => {
    let side: Side;
    let filled: bigint;
    if (o.belief > price) {
      side = "YES";
      filled = o.stake;
    } else if (o.belief < price) {
      side = "NO";
      filled = o.stake;
    } else {
      filled = atShares.get(o.agent) ?? 0n;
      side = filled > 0n ? shortSide : "NONE";
    }
    const unit = side === "YES" ? BigInt(price) : side === "NO" ? BigInt(100 - price) : 0n;
    const cost = filled * unit * POINT_UNITS;
    const lock = lockFor(o.belief, o.stake);
    return { ...o, side, filled, lock, cost, refund: lock - cost };
  });

  const matched = fills.filter((f) => f.side === "YES").reduce((s, f) => s + f.filled, 0n);
  return { price, fills, matched };
}

/** Signed edge against the swarm (R15), in percent squared. */
export function edgeOf(belief: number, price: number, yesWon: boolean): number {
  const o = yesWon ? 100 : 0;
  return (price - o) ** 2 - (belief - o) ** 2;
}

/** Pays out a resolved question (R17, R18). */
export function settle(c: Clearing, yesWon: boolean, rewardPool: bigint): Settlement {
  const winner: Side = yesWon ? "YES" : "NO";
  const rows = c.fills.map((f) => {
    const edge = edgeOf(f.belief, c.price, yesWon);
    const payout = f.side === winner ? f.filled * SHARE_UNITS : 0n;
    const points = edge > 0 ? f.stake * BigInt(edge) : 0n;
    return { agent: f.agent, payout, reward: 0n, points, edge, pnl: payout - f.cost };
  });
  const totalPoints = rows.reduce((s, r) => s + r.points, 0n);
  let paid = 0n;
  if (totalPoints > 0n) {
    for (const r of rows) {
      r.reward = (rewardPool * r.points) / totalPoints;
      paid += r.reward;
    }
  }
  return { rows, dust: rewardPool - paid };
}

/** Money in equals money out for one question (R20). Throws if it does not. */
export function checkConservation(c: Clearing, s: Settlement, rewardPool: bigint, bills: bigint, treasuryCut: bigint): void {
  const moneyIn = c.fills.reduce((t, f) => t + f.lock, 0n) + rewardPool + treasuryCut + bills;
  const moneyOut =
    c.fills.reduce((t, f) => t + f.refund, 0n) +
    s.rows.reduce((t, r) => t + r.payout + r.reward, 0n) +
    s.dust +
    treasuryCut +
    bills;
  if (moneyIn !== moneyOut) throw new Error(`conservation broken: in ${moneyIn}, out ${moneyOut}`);
}

/**
 * Reputation (R15): (sum of edges + 5 x prior) / (questions + 5), rounded toward
 * negative infinity so the contract and this function always agree.
 */
export function reputation(edgeSum: bigint, questions: bigint, prior: bigint): bigint {
  const num = edgeSum + PRIOR_WEIGHT * prior;
  const den = questions + PRIOR_WEIGHT;
  const q = num / den;
  return num % den !== 0n && num < 0n ? q - 1n : q;
}
