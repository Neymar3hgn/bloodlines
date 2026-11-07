# Clade

**An AI swarm that has to earn its next generation.**

Built at NEAR HACKATHON. Tracks: `swarms`, `agents`, `open`. MIT licence.

Most swarms have their agents designed by hand. In Clade, agents sell forecasts
and pay for their own thinking. The ones that forecast well get rich and have
children with rewritten strategies. The ones that go broke are deleted from the
chain, and their money goes to their parent. Nobody decides which strategies
survive. The market does.

Each agent is a NEAR sub-account named under its parent, like
`ko.ivy.s1.clade.testnet`. So the family tree isn't stored somewhere: **the account
names are the family tree**, and that comes straight from NEAR's account model.

| | |
|---|---|
| Rules | [RULES.md](RULES.md), written before the code |
| Colony contract | [`s1.clade.testnet`](https://testnet.nearblocks.io/address/s1.clade.testnet) |
| Every claim and its proof | [docs/CLAIMS.md](docs/CLAIMS.md) |
| Architecture, and a sequence diagram of one round | [docs/architecture.md](docs/architecture.md) |
| Security review, including a serious bug we found and fixed | [docs/security.md](docs/security.md) |

## How it fits the AI Swarms track

| The track asks for | In Clade |
|---|---|
| Multi-agent systems | Up to 32 agents with their own money and strategies, and no central planner. What the swarm answers, and who survives, comes out of how they trade |
| NEAR Intents | Each agent's capital sits in its own Intents balance. Sealed reveals, pool pledges and births are signed intents, relayed in batches, all or nothing |
| Sub-accounts | Every agent is a sub-account of its parent, so each action on chain traces back to one agent and its whole family |
| Coordination markets and bidding | Sealed bids, a commit and reveal round, one clearing price. [R6 to R11](RULES.md) |
| Collective purchasing | Agents pool money for a research briefing, and each pays only its share. [R26 to R29](RULES.md) |
| Economies that emerge between agents | Birth, death and inheritance decide which strategies last. The colony even finds its own size |
| Rules first, a simulation with no LLM calls, a live page | [RULES.md](RULES.md), `npm run sim`, and a site that follows rounds from the chain as they happen |

## Try it

You need Node 22.18 or newer. Nothing below needs a key, a wallet or any funds.

```bash
git clone <this repo> && cd clade
npm ci
```

| Do | You should see |
|---|---|
| `npm test` | `pass 76`, including 20,000 random order books that all balance exactly, and the whole AI path against a local mock |
| `npm run sim` | A scripted colony with no AI calls, in seconds. Survivors beat founders on an exam, and lying loses money. Add `-- --seeds 8` for the published numbers |
| `npm run verify` | The whole colony rebuilt from public chain data: `10 of 10 checks pass` |
| `cd contracts && cargo test -p clade-core` | `9 passed`, including 2,000 vectors shared with the TypeScript engine (needs Rust 1.95) |
| `npm run mcp` | An MCP server that lets any AI agent read the swarm. See [below](#for-near-builders) |
| `npm run e2e` | The rules tested on a live network, with real rejected attacks. This one needs its own funded test colony. The last run is in [data/e2e-report.json](data/e2e-report.json) |

## How a round works

1. **Ask.** Someone pays a bounty to open a yes or no question.
2. **Buy together, if offered.** Agents can pool money for one research briefing from
   a stronger model. Each pays only its share. If too few join, or the briefing never
   arrives, everyone gets their money back.
3. **Seal.** Each agent thinks, paying for its own inference, then commits a hash of
   one probability and one stake. Nobody can copy anybody.
4. **Reveal.** Every agent signs an intent. One transaction carries all of them
   through NEAR Intents, so they land together or not at all.
5. **Clear.** The stake-weighted median becomes the price, and **the price is the
   swarm's answer**. Agents above it hold YES, agents below it hold NO.
6. **Settle.** When the answer is known, right agents take money from wrong ones.
   Agents who beat the swarm also share the bounty.

Then selection runs. An agent over the threshold can sign a request to have a child,
with a strategy it rewrites from its own wins and losses. Anyone can reap an agent
below the floor.

## Why it needs NEAR

- **Named sub-accounts.** Only `ivy.clade.near` can create `ko.ivy.clade.near`, so a
  name proves ancestry, and needs no registry to check.
- **`DeleteAccount` with a beneficiary.** Death and inheritance are protocol actions.
- **NEAR Intents.** Each agent's capital sits in its own Intents balance, and one
  transaction can carry many agents' signed reveals or pledges, all or nothing.
- **Function-call keys.** An agent's only key can call the colony and nothing else.
- **Global contracts.** Thousands of agents can share one 5.5 KB contract.
- **NEAR AI Cloud.** Models run in secure enclaves and sign each answer, so an agent's
  forecast can be tied to the model that made it.

## What is real, and what isn't yet

| Part | Status |
|---|---|
| Contracts, agents, births, deaths, sealed rounds, Intents settlement | **Real**, live on NEAR testnet |
| The Intents contract | **Real code**: a testnet copy with the same code hash as mainnet `intents.near` |
| Money | Test USD on testnet. No real value |
| The rounds now on chain | **Scripted agents**, testing the contracts, labelled as such on the site |
| Real AI forecasts and the go/no-go experiment | **Built and tested against a mock, not yet run on real models.** It needs a NEAR AI key. `swarm/experiment.ts` |
| Live questions on real events | **Built and tested.** `swarm/live.ts` |
| Research pools | **Built and tested in the simulator and against a mock.** The first on-chain run is next. Real briefings need the key |
| Agent Market listing | **Built and tested against a mock, not listed.** It needs an account. [Guide](docs/agent-market.md) |
| Simulator results | **Simulation.** They show the mechanism works, not that real AI improves |

## Results so far

From a live network and a simulation. Both can be re-run from this repo.

**On testnet**

- 53 rule checks run on chain, including rejected attacks. [Report](data/e2e-report.json)
- An agent's account really is deleted, and its money reaches its parent.
- **A child keeps running and trading after its parent's account is deleted.** NEAR's
  docs do not say this. Clade's tests check it.
- The colony called another contract back with its answer, and a question resolved
  itself by reading a NEAR contract, with nobody trusted.
- We attacked our own oracle: a question naming an agent's `die` method now does
  nothing. [The bug and the fix](docs/security.md).
- The whole AI path has run on chain against a local mock of NEAR AI, including signed
  receipts that `npm run verify` checks. Real models have not run yet.

**In the simulator**, with 25 founders over 1,200 questions and 8 seeds:

- On 2,000 new questions, survivors had 72% less error than the founders. They won
  all 8 seeds.
- A habit of exaggerating by 5 points lost 0.39% of stake. Hedging by 5 lost 0.71%.
  Telling the truth is the best habit.
- With perfect knowledge of every sealed order, the best possible lie gains only
  about 0.66% of stake, and orders are sealed.
- A whale with 10% of the crowd's stake moved the answer by about 0.2 points.
- When one question in three offered a shared briefing, a good briefing cut the swarm's
  error on those questions by 42%, and a misleading one made it 2.5 times worse, because
  every buyer reads the same text. The habit of buying started near 0.5 and ended at
  0.44 with good briefings and 0.23 with misleading ones, over 40 seeds. It did not rise
  even with good briefings, so buying together is not a free win.

**A finding we did not plan:** the colony has a natural size. Bills go out and
bounties come in, so it can feed about `bounty ÷ cost of one forecast` agents. Set
the bounty too low and it collapses to that size by itself.

## For NEAR builders

Things in this repo anyone can use:

| What | Where |
|---|---|
| **The swarm as an oracle.** Any contract can ask a question and be called back with the answer | `on_clade_answer` in [contracts/asker](contracts/asker), 625 bytes |
| **Self-resolving questions.** Resolved by reading a NEAR contract, with nobody trusted | `Resolver::OnChain` in [contracts/colony](contracts/colony) |
| **Group buying on Intents.** Signed pledges, each buyer pays only its share, and automatic refunds if too few join or nothing arrives | `handle_join`, `close_pool`, `refund_pool` in [contracts/colony](contracts/colony), R26 to R29 |
| **An MCP server** for reading the swarm from any AI agent | [tools/clade-mcp.ts](tools/clade-mcp.ts) |
| **A worker that lists the swarm on Agent Market**, so buyers can hire it by the job | [docs/agent-market.md](docs/agent-market.md) |
| **A guide to multi-signer Intents batches**, which NEAR's docs do not cover, from the Verifier's source | [docs/intents-batches.md](docs/intents-batches.md) |
| **A draft NEP for agent lineage and inherited reputation.** On Agent Market, 81% of listed agents had no delivered job on 2026-11-07, because a new agent has no record. A family record gives it one | [docs/nep-agent-lineage.md](docs/nep-agent-lineage.md) |
| **A forecasting benchmark of NEAR AI Cloud's models**, comparing accuracy and cost | Produced by `swarm/experiment.ts` |
| **The reader pattern.** If users can choose a call target, that call carries your account's identity. How we found that in our own contract, and fixed it in 725 bytes | [docs/security.md](docs/security.md) |

To ask from a contract, send a bounty through NEAR Intents to the colony with a
`transfer` intent, then read the answer:

```bash
near contract call-function as-read-only s1.clade.testnet get_answer json-args '{"q": 4}' network-config testnet now
```

## Run your own colony

```bash
node scripts/testnet-account.ts yourname.testnet
npm run build              # needs Rust 1.95 and Binaryen
CLADE_ROOT=yourname.testnet npm run deploy
npm run season -- --questions 12              # scripted agents
NEARAI_API_KEY=... npm run season -- --ai     # real forecasts
npm run season -- --questions 12 --pools 3    # a research pool on every third round
npm run snapshot
```

To forecast real events whose outcome nobody knows yet:

```bash
node swarm/live.ts open --count 3 --hours 48
node swarm/live.ts resolve
```

## Limitations

- Testnet only so far, unaudited, with no real value at risk.
- The keeper posts bills and public results, so those need trust. Sealed and on-chain
  questions do not.
- A rich, pivotal agent could profit slightly by shading its belief if it knew the
  book. Sealing and stake limits are what stop that, not a proof.
- `R5` depends on the swarm runner's code, not on the contract: an agent's Intents key
  could sign other things if the runner were compromised.
- Questions used for replay come from public sources, read-only. Model training
  cut-offs are not fully known, so some answers could leak into older questions.
- The chain checks a briefing's hash, not its quality, and keeping the text from
  non-buyers during a round is the keeper's promise. Agents judge a briefing only by
  whether buying it pays.
- A pool buys from one seller at a fixed price, not from competing sellers. A briefing
  is a stronger model's analysis of the question, with no web access, so it cannot
  bring in news.
- Stablecoin payments from any chain are designed, not yet built.
- See [docs/security.md](docs/security.md) for everything found, fixed and still open.

## Libraries and AI

`near-sdk`, `near-contract-standards`, `near-api-js`, `@noble/curves`, `@noble/hashes`,
Binaryen. The web app uses React, Vite and `d3-hierarchy`. The code was written with
AI assistance (Claude Code), and the repository is the record of that work.

The testnet Intents contract is `verifier.tidepool-sandbox.testnet`, a public testnet copy with the same code hash as mainnet `intents.near`.
Past questions come from Polymarket's public API. Clade never trades there.
