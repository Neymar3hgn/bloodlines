/**
 * The sealed sale of R30 to R33 on its own: 20 scripted buyers, 5 scripted sellers and
 * no model calls. The arithmetic comes from engine/market.ts, the same numbers the
 * contract's rules are tested against.
 */
import { poolPledge, poolShare, winningOffer } from "../engine/market.ts";
import { makeRng } from "./world.ts";

export interface AuctionParams {
  seed: number;
  rounds: number;
  buyers: number;
  sellers: number;
  /** R30: the most a briefing can cost. */
  ceiling: bigint;
  minBuyers: number;
}

export const AUCTION_DEFAULTS: AuctionParams = { seed: 1, rounds: 600, buyers: 20, sellers: 5, ceiling: 40_000n, minBuyers: 4 };

export type BuyerPlan = "steady" | "thrifty" | "moody";
export type SellerPlan = "climber" | "undercut" | "fixed" | "random" | "flaky";

const BUYER_PLANS: BuyerPlan[] = ["steady", "thrifty", "moody"];
/** The climber comes first, so a market of one seller is a climber with no rivals. */
const SELLER_PLANS: SellerPlan[] = ["climber", "undercut", "fixed", "random", "flaky"];
/** What writing one briefing costs each seller, before the round's noise. */
const BASE_COST = [9_000, 7_500, 8_000, 12_000, 6_500];
const BUYER_START = 10_000_000n;
const FLAKY_NO_REVEAL = 0.15;
const FLAKY_NO_DELIVERY = 0.1;

interface Buyer {
  id: string;
  plan: BuyerPlan;
  /** What one briefing is worth to this buyer. */
  value: bigint;
  chance: number;
  money: bigint;
  paid: bigint;
  joined: number;
  bought: number;
}

interface Seller {
  id: string;
  plan: SellerPlan;
  baseCost: number;
  markup: number;
  money: bigint;
  wins: number;
  income: bigint;
  bills: bigint;
  strikes: number;
}

export interface SealedOffer {
  seller: string;
  cost: bigint;
  ask: bigint;
  revealed: boolean;
}

export type RoundResult = "bought" | "no-delivery" | "too-few" | "no-offer";

export interface AuctionRound {
  n: number;
  buyers: number;
  pledge: bigint;
  offers: SealedOffer[];
  winner: string | null;
  ask: bigint;
  share: bigint;
  result: RoundResult;
}

export interface AuctionBucket {
  from: number;
  price: number;
  buyers: number;
  share: number;
  bought: number;
}

export interface SellerStanding {
  id: string;
  plan: SellerPlan;
  wins: number;
  income: bigint;
  bills: bigint;
  profit: bigint;
  strikes: number;
}

export interface BuyerStanding {
  plan: BuyerPlan;
  count: number;
  joined: number;
  paid: bigint;
  meanShare: number;
}

