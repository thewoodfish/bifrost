# @bifrost/sdk

The off-chain half of the protocol: waits for Attestcoin to attest a Sepolia block,
builds the Merkle + continuity proof, and drives the Creditcoin pool engine with it.

```bash
npm install
npm run bifrost -- status
```

## Commands

| | |
|---|---|
| `status` | supported source chains and live attestation lag |
| `lock <portfolioId> <usd>` | register, value and lock on Sepolia |
| `prove <txHash>` | wait for attestation, print the proof |
| `open <txHash>` | prove, dry-run, open the credit line |
| `draw <portfolioId> <usd>` | draw against an open line |
| `line <portfolioId>` | show a credit line |

## Config

Reads `../.env` (see `.env.example`). Needs `ORIGIN_VAULT`, `POOL_ENGINE`, and signers.

Two keys, because the protocol depends on them being different:

| role | env | signs |
|---|---|---|
| borrower | `KEYSTORE_ACCOUNT` + `KEYSTORE_PASSWORD` (or `PRIVATE_KEY`) | `registerPortfolio`, `lockPortfolio`, and everything on Creditcoin |
| valuer | `VALUER_KEYSTORE_ACCOUNT` + `VALUER_KEYSTORE_PASSWORD` (or `VALUER_PRIVATE_KEY`) | `setValuation` on Sepolia only |

The valuer falls back to the borrower key when unconfigured — fine locally, but against
a deployment with real role separation it surfaces as a `NotValuer` revert rather than
silently letting the borrower price its own collateral. The valuer needs Sepolia gas
only; it never touches Creditcoin.

## Notes

- **Attestation runs 8-20 minutes behind the source head.** That is a property of the
  protocol, not a timeout to tune. `open` blocks for it; `status` shows the current lag.
- **`open` dry-runs before submitting.** `previewIngest` is a staticcall that returns a
  reason string. Worth it: `attestAndOpenCredit` consumes the receipt on first success,
  and a revert after the precompile has run still costs gas.
- **`txBytes` from the prover is passed through untouched.** It is
  `abi.encode(uint8 txType, bytes[] chunks)` with the receipt last — the engine decodes
  the lock event out of it on-chain. See `contracts/src/lib/AttestedTx.sol`.
