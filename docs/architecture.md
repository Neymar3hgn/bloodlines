# Architecture

## One round

```text
Asker      Agents            Keeper        Intents contract        Colony
  |           |                 |                  |                  |
  | bounty, signed `transfer` with msg {"ask": ...}|                  |
  |------------------------------------------------>  mt_on_transfer ->| question opens
  |           |                 |                  |                  |
  |           | think: one sealed belief and stake |                  |
  |           |                                                       |
  |           |-- commit(sha256(q:agent:belief:stake:salt)) ---------->| R6, own key, own gas
  |           |                                                       |
  |           |   commit window ends                                  |
  |           |                 |                  |                  |
  |           |-- signed reveal ->| batch of signed intents           |
  |           |                 |-- execute_intents ->                | R7, all or nothing
  |           |                 |                  |-- mt_on_transfer ->| one per reveal
  |           |                 |                  |                  |
  |           |                 |-- clear(q) ------------------------->| R9-R11 price is the median
  |           |                 |                  |                  |-- on_clade_answer -> asker contract (R22)
  |           |                 |-- resolve -------------------------->| R21 sealed, public or on-chain
  |           |                 |-- settle(q) ------------------------>| R17, R18 payouts and rewards
  |           |                 |-- sweep(accounts) ------------------>|
  |           |                 |                  |<-- mt_transfer ---| money back to agents' balances
```

## A round with a research pool

```text
Keeper                Agents            Intents contract        Colony
  |                      |                     |                  |
  |-- question, with a pool, signed `transfer` ->| mt_on_transfer ->| R26 price, minimum buyers, window
  |                      |                     |                  |
  |<-- signed pledge ----|                     |                  |
  |-- execute_intents ------------------------>| mt_on_transfer ->| R26 one per buyer, all or nothing
  |                      |                     |                  |
  |   the pool window ends                     |                  |
  |-- close_pool(q) ------------------------------------------->| R27 share = price / buyers, the rest refunded
  |                      |                     |                  |     too few buyers: every pledge refunded
  | a stronger model writes the briefing       |                  |
  |-- post_briefing(q, sha256(text)) -------------------------->| R28 shares go to the treasury
  |-- the text --------->| buyers only, until the round is over   |
  |                      |                     |                  |
  |                      | think, seal, reveal and clear, as above|
  |                      |                     |                  |
  | if no hash arrives before the commit window closes:           |
  |   anyone: refund_pool(q) -------------------------------->| R28 nobody pays
```

## One life

```text
                 spawn: parent signs auth_call, keeper relays
                                   |
                                   v
Intents --on_auth(signer)--> Colony: alive? no strike? rich enough? room? name fits?
                                   |
                                   |  create_child, with NEAR for storage
                                   v
                            Parent's contract
                                   |  CreateAccount, Transfer, UseGlobalContract,
                                   |  new(), AddKey (function-call key on the colony only)
                                   v
                            Child account  <-- endowment, via Intents mt_transfer

An on-chain question, resolve_onchain(q), anyone can call:
Colony --read--> Reader, which has no authority --any contract and method the asker named
   |                                                         |
   <------------------- on_oracle(the number) <--------------+

reap(agent), anyone can call:
Colony: no open positions? --> read Intents balance --> below floor, or three strikes?
   |
   v
Agent contract: send credits to the heir, then delete the account, with its NEAR to the heir.
```

## Who holds what

| Thing | Where it lives | Who controls it |
|---|---|---|
| An agent's capital | Its own balance on NEAR Intents | The agent's signing key, used only by fixed code (R5) |
| Stakes during a round | The colony's balance on NEAR Intents | The colony contract's rules |
| Pledges during a pool | The colony's balance on NEAR Intents | The colony contract's rules, and they come back unless a briefing's hash is on chain |
| An agent's native NEAR | Its own account | Nobody: there is no full-access key |
| The family record | Colony state | Written only by the contract |
| Agent code | One global contract, 5.5 KB | Immutable once published |

## Why these choices

**Why the median?** Because an agent seals one number, there is no order book to
game, and every question gets an answer even when all the agents agree. Moving the
price means taking the other side of everyone who disagrees. The simulator measures
what lying earns: a habit of exaggerating or hedging loses money.

**Why seal the forecasts?** Copying kills research. If agents could see each other's
answers, the cheapest strategy would be to copy, and nobody would pay to think.

**Why buy one briefing together?** A stronger model costs about twenty forecasts, so few
agents would pay for it alone. Split among ten, it costs each about two. But every buyer
then reads the same text, and a wrong briefing misleads them all at once, which sealing
cannot average out. So buying is a habit in the genome, not a rule: the briefing gives no
probability of its own, each agent still forms its own view, and an agent that buys
badly loses to one that does not.

**Why a global contract for agents?** A colony might create thousands of agents. Each
one is under 0.001 NEAR of reference storage instead of carrying its own copy of the
code.

**Why no SDK in the agent contract?** A global contract burns 10 NEAR per 100 KB. The
same logic was 153 KB with near-sdk (15 NEAR) and is 5.5 KB without it (0.55 NEAR).

**Why does the colony have a natural size?** Bills go out and bounties come in, so
the colony can feed about `bounty / cost of one forecast` agents. Nobody sets that
number. Too many agents and they starve, which frees up bounty for the rest.
