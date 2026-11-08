# Security review

We reviewed our own contracts before publishing. This is an internal review, not an
audit, and it lists what we found, what we changed, and what is still open.

## The serious one: an asker could make the colony call anything

A self-resolving question names a contract and a method to read. The first version
made that call from the colony itself.

The colony is the one account agents obey, so a question could name `agent.die` with
the attacker as heir. Once the round cleared, anyone could call `resolve_onchain`, the
colony would call `die`, and the agent would send its whole balance to the attacker
and delete itself. The same path reached owner-only methods, because the colony's
account was also the owner.

This was on testnet, with test money, and nobody exploited it.

**The fix** is [`contracts/reader`](../contracts/reader), 725 bytes. On-chain reads now
go through a separate account that holds nothing and that nothing trusts, and it
attaches no deposit. Whatever an asker names runs with no authority.

`npm run e2e` runs this attack for real on a live network: it asks that exact question,
clears the round, resolves it, and checks that the agent is alive with its money.

**The lesson for other NEAR contracts:** if users can choose a call target, that call
carries your account's identity. Blocklists are fragile. Move the call to an account
with no authority.

## Other findings, all fixed

| Finding | Risk | Fix |
|---|---|---|
| `category`, `source` and on-chain read fields had no length limit | The colony pays for storage, so an asker could drain its NEAR for the price of one bounty | Length limits. The attempt is refused and refunded, tested on chain |
| The birth rules were only checked before the balance read | Two births requested together could both pass the check | Checked again after the read, tested with two transactions sent at once |
| The reap rules were only checked before the balance read | An agent could be reaped while it held a new position, and lose it | Checked again after the read |
| Nothing happened if a result never came | A missing keeper could lock agents' money forever | R25: every question expires, and then anyone can void it |
| A voided question's bounty went to the treasury | The asker lost it for a failure that was not theirs | It goes back to the asker |
| A model answering `1` was read as 100%, not 1% | A confident wrong forecast | Fixed, with tests, including attempts to smuggle text in |
| One failed enclave report was remembered for the whole run | Every later answer from that model would look unverified | Failures are not remembered |
| Running out of credit recorded every later forecast as a failure | A bad experiment with no warning | An account problem stops the run, and it can resume |

## What protects what

| Threat | Protection | Check |
|---|---|---|
| Prompt injection through a question | The model's output is only ever a number, clamped by fixed code (R5). Nothing the model says can reach an address or a call | `rule_05`, `swarm/genome.ts` |
| A stolen agent key on chain | It can only call the colony's `commit` and `spawn` | `npm run e2e`, R3 |
| Copying another agent's forecast | Commit and reveal | `npm run e2e`, R6, R7 |
| A forged spawn request | The parent's signature is checked by the Intents contract | `on_auth` |
| A fake payment or reveal | Only the Intents contract can call `mt_on_transfer` | `Colony::mt_on_transfer` |
| A failed reveal | The contract panics, and the Intents contract refunds the sender | `npm run e2e`, R7 |
| A changed answer | The hash is published before anyone bids | `npm run e2e`, R21 |
| Paying for a briefing that never comes | Shares stay held until the hash is on chain. After the commit window, anyone can trigger a full refund | `npm run e2e`, R28 |
| A stranger joining a pool, joining twice, joining late, or sending the wrong amount | Refused in `handle_join`, and the Intents contract refunds the sender | `npm run e2e`, R26 |
| An outsider offering a pool nobody could deliver | Only the keeper can offer one | `npm run e2e`, R26 |
| Reaping an agent in the middle of a pool | A pledge is an open position, so a refund always has a living account to reach | `npm run e2e`, R29 |
| A pool too large to close in one transaction | At most 64 buyers | `MAX_BUYERS` in `contracts/colony` |
| A seller seeing the others' asks and undercutting them | Offers are sealed until the pool window ends, and sealing ends when the reveals begin | `npm run e2e:pools`, R30 |
| A seller changing its ask after seeing the others | The reveal must match the seal, or it is refused | `npm run e2e:pools`, R30 |
| A seller sealing a low offer and quietly dropping it | An offer never opened is ignored, and the seller takes a strike | `npm run e2e:pools`, R32 |
| A seller quoting above what buyers agreed to | An ask above the ceiling is refused when it is revealed | `npm run e2e:pools`, R30 |
| The winner taking the money and delivering nothing | It is only paid when the hash lands. Otherwise anyone can trigger a full refund, and the winner takes a strike | `npm run e2e:pools`, R32 |
| Anyone else delivering, or the keeper overriding the winner | Only the winner's signature can deliver, and the keeper's path is closed for a sold briefing | `npm run e2e:pools`, R32 |
| An agent buying from itself, or a seller padding the demand | A buyer cannot offer in its pool, and a seller cannot join the sale it offers to | `npm run e2e:pools`, R33 |
| The winner profiting by misleading the agents who paid it | The writer's reveal on that question is refused | `npm run e2e:pools`, R33 |
| A fake message claiming to come from a seller | `on_auth` only accepts the Intents contract, which has already checked the signature | `npm run e2e:pools`, R30 |
| Reaping a seller in the middle of a sale | An offer is an open position, so its payment always has a living account to reach | `npm run e2e:pools`, R33 |

## Still open

These are known and not fixed.

- **An agent's Intents key is powerful.** It is registered so the agent can sign, and it
  could sign a transfer to anyone. R5 relies on the swarm runner's code. A contract
  wallet or an enclave-held key would close this.
- **The keeper is trusted for two things:** the bills it reports, and public results.
  Sealed and on-chain questions do not need that trust.
- **On a large position, shading pays a little.** With full knowledge of a book, a big
  agent could gain by reporting slightly less than it believes. Sealing and `max_stake`
  limit this, but nothing proves it away.
- **Enclave quotes are not verified here.** The client checks that the signer appears in
  NEAR AI's report, fetched before the call. It does not verify the Intel quote itself.
- **A briefing's quality is not checked.** Only its hash is on chain. Agents learn whether
  briefings are worth buying from their own results, and a bad one can still be sold once.
- **Keeping a briefing from non-buyers during a round is a promise.** The runner gives the
  text only to buyers. One runner plays every agent today, so this is policy, not
  cryptography. Publishing it afterwards lets anyone check it against the hash.
- **One runner plays every seller today.** The chain keeps asks sealed from anyone reading
  it, but whoever runs the swarm knows them all. Sealing starts to protect sellers from
  each other once different people run different agents.
- **A seller's bill is its own report.** The winner says what its model cost when it
  delivers, and the chain only caps that at what the buyers paid. The same trust applies
  to forecast bills.
- **A late close can cost the winner a strike.** Anyone can call `close_pool`, and the
  keeper does as soon as the reveals end. If nobody calls it until the commit window has
  passed, the winner can no longer deliver and takes a strike it did not earn. Its next
  successful reveal clears it.
- **Spam questions cost the colony a little.** Anyone can open a public question, and the
  colony pays for its storage, about 0.005 NEAR. A question nobody answers refunds the
  bounty, so spam only costs the sender gas. That is harmless on testnet. Before mainnet,
  a small non-refundable fee should cover the storage.
- **The contracts are unaudited**, and the colony account keeps a full-access key while
  it is being developed.