export interface AuctionReport {
  params: AuctionParams;
  pledge: bigint;
  rounds: AuctionRound[];
  buckets: AuctionBucket[];
  sellers: SellerStanding[];
  buyers: BuyerStanding[];
  counts: Record<RoundResult, number>;
  /** Over the last third of the rounds, once the sellers have settled down. */
  latePrice: number;
  lateBuyers: number;
  lateShare: number;
  conservationErrors: number;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const up = (x: number) => BigInt(Math.ceil(x));

export function runAuction(p: AuctionParams): AuctionReport {
  const r = makeRng(p.seed);
  const pledge = poolPledge(p.ceiling, p.minBuyers);
  const buyers: Buyer[] = Array.from({ length: p.buyers }, (_, i) => ({
    id: `buyer-${i + 1}`,
    plan: BUYER_PLANS[i % BUYER_PLANS.length],
    value: BigInt(1_500 + Math.floor(r() * 4_500)),
    chance: 0.2 + r() * 0.6,
    money: BUYER_START,
    paid: 0n,
    joined: 0,
    bought: 0,
  }));
  const sellers: Seller[] = Array.from({ length: p.sellers }, (_, i) => ({
    id: `seller-${i + 1}`,
    plan: SELLER_PLANS[i % SELLER_PLANS.length],
    baseCost: BASE_COST[i % BASE_COST.length],
    markup: 0.5,
    money: 0n,
    wins: 0,
    income: 0n,
    bills: 0n,
    strikes: 0,
  }));
  const total = BUYER_START * BigInt(p.buyers);
  let treasury = 0n;
  let lastPrice = 0n;
  let lastShare = 0n;
  let conservationErrors = 0;
  const rounds: AuctionRound[] = [];

  for (let n = 0; n < p.rounds; n++) {
    // Buyers find each other: each one decides alone, and the pool is whoever came.
    const pool = buyers.filter((b) => {
      if (b.money < pledge) return false;
      if (b.plan === "steady") return true;
      if (b.plan === "thrifty") return lastShare <= b.value;
      return r() < b.chance;
    });
    for (const b of pool) {
      b.money -= pledge;
      b.joined++;
    }

    // R30: each seller seals what it would charge, and most of them reveal it.
    const offers: SealedOffer[] = sellers.map((s) => {
      const cost = s.baseCost * (0.9 + 0.2 * r());
      let ask: number;
      if (s.plan === "climber") ask = cost * (1 + s.markup);
      else if (s.plan === "undercut") ask = lastPrice > 0n ? Math.max(cost * 1.05, Number(lastPrice) - 150) : cost * 1.5;
      else if (s.plan === "fixed") ask = cost * 1.5;
      else if (s.plan === "random") ask = cost * (1 + r() * 1.2);
      else ask = cost * 1.2;
      const capped = up(ask) < p.ceiling ? up(ask) : p.ceiling;
      return { seller: s.id, cost: up(cost), ask: capped, revealed: !(s.plan === "flaky" && r() < FLAKY_NO_REVEAL) };
    });
    for (const o of offers) {
      if (!o.revealed) sellers.find((s) => s.id === o.seller)!.strikes++;
    }

    // R31: the cheapest revealed offer wins, and the buyers split it.
    const best = pool.length >= p.minBuyers ? winningOffer(offers.filter((o) => o.revealed)) : null;
    let result: RoundResult = pool.length < p.minBuyers ? "too-few" : "no-offer";
    let share = 0n;
    if (best) {
      share = poolShare(best.ask, pool.length);
      const held = share * BigInt(pool.length);
      for (const b of pool) b.money += pledge - share;
      const seller = sellers.find((s) => s.id === best.seller)!;
      const cost = offers.find((o) => o.seller === best.seller)!.cost;
      if (seller.plan === "flaky" && r() < FLAKY_NO_DELIVERY) {
        // R32: it won and did not deliver, so every buyer gets its share back.
        for (const b of pool) b.money += share;
        seller.strikes++;
        result = "no-delivery";
      } else {
        // R32: the winner keeps what the buyers paid, less the bill for its own thinking.
        const bill = cost < held ? cost : held;
        seller.money += held - bill;
        seller.income += held;
        seller.bills += bill;
        seller.wins++;
        treasury += bill;
        for (const b of pool) {
          b.paid += share;
          b.bought++;
        }
        result = "bought";
        lastPrice = best.ask;
        lastShare = share;
      }
    } else {
      // R27, R31: too few buyers or no offer, so every pledge goes back.
      for (const b of pool) b.money += pledge;
    }

    for (const s of sellers) {
      if (s.plan !== "climber") continue;
      const won = result === "bought" && best?.seller === s.id;
      s.markup = Math.min(8, Math.max(0.02, s.markup * (won ? 1.08 : 0.92)));
    }

    const inBuyers = buyers.reduce((t, b) => t + b.money, 0n);
    const inSellers = sellers.reduce((t, s) => t + s.money, 0n);
    if (inBuyers + inSellers + treasury !== total) conservationErrors++;

    rounds.push({ n, buyers: pool.length, pledge, offers, winner: result === "bought" ? best!.seller : null, ask: best?.ask ?? 0n, share, result });
  }

  const size = Math.max(1, Math.floor(p.rounds / 6));
  const buckets: AuctionBucket[] = [];
  for (let from = 0; from < p.rounds; from += size) {
    const part = rounds.slice(from, from + size);
    const sold = part.filter((x) => x.result === "bought");
    buckets.push({
      from,
      price: mean(sold.map((x) => Number(x.ask))),
      buyers: mean(part.map((x) => x.buyers)),
      share: mean(sold.map((x) => Number(x.share))),
      bought: sold.length / part.length,
    });
  }

  const late = rounds.slice(-Math.floor(p.rounds / 3));
  const lateSold = late.filter((x) => x.result === "bought");
  const counts: Record<RoundResult, number> = { bought: 0, "no-delivery": 0, "too-few": 0, "no-offer": 0 };
  for (const x of rounds) counts[x.result]++;

  return {
    params: p,
    pledge,
    rounds,
    buckets,
    sellers: sellers
      .map((s) => ({ id: s.id, plan: s.plan, wins: s.wins, income: s.income, bills: s.bills, profit: s.income - s.bills, strikes: s.strikes }))
      .sort((a, b) => b.wins - a.wins || a.id.localeCompare(b.id)),
    buyers: BUYER_PLANS.map((plan) => {
      const group = buyers.filter((b) => b.plan === plan);
      const bought = group.reduce((t, b) => t + b.bought, 0);
      const paid = group.reduce((t, b) => t + b.paid, 0n);
      return { plan, count: group.length, joined: group.reduce((t, b) => t + b.joined, 0), paid, meanShare: bought ? Number(paid) / bought : 0 };
    }),
    counts,
    latePrice: mean(lateSold.map((x) => Number(x.ask))),
    lateBuyers: mean(late.map((x) => x.buyers)),
    lateShare: mean(lateSold.map((x) => Number(x.share))),
    conservationErrors,
  };
}
