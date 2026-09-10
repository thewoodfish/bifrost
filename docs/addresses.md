# Deployed addresses

Deployed 2026-09-08 from keystore account `bifrost`
(`0x3656ABd007AED9B9A572a63c58447044D69f8DAf`).

Note: the vault on Sepolia and the engine on CC3 share the address
`0xD4420269d42D6d0243bCb1Ac923D1B5563154138` — same deployer at the same nonce on each
chain. They are different contracts on different chains. Check which chain you are on
before assuming a config value is wrong.

## Ethereum Sepolia (chain id 11155111, Attestcoin chainKey 1)

| Contract | Address | Verified |
|---|---|---|
| RWAOriginVault | `0xD4420269d42D6d0243bCb1Ac923D1B5563154138` | [yes](https://sepolia.etherscan.io/address/0xd4420269d42d6d0243bcb1ac923d1b5563154138#code) |

Roles as deployed: admin and originator `0x3656ABd007AED9B9A572a63c58447044D69f8DAf`,
valuer `0x8B88c241c819c3cd1064DcFe018324195a6a3a6B`. Confirmed on-chain that
`isValuer(admin) == false`, so the originator cannot price its own collateral.

## Creditcoin CC3 testnet (chain id 102031)

| Contract | Address | Verified |
|---|---|---|
| CreditcoinPoolEngine | `0xD4420269d42D6d0243bCb1Ac923D1B5563154138` | n/a — CC3 has no explorer verification |
| TestUSDC | `0x6C1e351d926E45Bf88CbdA0412C8831E40AF865B` | n/a |
| BlockProver (Attestcoin precompile) | `0x0000000000000000000000000000000000000FD2` | n/a |

Engine config, read back on-chain after deploy:
`originVault` = the Sepolia vault above, `expectedChainKey` = 1, `ltvBps` = 8000,
`blockProver` = `0x…0FD2`, pool funded with 10,000,000 TestUSDC (1e13 base units).

## Demo state

Portfolios seeded on the live deployment, so a demo never has to wait out an attestation
cold. Attestation is 8-20 min, so a portfolio in the "ready to open" state cannot be
created on stage — it has to be locked beforehand.

| Portfolio | Value | State | Lock tx |
|---|---|---|---|
| 1042 | $250,000 | closed — opened, drawn, fully repaid | `0x4d5d6add…85c2c1` (block 11664110) |
| 1043 | $500,000 | locked, awaiting open — the live demo step | `0xf338ebeb…926861` (block 11675121) |

Locked 1043 on 2026-09-10. Leave it unopened: `attestAndOpenCredit` consumes the receipt
permanently, so opening it burns the demo. To reset, lock a fresh id:
`npm run bifrost -- lock <newId> <usd>`.

## Retired

Keep superseded engine addresses here so borrowers can still repay open lines.

_None yet._
