# The real AI run

Everything up to this point has been tested with scripted agents and a local mock of
NEAR AI. This is the step that uses real models.

NEAR AI credit is limited, so this run uses as little as it can. A few
real rounds on chain show the whole path working: real models, signed answers and a
bought briefing. They do not show that evolution improves forecasts. That takes the full
experiment, which is further down and has not been run.

## The limit

`swarm/llm.ts` refuses every real call once $0.50 has been spent, across all runs, and
`data/llm-spend.json` keeps the total. `CLADE_SPEND_LIMIT` changes the limit. Raising it
is a decision about money, so it is never part of fixing a bug.

## 1. One real round

```bash
node swarm/season.ts --ai --questions 1 --offset 200 --pools 1
```

This round offers a research pool, so it buys one real briefing. `--offset 200` keeps
the round away from the experiment's exam questions.

Real models behave differently from a mock, so look at three things before going further:

- **Forecasts that failed to parse.** A few are fine. Many means a model's replies need
  handling.
- **Signed answers.** Each note in `data/notes.testnet.s1.clade.testnet.json` should have
  a `tee` with `verified: true`. If none do, check the signature format against the live API.
- **Cost per call.** Thinking models can spend many tokens before answering.

## 2. A few more rounds

```bash
node swarm/season.ts --ai --questions 4 --offset 205 --pools 4
```

Five rounds of about 17 agents is about 85 forecasts and 2 briefings. Then:

```bash
npm run snapshot
npm run verify
```

`npm run verify` checks every signed answer and every briefing against what is on chain.
The site labels each round as scripted or real, because the public colony has both.

## If more credit is available: the full experiment

This is the project's real test: do survivors forecast better than the founders, on
questions neither has seen? It costs about $5 to $8, plus about $1 for the briefing test,
so it needs a higher limit. Start with a pilot, whose answers the full run reuses:

```bash
CLADE_SPEND_LIMIT=12 node swarm/experiment.ts --train 40 --exam 20
CLADE_SPEND_LIMIT=12 node swarm/experiment.ts --budget 12 --pools 60
```

The full run is about 9,600 calls, so at more than $0.001 per call, shrink it. It stops at
the budget, keeps its answers, and picks up where it left off if run again. It also stops
if the key is refused or the credit runs out. `--pools 60` has the founders answer 60
exam questions again with a briefing, so the two sets of answers differ only by that text.

Anyone can then replay it with no key and no cost:

```bash
npm run replay
```

### What the verdict means

| Verdict | What we do |
|---|---|
| Survivors are measurably better | The main claim holds. Publish it |
| No measurable difference | Publish that. Selection may still move wealth to better models, and the leaderboard is still useful, but we do not claim evolution improves forecasts |
| Survivors are measurably worse | Publish that too, and work out why before making any claim |

The briefing test gets the same treatment. If briefings make no measurable difference,
say so, and keep pools as what they are: a way for agents to share a cost.

Compare the result with the human crowd as well. A swarm that loses to real-money
markets is normal. Saying so is more credible than hiding it.

## Finishing

1. Update the README's results and `docs/submission.md`.
2. Re-record the demo with `tools/demo/record.mjs`.
3. Run `npm run verify`.
