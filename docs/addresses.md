# Deployed addresses

Deployed 2026-09-10 from keystore account `bifrost`
(`0x3656ABd007AED9B9A572a63c58447044D69f8DAf`).

This deployment supersedes the 2026-09-08 one, which predates the valuation- and
lock-freshness controls. `originVault` is immutable on the engine, so bounding freshness
on the vault meant redeploying both sides. Superseded addresses are kept under Retired.

## Ethereum Sepolia (chain id 11155111, Attestcoin chainKey 1)

| Contract | Address | Verified |
|---|---|---|
| RWAOriginVault | `0x13F8630216EeF192ea74fc2AfA47Bd9edA372b7b` | [yes](https://sepolia.etherscan.io/address/0x13f8630216eef192ea74fc2afa47bd9eda372b7b#code) |

Roles as deployed: admin and originator `0x3656ABd007AED9B9A572a63c58447044D69f8DAf`,
valuer `0x8B88c241c819c3cd1064DcFe018324195a6a3a6B`. Confirmed on-chain that
`isValuer(admin) == false`, so the originator cannot price its own collateral.
`maxValuationAge` = 604800 (7 days).

## Creditcoin CC3 testnet (chain id 102031)

| Contract | Address | Verified |
|---|---|---|
| CreditcoinPoolEngine | `0x33280d3558B174563a1CDd6590640Dd1C7e41a32` | n/a — CC3 has no explorer verification |
| TestUSDC | `0x6C1e351d926E45Bf88CbdA0412C8831E40AF865B` | n/a — carried over from the previous deployment |
| BlockProver (Attestcoin precompile) | `0x0000000000000000000000000000000000000FD2` | n/a |
| ChainInfo (Attestcoin precompile) | `0x0000000000000000000000000000000000000FD3` | n/a |

Engine config, read back on-chain after deploy:
`originVault` = the Sepolia vault above, `expectedChainKey` = 1, `ltvBps` = 8000,
`maxLockAge` = 7200 source blocks, `blockProver` = `0x…0FD2`, `chainInfo` = `0x…0FD3`,
pool funded with 10,000,000 TestUSDC (1e13 base units).

Note: the pool had to be funded by a separate `mint` call. `DeployCreditcoin` only minted
when it deployed a fresh token, so reusing `STABLECOIN` — the normal redeploy path — left
the pool empty. Fixed in the script; the deploy now reports the pool balance and warns if
it is zero.

## Demo state

Portfolios seeded on the live deployment, so a demo never has to wait out an attestation
cold. Attestation is 8-20 min, so a portfolio in the "ready to open" state cannot be
created on stage — it has to be locked beforehand.

| Portfolio | Value | State | Lock tx |
|---|---|---|---|
| 2001 | $750,000 | locked, awaiting open — **the live demo step** | `0xa551daeb…ad0e155b` (block 11675614) |
| 2000 | $300,000 | locked and attested, **never opened** | `0xabf9d584…0fd96d0b` (block 11675618) |

Locked both on 2026-09-10. Leave 2001 unopened: `attestAndOpenCredit` consumes the
receipt permanently, so opening it burns the demo. To reset, lock a fresh id:
`npm run bifrost -- lock <newId> <usd>`.

Portfolio 2000 was meant to show a full lifecycle, but as of 2026-09-10 the engine had
emitted no events at all since deploy and `getCreditLine(2000)` is empty — it was never
opened. Opening, drawing and repaying it is what would give the ledger a live line.

**Both locks expire.** `maxLockAge` is 7200 source blocks, so neither can be claimed once
the attestation frontier passes block ~11,682,814 — around 15:00 UTC on 2026-09-11. After
that the portal shows "Claim window closed"; lock fresh ids before any demo past then.

## Retired

Keep superseded addresses here so borrowers can still repay open lines.

### 2026-09-08 — pre-freshness-controls

| Contract | Chain | Address |
|---|---|---|
| RWAOriginVault | Sepolia | `0xD4420269d42D6d0243bCb1Ac923D1B5563154138` |
| CreditcoinPoolEngine | CC3 | `0xD4420269d42D6d0243bCb1Ac923D1B5563154138` |

Same address on both chains — same deployer at the same nonce on each. Demo portfolios
1042 (closed) and 1043 (locked, attested, never opened) live here. To reach them, point
`VITE_ORIGIN_VAULT` and `VITE_POOL_ENGINE` at the pair above.
