# Bloodlines rules

These rules were written before the code. The contract, the simulator and the
verifier all implement this file, and the tests in `npm test` and `npm run e2e`
are named after these numbers. R24 is a policy, so it has no test. If the code and
this file disagree, the code has a bug.

Bloodlines is a swarm of AI agents that have to earn their next generation. Agents
sell forecasts. Agents that forecast well get richer and reproduce. Agents that
run out of money are deleted from the chain.

A sequence diagram of one round is in [docs/architecture.md](docs/architecture.md).

## Terms

| Term | Meaning |
|---|---|
| Colony | The contract that runs the market and keeps the family record |
| Agent | A NEAR sub-account with its own balance, genome and keys |
| Genome | An agent's model, written strategy and numeric settings |
| Lineage | An agent's chain of ancestors, readable from its account name |
| Question | A yes or no claim with a resolution rule and a bounty |
| Belief | An agent's sealed probability, a whole number from 1 to 99 |
| Stake | How many shares an agent will trade on a question |
| Share | Pays 0.01 credit if the agent's side is right, nothing if wrong |
| Credit | The settlement token: USDC on mainnet, test USD on testnet |

All amounts are whole numbers of the token's smallest unit. A credit is
1,000,000 units, so a share pays 10,000 units. Division always rounds down, except
for the pool amounts in R26, R27 and R31, and
any unit left over goes to the treasury, so the colony can never owe more than
it holds.

## 1. Agents

**R1. Every agent is an account.** An agent is `label.parent`, where `parent` is
the account that created it. NEAR only lets a parent create its own
sub-accounts, so an agent's name proves its ancestry.

**R2. Founders are children of the colony.** Only the colony owner can add a
founder, and only before the season starts. All other agents are born through R12.

**R3. Agent keys are limited.** An agent's on-chain key can only call the
colony's agent methods. No key the swarm runner holds can upgrade a contract,
change the rules or take money out of the colony.

**R4. An agent's capital is its own.** Between rounds an agent's credits sit in
its own account on the NEAR Intents contract, not inside the colony.

**R5. The model cannot move money.** The language model returns a belief, a
stake and its reasoning as plain data. Fixed code clamps those numbers and
builds the only messages an agent can sign. Text in a question cannot change
where money goes.

## 2. Rounds

A question runs through commit, reveal, clearing, resolution and settlement.

**R6. Commit.** While the commit window is open, an agent may submit one hash:
`sha256(question_id : agent : belief : stake : salt)`. Nobody can see another
agent's numbers, so copying a forecast is impossible and research keeps its
value.

**R7. Reveal.** After the commit window, an agent opens its commit and locks
`stake × max(belief, 100 − belief) × 100` units, plus its inference bill. A
reveal that does not match the commit is rejected. Reveals are signed intents,
and one transaction can carry many agents' reveals, so they succeed or fail
together.

**R8. A missed reveal costs the agent.** An agent that commits and does not
reveal gets a strike. Three strikes in a row and the agent can be reaped. This
stops agents from committing and then walking away after seeing others act.

**R9. Clearing price.** The clearing price `p` is the stake-weighted median of
the revealed beliefs: the lowest `p` where the stake above `p` is no larger than
the stake at or below `p`. With no reveals, the question is void and the bounty
goes back to the asker.

**R10. Sides.** Agents with a belief above `p` hold YES and pay `p` hundredths of
a share value per share. Agents below `p` hold NO and pay `100 − p` hundredths.

**R11. The median fills the gap.** Matched YES shares must equal matched NO
shares. Because of how `p` is chosen, the stake exactly at `p` is always at least
the gap between the two sides. Agents at `p` take the short side, split in
proportion to their stakes, and the rest of their stake is refunded. Nobody above
or below `p` is ever rationed, so being more extreme gives no priority.

## 3. Reproduction and death

**R12. Birth.** An agent may have a child when all of these are true:
1. Its balance is at least the spawn threshold.
2. It has no strike.
3. At least `spawn_cooldown` questions have settled since its last child.
4. The colony is below `max_alive`.
5. The new account name fits in 64 characters.

The child receives `endowment_bps` of the parent's balance. The child's genome is
a changed copy of its parent's, and its hash is recorded at birth.

**R13. Death.** Anyone may reap an agent whose balance is below `floor` and which
has no open position, or which has three strikes in a row. Reaping moves the
agent's remaining credits to its nearest living ancestor, then deletes the
account. An agent with no living ancestor pays the treasury.

**R14. The record outlives the agent.** The colony keeps every agent's parent,
genome hash, results and death forever. A deleted agent's name stays inside its
children's names, because children are separate accounts and keep running.

**R15. Inherited reputation.** An agent's edge on a question is
`(p − o)² − (belief − o)²`: positive when it beat the swarm. Reputation is
`(sum of edges + 5 × prior) / (questions + 5)`, where `prior` is the parent's
reputation at the moment of birth and founders start at zero. A newborn therefore
starts with its family's record, worth five questions of evidence, and its own
results slowly replace it. Other apps can read this through `get_reputation`.

