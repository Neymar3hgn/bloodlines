# Multi-signer batches on NEAR Intents

NEAR's docs show one user and one market maker. The contract can do much more:
one `execute_intents` call can carry intents signed by many different accounts,
and they all land or all fail. Clade settles every round this way, so this guide
writes down what we had to learn from the source. Everything here was tested on a
live Verifier with the same code hash as `intents.near`.

Working code: [`swarm/intents.ts`](../swarm/intents.ts).

## What is true, and where it comes from

| Fact | Source |
|---|---|
| `execute_intents` has no access control, only a pause flag. Anyone can relay. | `contracts/defuse/src/contract/intents/mod.rs` |
| Any bad signature, deadline or nonce fails the whole batch. | `engine/mod.rs`: `execute_signed_intents` returns an error, and the contract panics |
| A three-party swap is covered by NEAR's own tests. | `tests/.../token_diff.rs`: `swap_many` |
| `token_diff` balances must net to zero per token across the batch. | `engine/state/deltas.rs` |
| The protocol fee is 1 pip on mainnet, charged on negative `token_diff` deltas. `transfer` has none. | `fee()` view, `intents/token_diff.rs` |
| A `transfer` with a `msg` calls `mt_on_transfer` on the receiver. If that panics, the sender is refunded. | `intents/tokens.rs`, `tokens/nep245/resolver.rs` |
| `auth_call` passes the signer's identity to any contract, with a relayer paying the gas. | `intents/auth.rs` |

## Signing

Each payload is a NEP-413 message:

```json
{
  "standard": "nep413",
  "payload": { "message": "<json string>", "nonce": "<base64, 32 bytes>", "recipient": "intents.near" },
  "public_key": "ed25519:...",
  "signature": "ed25519:..."
}
```

`message` is `{"signer_id", "deadline", "intents": [...]}`, and `deadline` is an
RFC 3339 time.

The signed bytes are `sha256(tag || borsh(message, nonce, recipient, callback_url))`,
where `tag` is `2147484061` as a little-endian u32 and `callback_url` is `None`.

## Nonces

Random 32-byte nonces still work, but the contract's comments say they will go
away. Use the versioned layout:

| Bytes | Field |
|---|---|
| 4 | Magic prefix `5628f6c6` |
| 1 | Version, `0` |
| 4 | Salt, from the `current_salt` view |
| 8 | Deadline in nanoseconds, little-endian i64 |
| 15 | Random |

The intent's `deadline` must not be later than the nonce's.

## Named accounts need a registered key

Implicit accounts work straight away. A named account must first call
`add_public_key` on the Verifier, attaching 1 yoctoNEAR. Clade's agent contract
does this in its constructor, so an agent can sign from the moment it is born.

## Gas: how many signers fit in one transaction

A transaction has 300 Tgas. Each `transfer` with a `msg` reserves its own `min_gas`
(at least 5 Tgas, 30 by default if you leave it out) plus about 15 Tgas for the
Verifier's resolve callback. At 9 Tgas of `min_gas`, Clade runs 8 reveals per
transaction. If you leave `min_gas` unset, you will fit far fewer.

## Using agents with almost no NEAR

Reserving 300 Tgas of prepaid gas needs about 0.3 NEAR in the signer's account on
testnet, even though most of it is refunded. Agents hold about 0.04 NEAR, so they
cannot send large transactions themselves. Instead an agent signs an `auth_call`:

```json
{ "intent": "auth_call", "contract_id": "clade.testnet", "msg": "{...}", "min_gas": "260000000000000" }
```

A relayer submits it and pays the gas. The Verifier has checked the signature, so
when the colony's `on_auth(signer_id, msg)` runs, `signer_id` is proven. This is
how Clade agents reproduce.

## Testing without real money

There is no official Intents testnet, but `verifier.tidepool-sandbox.testnet`, a public
testnet copy, has the same code hash as `intents.near`
(`BtA1BEFNS619KkvXFsgcpQ21Tb5yMm32aaUkn7xNothk`). Check it yourself with
`view_account`. The fee there is zero, and any NEP-141 token can be deposited, so
you can use your own test token.

`simulate_intents` is also a view method, which takes the same payloads and needs
no gas.
