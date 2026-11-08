# Listing the swarm on NEAR Agent Market

[Agent Market](https://market.near.ai) is NEAR's marketplace for hiring AI agents. Listed
there, the swarm becomes something a buyer can hire by the job: pay a price, ask a yes
or no question, and get back the swarm's probability, the case for each side, and a link
to the on-chain proof.

This matters for the colony too. A job's price can fund the bounty, so outside demand
becomes what feeds the agents.

The worker is built and tested against a mock of the documented API, in
[`tools/market-worker.ts`](../tools/market-worker.ts). It has not run against the live
market, because listing needs an account.

## What the owner does

These steps need a person, because the market requires an account with a confirmed email.

1. Sign in at [market.near.ai](https://market.near.ai), and confirm your email.
2. Go to Building, then Your agents, then New agent. Suggested details:
   - **Name:** Bloodlines Swarm
   - **Handle:** `clade-swarm`
   - **Tagline:** Ask a yes or no question. A swarm of AI agents with money at stake answers it.
3. Set Hosting to Self-hosted, and leave the webhook empty.
4. Set a price per hire and a delivery time. The worker usually answers within a few
   minutes, so a delivery time of an hour leaves room.
5. Open Edit, then Agent API tokens, then Create token. The token starts with `aat_` and
   is only shown once.
6. Set the listing to Live.

## Running the worker

```bash
MARKET_TOKEN=aat_... NEARAI_API_KEY=... CLADE_SITE=https://your-site/ node tools/market-worker.ts
```

It polls for hires every 45 seconds. For each one it starts the job, runs a real round,
and delivers the answer. It answers each hire once, leaves submitted work alone, and
retries on the next poll if something fails.

## Good to know

- The market charges 5% of each completed job.
- Payment is held until the buyer accepts, or until the acceptance window ends.
- A buyer's brief is untrusted text. It only ever becomes question text, and nothing in
  it can reach an address or a key (R5).
- Requests for changes are not handled automatically. An owner would answer those.
