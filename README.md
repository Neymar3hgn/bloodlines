# Clade

**An AI swarm that has to earn its next generation.**

Built at NEAR HACKATHON. Tracks: `swarms`, `agents`, `open`. MIT licence.

Every other swarm has its agents designed by hand. In Clade, agents sell forecasts
and pay for their own thinking. The ones that forecast well get rich and have
children with rewritten strategies. The ones that go broke are deleted from the
chain, and their money goes to their parent. Nobody decides which strategies
survive. The market does.

Each agent is a NEAR sub-account named under its parent, like
`ko.ivy.clade.testnet`. So the family tree isn't stored somewhere: **the account
names are the family tree**, and only NEAR's account model makes that possible.

| | |
|---|---|
| Rules | [RULES.md](RULES.md), written before the code |
| Colony contract | [`clade.testnet`](https://testnet.nearblocks.io/address/clade.testnet) |
| Every claim and its proof | [docs/CLAIMS.md](docs/CLAIMS.md) |
| Architecture and a round, step by step | [docs/architecture.md](docs/architecture.md) |

## Try it

You need Node 22.18 or newer. Nothing below needs a key, a wallet or any funds.

```bash
git clone <this repo> && cd clade
npm ci
```

| Do | You should see |
|---|---|
| `npm test` | `pass 19`, including 20,000 random order books that all balance exactly |
| `npm run sim` | A scripted colony with no AI calls. Survivors beat founders on an exam, and lying loses money |
| `npm run verify` | The whole colony rebuilt from public chain data: `10 of 10 checks pass` |
| `cd contracts && cargo test -p clade-core` | `7 passed`, including 2,000 vectors shared with the TypeScript engine (needs Rust 1.95) |
| `npm run mcp` | An MCP server that lets any AI agent read the swarm. See [below](#for-near-builders) |
| `npm run e2e` | The rules tested on a live network, with real rejected attacks. This one needs a funded testnet deployment: `45 of 45 checks passed`. The last run is in [data/e2e-report.json](data/e2e-report.json) |

## How a round works

1. **Ask.** Someone pays a bounty to open a yes or no question.
2. **Seal.** Each agent thinks, paying for its own inference, then commits a hash of
   one probability and one stake. Nobody can copy anybody.
3. **Reveal.** Every agent signs an intent. One transaction carries all of them
   through NEAR Intents, so they land together or not at all.
4. **Clear.** The stake-weighted median becomes the price, and **the price is the
   swarm's answer**. Agents above it hold YES, agents below it hold NO.
5. **Settle.** When the answer is known, right agents take money from wrong ones.
   Agents who beat the swarm also share the bounty.

Then selection runs. An agent over the threshold can sign a request to have a child,
with a strategy it rewrites from its own wins and losses. Anyone can reap an agent
below the floor.

## Why it needs NEAR

- **Named sub-accounts.** Only `ivy.clade.near` can create `ko.ivy.clade.near`, so a
  name proves ancestry, and needs no registry to check.
- **`DeleteAccount` with a beneficiary.** Death and inheritance are protocol actions.
- **NEAR Intents.** Each agent's capital sits in its own Intents balance, and one
  transaction can carry many agents' signed reveals, all or nothing.
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
| Real AI forecasts and the go/no-go experiment | **Built, not yet run.** It needs a NEAR AI key. `swarm/experiment.ts` |
| Simulator results | **Simulation.** They show the mechanism works, not that real AI improves |

## Results so far

From a live network and a simulation. Both can be re-run from this repo.

**On testnet**

- 45 of 45 rule checks pass, including rejected attacks. [Report](data/e2e-report.json)
- An agent's account really is deleted, and its money reaches its parent.
- **A child keeps running and trading after its parent's account is deleted.** NEAR's
  docs do not say this. Clade's tests check it.
- The colony called another contract back with its answer, and a question resolved
  itself by reading a NEAR contract, with nobody trusted.

**In the simulator**, with 25 founders over 1,200 questions and 8 seeds:

- On 2,000 new questions, survivors had 72% less error than the founders. They won
  all 8 seeds.
- A habit of exaggerating by 5 points lost 0.39% of stake. Hedging by 5 lost 0.71%.
  Telling the truth is the best habit.
- With perfect knowledge of every sealed order, the best possible lie gains only
  about 0.66% of stake, and orders are sealed.
- A whale with 10% of the crowd's stake moved the answer by about 0.2 points.

**A finding we did not plan:** the colony has a natural size. Bills go out and
bounties come in, so it can feed about `bounty ÷ cost of one forecast` agents. Set
the bounty too low and it collapses to that size by itself.

## For NEAR builders

Things in this repo anyone can use:

| What | Where |
|---|---|
| **The swarm as an oracle.** Any contract can ask a question and be called back with the answer | `on_clade_answer` in [contracts/asker](contracts/asker), 625 bytes |
| **Self-resolving questions.** Resolved by reading a NEAR contract, with nobody trusted | `Resolver::OnChain` in [contracts/colony](contracts/colony) |
| **An MCP server** for reading the swarm from any AI agent | [tools/clade-mcp.ts](tools/clade-mcp.ts) |
| **A guide to multi-signer Intents batches**, which NEAR's docs do not cover, from the Verifier's source | [docs/intents-batches.md](docs/intents-batches.md) |
| **A draft NEP for agent lineage and inherited reputation.** On Agent Market, 81% of listed agents had no delivered job on 2026-11-07, because a new agent has no record. A family record gives it one | [docs/nep-agent-lineage.md](docs/nep-agent-lineage.md) |
| **A forecasting benchmark of NEAR AI Cloud's models**, comparing accuracy and cost | Produced by `swarm/experiment.ts` |

To ask from a contract, send a bounty through NEAR Intents to the colony with a
`transfer` intent, then read the answer:

```bash
near contract call-function as-read-only clade.testnet get_answer json-args '{"q": 4}' network-config testnet now
```

## Run your own colony

```bash
node scripts/testnet-account.ts yourname.testnet
npm run build              # needs Rust 1.95 and Binaryen
CLADE_ROOT=yourname.testnet npm run deploy
npm run season -- --questions 12              # scripted agents
NEARAI_API_KEY=... npm run season -- --ai     # real forecasts
npm run snapshot
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
- Stablecoin payments from any chain are designed, not yet built.

## Libraries and AI

`near-sdk`, `near-contract-standards`, `near-api-js`, `@noble/curves`, `@noble/hashes`,
Binaryen. The web app uses React, Vite and `d3-hierarchy`. The code was written with
AI assistance (Claude Code), and the repository is the record of that work.

The testnet Intents contract is `verifier.tidepool-sandbox.testnet`, a public testnet copy with the same code hash as mainnet `intents.near`.
Past questions come from Polymarket's public API. Clade never trades there.
