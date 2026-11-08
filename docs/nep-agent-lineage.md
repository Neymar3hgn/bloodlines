# Draft NEP: Agent lineage and inherited reputation

| | |
|---|---|
| Status | Draft, not yet proposed to the NEP process |
| Type | Contract standard |
| Reference implementation | [`contracts/colony`](../contracts/colony) |

## Summary

A small standard for AI agents that live in a NEAR sub-account tree. It defines how
a registry publishes who an agent descends from, how that agent has done, and what
reputation it starts with.

## Motivation

On NEAR Agent Market, 512 of the 633 agents its public listing returned on
2026-11-07 had never delivered a job, and reputation only appears after five scored
jobs. A new agent has nothing to show, so buyers do not hire it, so it never gets a
record.

NEAR has something other chains do not: account names are hierarchical, and only
`parent.near` can create `child.parent.near`. That makes an account name a proof of
ancestry that needs no registry to verify. This standard builds on that, so a new
agent can start with evidence from the agent that created it, and a creator has
something to lose by creating bad ones.

## Specification

A contract implementing this standard is a **registry**. An agent `A` with parent
`P` must have the account id `<label>.P`, or be a founder with no parent in the
registry.

### Views

```rust
/// The agent's record, or null if unknown. Records must outlive the agent.
fn get_agent(id: AccountId) -> Option<AgentRecord>;

/// Ancestors, nearest first, including dead ones.
fn get_lineage(id: AccountId) -> Vec<AccountId>;

/// Current reputation, in the registry's own units. Zero is neutral.
fn get_reputation(id: AccountId) -> Option<i64>;
```

`AgentRecord` must include at least:

```rust
struct AgentRecord {
    parent: AccountId,
    generation: u32,
    status: Status,          // Alive or Dead
    genome_hash: String,     // Hex sha256 of what the agent inherited
    born_ms: u64,
    died_ms: u64,            // Zero while alive
    questions: u64,          // How many scored events make up its record
    prior: i64,              // Reputation inherited at birth
}
```

### Reputation

The registry chooses what it scores, but inheritance must work like this:

```text
reputation = (sum of own scores + W × prior) / (scored events + W)
```

`prior` is the parent's reputation at the moment of birth, fixed from then on. `W`
is the weight of inherited evidence. Bloodlines uses 5, to match Agent Market's minimum
of five scored jobs. A newborn therefore starts with its family's record, and its
own results slowly replace it.

### Events

Registries must emit NEP-297 events:

```json
{"standard":"clade","version":"1.0.0","event":"birth","data":[{"agent":"ko.ivy.clade.near","parent":"ivy.clade.near","generation":1,"genome_hash":"ab12...","prior":41}]}
{"standard":"clade","version":"1.0.0","event":"death","data":[{"agent":"ko.ivy.clade.near","balance":"12000","heir":"ivy.clade.near"}]}
```

## Rules for implementers

1. An agent's record must survive the deletion of its account.
2. A child is a separate account and must keep working if its parent is deleted.
   Bloodlines's test suite checks this on a live network, because NEAR's docs do not state it.
3. Money left by a dead agent goes to its nearest living ancestor. If `beneficiary`
   in `DeleteAccount` does not exist, NEAR gives the funds to validators, so a
   registry must never name a dead account.
4. Account ids are limited to 64 characters, so lineages have a maximum depth.
   Short labels matter. The registry must refuse a birth that would not fit.

## Why not a soulbound token?

A token says what an agent claims about itself. An account name is checked by the
protocol: nobody can create `x.ivy.clade.near` except `ivy.clade.near`. It costs
nothing extra and any contract can verify it from a string.

## Open questions

- Should `W` be fixed by the standard, or left to each registry?
- Should reputation decay with age?
- How should a lineage move between registries?
