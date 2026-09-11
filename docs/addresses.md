# Deployed addresses

Vault deployed 2026-09-10, pool engine redeployed 2026-09-11 with the lender side (LP
shares, interest, reserve factor), both from keystore account `bifrost`
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
| CreditcoinPoolEngine | `0xBD39e340a43A5693Ae55E0E77b707558Fe67F3e8` (block 5469076) | n/a — CC3 has no explorer verification |
| TestUSDC | `0x6C1e351d926E45Bf88CbdA0412C8831E40AF865B` | n/a — carried over from the previous deployment |
| BlockProver (Attestcoin precompile) | `0x0000000000000000000000000000000000000FD2` | n/a |
| ChainInfo (Attestcoin precompile) | `0x0000000000000000000000000000000000000FD3` | n/a |

Engine config, read back on-chain after deploy:
`originVault` = the Sepolia vault above, `expectedChainKey` = 1, `ltvBps` = 8000,
`maxLockAge` = 7200 source blocks, `borrowRateBps` = 800 (8% APR), `reserveFactorBps` =
2500 (25% of interest to protocol reserves), `blockProver` = `0x…0FD2`, `chainInfo` =
`0x…0FD3`. Seeded with 10,000,000 TestUSDC through `deposit` as the first LP (deployer
holds 1e19 shares), deposit tx `0x01c973fa…d85a6c`.

Note: the seed deposit in `DeployCreditcoin` ran out of gas on CC3 (Foundry's local gas
estimate, 149,468, versus 210,756 actually used — CC3 prices storage writes higher) and
was resent with `cast send --gas-limit`. Pass `--gas-estimate-multiplier 200` to
`forge script` on CC3 to avoid it.

## Demo state

As of 2026-09-11 ~12:15 UTC. Attestation is 8-20 min, so a portfolio in the "ready to
claim" state cannot be created on stage — lock it beforehand.

| Portfolio | Value | State | Lock tx |
|---|---|---|---|
| 3001 | $500,000 | locked and attested, **unclaimed — the live demo step** (expires ~12:40 UTC 2026-09-12, frontier past block 11,688,949) | `0x4796af22…377c6432` (block 11681749) |
| 2000 | $300,000 | **active line**, opened from the portal (Rabby): $240,000 limit, drew $100,000, repaid $25,000 ($0.0152 interest, then principal) | `0xabf9d584…0fd96d0b` (block 11675618) |
| 2001 | $750,000 | locked and attested, unclaimed | `0xa551daeb…ad0e155b` (block 11675614) |

Leave 3001 unopened: `attestAndOpenCredit` consumes the receipt permanently, so opening it
burns the demo. To reset, lock a fresh id: `npm run bifrost -- lock <newId> <usd>`, then
wait for attestation (`npm run bifrost -- status`).

**Claim windows.** `maxLockAge` is 7200 source blocks past attestation. 2001 stops being
claimable once the frontier passes block ~11,682,814 (around 15:30 UTC 2026-09-11); 3001
once it passes 11,688,949 (around 12:40 UTC 2026-09-12, ±15 min, at the 12.3 s block time
measured on 2026-09-11). Lock fresh ids before any demo past then.
2000's line is already open, so its window no longer matters.

## Retired

### 2026-09-10 engine — before the lender side

| Contract | Chain | Address |
|---|---|---|
| CreditcoinPoolEngine | CC3 | `0x33280d3558B174563a1CDd6590640Dd1C7e41a32` |

Funded by a direct mint, no LP shares or interest. It never opened a line. Replaced only
on the Creditcoin side: the vault is unchanged, so locks made against it stay claimable
on the new engine.

Keep superseded addresses here so borrowers can still repay open lines.

### 2026-09-08 — pre-freshness-controls

| Contract | Chain | Address |
|---|---|---|
| RWAOriginVault | Sepolia | `0xD4420269d42D6d0243bCb1Ac923D1B5563154138` |
| CreditcoinPoolEngine | CC3 | `0xD4420269d42D6d0243bCb1Ac923D1B5563154138` |

Same address on both chains — same deployer at the same nonce on each. Demo portfolios
1042 (closed) and 1043 (locked, attested, never opened) live here. To reach them, point
`VITE_ORIGIN_VAULT` and `VITE_POOL_ENGINE` at the pair above.
