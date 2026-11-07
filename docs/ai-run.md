# The real AI run

Everything up to this point has been tested with scripted agents and a local mock of
NEAR AI. This is the step that uses real models, and it can be run once the key is set.

## 1. A small pilot

Real models behave differently from a mock, so check them first.

```bash
node swarm/experiment.ts --train 40 --exam 20
```

Answers are saved as they arrive, so nothing here is wasted: the full run reuses them.

Look at three things before going further:

- **Forecasts that failed to parse.** A few are fine. Many means a model's replies need
  handling.
- **Signed answers.** `verifiedReceipts` should be close to the number of calls on models
  that sign. If it is zero, check the signature format against the live API.
- **Cost per call.** Thinking models can spend many tokens before answering. The full
  run is about 9,600 calls, so at more than $0.001 per call, shrink it.

## 2. The experiment

```bash
node swarm/experiment.ts --budget 12 --pools 60
```

It stops at the budget, keeps its answers, and picks up where it left off if run again.
It also stops if the key is refused or the credit runs out.

`--pools 60` adds a second test, for about $1: the founders answer 60 exam questions
again with a briefing, so the two sets of answers differ only by that text.

Anyone can then replay it with no key and no cost:

```bash
npm run replay
```

## 3. What the verdict means

| Verdict | What we do |
|---|---|
| Survivors are measurably better | The main claim holds. Publish it |
| No measurable difference | Publish that. Selection may still move wealth to better models, and the leaderboard is still useful, but we do not claim evolution improves forecasts |
| Survivors are measurably worse | Publish that too, and work out why before making any claim |

The briefing test gets the same treatment. If briefings make no measurable difference,
say so, and keep pools as what they are: a way for agents to share a cost.

Compare the result with the human crowd as well. A swarm that loses to real-money
markets is normal. Saying so is more credible than hiding it.

## 4. A real season on chain

Deploy a fresh colony, so the real run is not mixed with scripted rounds:

```bash
CLADE_ROOT=s2.clade.testnet node scripts/deploy.ts
node swarm/season.ts --ai --questions 30 --offset 200 --pools 3
node swarm/live.ts open --ai --count 5 --hours 72 --pool 60
```

`--offset 200` keeps the season away from the exam questions.

Then `node swarm/live.ts resolve` once those events finish, followed by `npm run snapshot`.
The site's scripted banner turns off by itself once real reasoning is in the data.

## 5. Finishing

1. Update the README's results and `docs/submission.md`.
2. Re-record the demo with `tools/demo/record.mjs`.
3. Run `npm run verify`. It also checks every signed answer against its receipt on chain.
