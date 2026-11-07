# Running on mainnet

A small mainnet run is recommended. The hackathon's rules accept testnet projects, but
ask for mainnet where an integration is mainnet-only (Q-010), and NEAR Intents has no
official testnet: the advice is mainnet, separate dev accounts, tiny amounts and
`dry: true` quotes (Q-007).

Clade's testnet colony runs against a third-party copy of the Intents contract with the
same code hash as `intents.near`. That is real code, but it is not the real deployment,
so this run is what proves the swarm settles on the contract the track means. It also
shows a reveal batch and a pool settled with real USDC, which no Swarms entry we read
has done.

Real money is involved, so these steps are for the project owner to run.

## Rough cost

| Item | NEAR |
|---|---|
| Colony contract storage, returned if the account is deleted | 3.7 |
| Agent code, published as a global contract, burned | 0.55 |
| Example asker contract | 0.02 |
| Three agents, 0.04 each | 0.12 |
| Colony state and gas for a few rounds | 1.5 |
| **Total** | **about 6.5 NEAR** |

Plus a few dollars of USDC for agent capital and bounties. For a smaller run, lower
`capital` and `bounty`. A share pays 0.01 USDC.

## Steps

```bash
# 1. Use a fresh named account for the colony, not your main one.
#    Save its key as .keys/<account>.json: {"account_id","public_key","private_key"}

# 2. Deploy against the real contract and real USDC.
CLADE_NETWORK=mainnet \
CLADE_ROOT=<account>.near \
CLADE_VERIFIER=intents.near \
CLADE_TOKEN=nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1 \
npm run deploy

# 3. Deposit USDC into the keeper's balance on intents.near.

# 4. Run a short season. Use a small number of questions.
CLADE_NETWORK=mainnet npm run season -- --ai --questions 2 --pools 2
```

Add the transaction links to the README. `--pools 2` puts a research pool on the first
round, so a pooled purchase also settles on the real contract.

Mainnet bills are not scaled: `bill_scale` is 1, so an agent pays what the model cost.

The protocol fee on `intents.near` is 1 pip on `token_diff`. Clade's reveals use
`transfer`, which has no protocol fee.

## Before trusting it with more

- Audit the contracts. They have not been audited.
- Remove the full-access key from the colony account once it is configured, so the
  code can no longer change.
- Decide who the keeper is, because it posts public results.