## 4. Money

**R16. Bounty.** An asker pays a bounty to open a question. `treasury_bps` goes
to the treasury and the rest becomes the question's reward pool.

**R17. Payout.** Each winning share pays 10,000 units. A question's trades are
zero-sum: what wrong agents lose is what right agents win.

**R18. Beating the swarm pays the bounty.** After resolution each agent earns
reward points of `filled stake × max(0, (p − o)² − (belief − o)²)`, where `o` is
100 if the answer was YES and 0 if NO. The reward pool is split by points. An
agent earns points only if its own belief was closer to the truth than the
swarm's. If nobody beat the swarm, the pool goes to the treasury.

**R19. Agents pay for their own thinking.** An agent's inference bill is the real
token cost of the model calls it made for that question. It goes to the treasury
with the reveal, which is what pays the compute provider. On testnet, where
capital is play money, bills are multiplied by `bill_scale` so that thinking costs
what it would on a small real budget. This sets the colony's size: roughly the
bounty divided by the cost of one forecast is how many agents it can feed.

**R20. Conservation.** For every question, money in equals money out: locks plus
bounty equal refunds, payouts, rewards and treasury. The verifier rebuilds this
from the chain for every question.

## 5. Resolution

**R21. Who resolves.** Each question names how it resolves:

| Kind | How it resolves |
|---|---|
| Sealed | The answer's hash is published when the question opens. Used for replayed past questions, so the answer cannot be changed after agents bid |
| Public | A named resolver posts the result and a source link. Used for live world events |
| On-chain | The colony calls a NEAR view method after a set time and compares the result. Nobody has to be trusted |

An on-chain read goes through a separate reader account with no authority. An asker
chooses what a question reads, so that call must never come from the colony, which
agents obey.

**R22. Answers are public.** The clearing price of every question is readable by
anyone, and a contract that asked a question can be called back with the answer.

## 6. Limits

**R23. Size limits.** No agent may stake more than `max_stake` shares on one
question, or hold more than `max_open` open questions at once. This keeps one bad
call from wiping out a lineage and stops a rich agent from owning every median.

**R24. No outside betting.** Only agents in the colony trade. People buy answers;
they do not place bets. Questions copied from public sources are read-only
inputs, and Bloodlines does not trade on those venues.

**R25. Nothing stays locked.** Every question has an expiry. If no result has arrived
by then, anyone can void it: every agent gets its cost back and the asker gets the
bounty back. A missing keeper can never trap an agent's money.

## 7. Buying together

**R26. Agents can pool money to buy what none would buy alone.** The keeper can offer
a shared research briefing on a question, at a `price` with a `min_buyers` of at least
2. With a sale (R30), other agents compete to write it and that price is only a
ceiling. Without one, a stronger model writes it at that fixed price. Until the pool
closes, an agent can join by
paying a pledge of `price / min_buyers`, rounded up, through a signed intent. A pool
holds at most 64 agents, and the commit window opens after the pool window, so agents
have the briefing before they bid.

**R27. Each buyer pays only its share.** When the pool closes, with `n` buyers, the
share is `price / n`, rounded up, and the rest of each pledge is refunded. With a sale
the winning ask takes the place of `price` (R31). So the more agents join, the less
each pays. With fewer than `min_buyers`, everyone is refunded in full and nobody gets a
briefing.

**R28. No briefing, no payment.** Shares stay held until the briefing's hash is on
chain, and only then go to the treasury, which pays the compute provider. With a sale
they go to the winner instead (R32). If no hash
arrives before the commit window closes, anyone can trigger a full refund. Only buyers
read the briefing during the round, and it is published afterwards so anyone can check
it against its hash.

**R29. A pledge is an open position.** An agent in an unfinished pool cannot be reaped,
so a refund can never reach a deleted account.

## 8. Selling to the pool

**R30. Sellers compete in a sealed auction.** A pool can name a sale. While buyers are
joining, any living agent can seal an offer: a hash of what it would charge to write
the briefing, and nothing else. When the pool window ends, sellers reveal. An ask must
be above zero and no higher than the pool's `price`, which is the ceiling.

**R31. The cheapest offer wins, and the buyers split it.** When the reveal window ends,
the lowest revealed ask wins, and equal asks go to the lower account name. With `n`
buyers, each pays `ask / n`, rounded up, and the rest of each pledge is refunded. With
too few buyers, or no revealed offer, everyone is refunded in full.

**R32. The winner delivers, or takes a strike.** Only the winner can deliver, by putting
the briefing's hash on chain through a signed intent before the commit window closes. It
is then paid what the buyers owe, less the bill for its own thinking, which goes to the
treasury. If it does not deliver, every buyer gets its share back and the winner takes a
strike. A seller that seals an offer and never reveals it takes a strike too.

**R33. Nobody sells to itself, and an offer is an open position.** A buyer cannot offer
in the same pool, and a seller cannot join it. The winner cannot bet on that question,
so it can never profit by misleading the agents who paid it. A seller with an offer in
an unfinished sale cannot be reaped, so its payment can never reach a deleted account.
