//! The Clade market rules (RULES.md R7, R9-R11, R15, R17, R18).
//!
//! This crate has no NEAR dependencies, so every rule can be tested natively.
//! `engine/market.ts` implements the same arithmetic in TypeScript, and both are
//! checked against the shared vectors in `data/vectors.json`.

#![cfg_attr(not(test), no_std)]

extern crate alloc;
use alloc::vec::Vec;

/// A share pays this many token units if its side is right.
pub const SHARE_UNITS: u128 = 10_000;
/// One percentage point of a share.
pub const POINT_UNITS: u128 = 100;
/// How many questions of evidence a parent's reputation counts for (R15).
pub const PRIOR_WEIGHT: i128 = 5;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    None,
    Yes,
    No,
}

/// One revealed order. `key` is a stable sort key: the caller sorts orders by
/// account id so leftover shares always go to the same agent.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Order {
    pub belief: u8,
    pub stake: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Fill {
    pub side: Side,
    pub filled: u64,
    pub lock: u128,
    pub cost: u128,
    pub refund: u128,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Clearing {
    /// Zero means nobody revealed and the question is void.
    pub price: u8,
    pub fills: Vec<Fill>,
    pub matched: u64,
}

/// Units an agent must lock for an order (R7).
pub fn lock_for(belief: u8, stake: u64) -> u128 {
    let top = core::cmp::max(belief, 100 - belief) as u128;
    stake as u128 * top * POINT_UNITS
}

/// Stake-weighted median (R9): the lowest price whose stake above is no more
/// than its stake at or below.
pub fn clearing_price(orders: &[Order]) -> u8 {
    if orders.is_empty() {
        return 0;
    }
    let mut by_belief = [0u128; 101];
    let mut total = 0u128;
    for o in orders {
        by_belief[o.belief as usize] += o.stake as u128;
        total += o.stake as u128;
    }
    let mut at_or_below = 0u128;
    for p in 1..=99u8 {
        at_or_below += by_belief[p as usize];
        if total - at_or_below <= at_or_below {
            return p;
        }
    }
    99
}

/// Clears one sealed round (R9-R11). `orders` must already be sorted by account id.
pub fn clear(orders: &[Order]) -> Clearing {
    let price = clearing_price(orders);
    if price == 0 {
        return Clearing { price: 0, fills: Vec::new(), matched: 0 };
    }

    let (mut yes, mut no, mut at) = (0u128, 0u128, 0u128);
    for o in orders {
        if o.belief > price {
            yes += o.stake as u128;
        } else if o.belief < price {
            no += o.stake as u128;
        } else {
            at += o.stake as u128;
        }
    }

    let gap = if yes > no { yes - no } else { no - yes };
    let short_side = if yes > no {
        Side::No
    } else if yes < no {
        Side::Yes
    } else {
        Side::None
    };
    assert!(gap <= at, "stake at the median must cover the gap");

    // R11: split the gap across the agents at the median, in proportion to stake.
    let mut at_shares: Vec<u64> = Vec::with_capacity(orders.len());
    let mut given = 0u128;
    for o in orders {
        let share = if o.belief == price && gap > 0 { gap * o.stake as u128 / at } else { 0 };
        at_shares.push(share as u64);
        given += share;
    }
    // Hand out what floor division left, one share at a time, in account order.
    if gap > 0 {
        for (i, o) in orders.iter().enumerate() {
            if given == gap {
                break;
            }
            if o.belief == price && at_shares[i] < o.stake {
                at_shares[i] += 1;
                given += 1;
            }
        }
        assert!(given == gap, "median fill must close the gap");
    }

    let mut fills = Vec::with_capacity(orders.len());
    let mut matched = 0u64;
    for (i, o) in orders.iter().enumerate() {
        let (side, filled) = if o.belief > price {
            (Side::Yes, o.stake)
        } else if o.belief < price {
            (Side::No, o.stake)
        } else if at_shares[i] > 0 {
            (short_side, at_shares[i])
        } else {
            (Side::None, 0)
        };
        let unit = match side {
            Side::Yes => price as u128,
            Side::No => 100 - price as u128,
            Side::None => 0,
        };
        let cost = filled as u128 * unit * POINT_UNITS;
        let lock = lock_for(o.belief, o.stake);
        if side == Side::Yes {
            matched += filled;
        }
        fills.push(Fill { side, filled, lock, cost, refund: lock - cost });
    }
    Clearing { price, fills, matched }
}

/// Signed edge against the swarm (R15), in percent squared.
pub fn edge_of(belief: u8, price: u8, yes_won: bool) -> i64 {
    let o: i64 = if yes_won { 100 } else { 0 };
    let p = price as i64 - o;
    let b = belief as i64 - o;
    p * p - b * b
}

/// Reward points for one order (R18).
pub fn points_of(belief: u8, stake: u64, price: u8, yes_won: bool) -> u128 {
    let edge = edge_of(belief, price, yes_won);
    if edge > 0 {
        stake as u128 * edge as u128
    } else {
        0
    }
}

/// Reward for one agent, rounded down (R18).
pub fn reward_of(pool: u128, points: u128, total_points: u128) -> u128 {
    if total_points == 0 {
        0
    } else {
        pool * points / total_points
    }
}

/// Winning shares pay in full, losing shares pay nothing (R17).
pub fn payout_of(fill: &Fill, yes_won: bool) -> u128 {
    let winner = if yes_won { Side::Yes } else { Side::No };
    if fill.side == winner {
        fill.filled as u128 * SHARE_UNITS
    } else {
        0
    }
}

/// Reputation (R15), rounded toward negative infinity.
pub fn reputation(edge_sum: i128, questions: u64, prior: i128) -> i128 {
    let num = edge_sum + PRIOR_WEIGHT * prior;
    let den = questions as i128 + PRIOR_WEIGHT;
    num.div_euclid(den)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn o(belief: u8, stake: u64) -> Order {
        Order { belief, stake }
    }

    #[test]
    fn rule_07_lock_covers_the_worst_price() {
        assert_eq!(lock_for(70, 10), 70_000);
        assert_eq!(lock_for(30, 10), 70_000);
    }

    #[test]
    fn rule_09_median_and_tie() {
        assert_eq!(clearing_price(&[o(20, 10), o(60, 10), o(80, 10)]), 60);
        assert_eq!(clearing_price(&[o(20, 100), o(60, 10), o(80, 10)]), 20);
        assert_eq!(clearing_price(&[o(30, 10), o(70, 10)]), 30);
        assert_eq!(clearing_price(&[]), 0);
    }

    #[test]
    fn rule_10_sides_at_one_price() {
        let c = clear(&[o(20, 10), o(50, 20), o(80, 10)]);
        assert_eq!(c.price, 50);
        assert_eq!(c.fills[0].side, Side::No);
        assert_eq!(c.fills[1].side, Side::None);
        assert_eq!(c.fills[2].side, Side::Yes);
        assert_eq!(c.fills[1].refund, c.fills[1].lock);
    }

    #[test]
    fn rule_11_median_fills_the_gap() {
        let c = clear(&[o(40, 5), o(40, 15), o(70, 12)]);
        assert_eq!(c.price, 40);
        assert_eq!(c.fills[0].filled + c.fills[1].filled, 12);
        assert_eq!(c.fills[2].filled, 12);
        assert_eq!((c.fills[0].filled, c.fills[1].filled), (3, 9));
    }

    #[test]
    fn rule_15_reputation() {
        assert_eq!(reputation(0, 0, 300), 300);
        assert_eq!(reputation(1000, 5, 300), 250);
        assert_eq!(reputation(-7, 2, 0), -1);
    }

    #[test]
    fn rule_17_zero_sum_rule_18_points() {
        let c = clear(&[o(20, 10), o(50, 10), o(80, 10)]);
        let paid: u128 = c.fills.iter().map(|f| payout_of(f, true)).sum();
        let cost: u128 = c.fills.iter().map(|f| f.cost).sum();
        assert_eq!(paid, cost);
        assert_eq!(points_of(20, 10, 50, true), 0);
        assert_eq!(points_of(80, 10, 50, true), 10 * (2500 - 400));
    }

    /// The same vectors the TypeScript engine produced, so both must agree.
    #[test]
    fn vectors_match_the_typescript_engine() {
        let raw = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../../data/vectors.txt"))
            .expect("run `npm run vectors` first");
        let mut count = 0;
        for line in raw.lines() {
            // belief:stake,belief:stake | price | matched | side:filled:cost:refund,... | yes payouts | reward points
            let parts: Vec<&str> = line.split('|').collect();
            let orders: Vec<Order> = parts[0]
                .split(',')
                .map(|x| {
                    let mut it = x.split(':');
                    Order { belief: it.next().unwrap().parse().unwrap(), stake: it.next().unwrap().parse().unwrap() }
                })
                .collect();
            let c = clear(&orders);
            assert_eq!(c.price, parts[1].parse::<u8>().unwrap(), "price for {line}");
            assert_eq!(c.matched, parts[2].parse::<u64>().unwrap(), "matched for {line}");
            for (f, want) in c.fills.iter().zip(parts[3].split(',')) {
                let v: Vec<&str> = want.split(':').collect();
                let side = match f.side {
                    Side::Yes => "YES",
                    Side::No => "NO",
                    Side::None => "NONE",
                };
                assert_eq!(side, v[0], "side for {line}");
                assert_eq!(f.filled, v[1].parse::<u64>().unwrap(), "filled for {line}");
                assert_eq!(f.cost, v[2].parse::<u128>().unwrap(), "cost for {line}");
                assert_eq!(f.refund, v[3].parse::<u128>().unwrap(), "refund for {line}");
            }
            for (i, want) in parts[4].split(',').enumerate() {
                assert_eq!(payout_of(&c.fills[i], true), want.parse::<u128>().unwrap());
            }
            for (i, want) in parts[5].split(',').enumerate() {
                assert_eq!(
                    points_of(orders[i].belief, orders[i].stake, c.price, true),
                    want.parse::<u128>().unwrap()
                );
            }
            count += 1;
        }
        assert!(count >= 1000, "expected the full vector file, got {count}");
    }
}
