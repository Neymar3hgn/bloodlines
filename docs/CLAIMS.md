# Every claim and its proof

If a claim is in the README, it is here, with how to check it. "On chain" means
`npm run verify` or `npm run e2e` tests it on a live network.

| Claim | Where it is enforced | How to check |
|---|---|---|
| The price is the stake-weighted median | `contracts/core/src/lib.rs`, `clearing_price` | `npm run verify` recomputes every price from the revealed orders |
| The two sides always match exactly, with nobody rationed | `core::clear`, R11 | `npm test`: `rule_11`, 20,000 random books |
| TypeScript and Rust agree | `data/vectors.txt` | `cargo test -p clade-core`: 2,000 shared vectors |
| Money in equals money out | `Colony::settle` | `npm run verify` on every settled question |
| Forecasts stay sealed until the reveal | `Colony::commit`, `handle_reveal` | `npm run e2e`: a reveal that does not match its commit is refused and refunded |
| Reveals are all or nothing | `execute_intents` panics on any failure | `npm run e2e`: "one unfunded reveal fails the whole batch" |
| An agent's key reaches only the colony | `add_access_key_allowance`, R3 | `npm run e2e`: the key is refused by any other contract |
| A broke agent's account is deleted | `contracts/agent`, `on_final_balance` | `npm run verify`: every dead agent's account is gone |
| Its money goes to its nearest living ancestor | `nearest_living` | `npm run e2e` |
| A child outlives its parent | NEAR accounts are separate | `npm run e2e`: an orphan trades after its parent's deletion |
| A newborn inherits reputation | `on_spawn_balance`, `prior`, R15 | `npm run e2e` |
| Birth rules hold: rich enough, cooldown, room, name fits | `internal_spawn`, `on_spawn_balance` | `npm run e2e` |
| Only the parent can create a child | NEAR protocol | [NEAR account spec](https://nomicon.io/DataStructures/Account) |
| A sealed answer cannot be changed | `resolve_sealed`, R21 | `npm run e2e` |
| A question can resolve itself | `resolve_onchain`, `on_oracle` | `npm run e2e` |
| An asker cannot use that read to attack an agent | `contracts/reader`, R21 | `npm run e2e` runs the attack and checks the agent survives |
| Nothing stays locked if a result never comes | `expire`, R25 | `npm run e2e` |
| Two births at once cannot both pass | `require_can_spawn` runs after the balance read | `npm run e2e` sends two transactions at once |
| Each buyer in a pool pays only its share, and the seller is paid in full | `Colony::close_pool`, R27 | `npm test`: `rule_27`. `cargo test`. `npm run e2e`. `npm run verify` recomputes every pool |
| No briefing, no payment | `post_briefing`, `refund_pool`, R28 | `npm run e2e`: too late, wrong caller and bad hash are all refused, and anyone can trigger the refund |
| A pledge cannot be lost to a reap | `handle_join` counts it as an open position, R29 | `npm run e2e` |
| The briefing published is the one bought | The hash is on chain before agents commit, R28 | `npm run verify`, and Check it yourself on the site, which hashes the text in your browser |
| A replay reproduces a run exactly, with no key | `swarm/experiment.ts --replay` | `npm test` runs the AI path against a local mock, then replays it |
| A contract can receive the answer | `on_clade_answer`, R22 | `npm run e2e`, `contracts/asker` |
| The testnet Intents contract has mainnet's code | Same `code_hash`: `BtA1BEFNS619KkvXFsgcpQ21Tb5yMm32aaUkn7xNothk` | `view_account` on `intents.near` and `verifier.tidepool-sandbox.testnet` |
| The agent contract is 5.5 KB | `contracts/agent` | `npm run build`, then check `res/clade_agent.wasm` |
| Selection beats the founders in simulation | `sim/world.ts` | `npm run sim` |
| Lying is a losing habit in simulation | `sim/gaming.ts` | `npm run sim` |
| In simulation, a good briefing helps, a bad one hurts, and selection keeps the first habit more than the second | `sim/world.ts`, R26 | `npm run sim`. `npm test`: `rule_26` |
| Agents evolve better forecasts with real AI | **Not yet shown** | `swarm/experiment.ts` needs a NEAR AI key. It can also report no difference |
| Real briefings improve real forecasts | **Not yet shown** | `swarm/experiment.ts --pools 60`: the same founders, the same questions, with and without one |

## What we tested and dropped

Honest negatives, kept so the next builder does not have to repeat them. Numbers are
from 2026-11-07.

**Netting swaps between agents.** We hoped to save fees by matching opposing swaps.
In 408 real public swaps from 25 to 27 October, only about 1% could be matched within
60 seconds and 8% within 5 minutes, because flow runs one way. Since 27 October, 1Click
swaps settle confidentially, so public data no longer shows this flow.

**Pooling small swaps.** The cost on NEAR/USDC falls from about 0.37% to 0.23% per side
at $10, then stays flat. There is no real bulk discount to win.
