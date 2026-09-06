# Deployment runbook

Two chains, in order: the vault on **Sepolia**, then the pool on **Creditcoin CC3
testnet** (it needs the vault's address).

| | Sepolia | Creditcoin CC3 |
|---|---|---|
| Chain id | 11155111 | 102031 |
| RPC | `https://ethereum-sepolia-rpc.publicnode.com` | `https://rpc.cc3-testnet.creditcoin.network` |
| Deploys | `RWAOriginVault` | `TestUSDC`, `CreditcoinPoolEngine` |
| Est. cost | ~0.0017 ETH | ~0.0056 CTC |

## Gotchas found the hard way

- **CC3 needs `evm_version = "london"`.** Anything from `paris` up fails with
  `header validation error: prevrandao not set` — CC3's EVM is pre-merge. This is set
  globally in `foundry.toml` so one bytecode works on both chains. Don't "upgrade" it.
- **Attestation takes 8-20 minutes.** Every end-to-end test costs that wall-clock. Budget
  accordingly; it is not tunable.
- **The `PortfolioLocked` event layout is a contract between the two chains.** Changing
  indexed-ness or field order silently breaks decoding on the Creditcoin side. If you
  touch it, redeploy both.

## 0. One-time setup

```bash
cp .env.example .env      # fill in as you go

# Encrypted keystore — do not put a raw key in .env
cast wallet import bifrost --interactive
cast wallet address --account bifrost      # fund this address
```

Faucets:
- Sepolia ETH — https://sepoliafaucet.com or https://faucet.quicknode.com/ethereum/sepolia
- CC3 testnet CTC — Creditcoin Discord faucet channel

Confirm both balances are non-zero before continuing:

```bash
cast balance $(cast wallet address --account bifrost) --rpc-url $SEPOLIA_RPC_URL
cast balance $(cast wallet address --account bifrost) --rpc-url $CREDITCOIN_RPC_URL
```

## 1. Sepolia — RWAOriginVault

```bash
cd contracts
forge script script/DeployOrigin.s.sol \
  --rpc-url $SEPOLIA_RPC_URL --account bifrost --broadcast --verify
```

Deploying with the default roles makes the broadcaster admin, originator *and* valuer.
That is fine for a demo but collapses the originator/valuer separation the protocol
depends on — set `ORIGINATOR` and `VALUER` to distinct addresses for anything real.

Record the address into `.env` as `ORIGIN_VAULT`.

## 2. Creditcoin CC3 — pool engine

```bash
forge script script/DeployCreditcoin.s.sol \
  --rpc-url $CREDITCOIN_RPC_URL --account bifrost --broadcast
```

Reads `ORIGIN_VAULT` from the environment and fails fast if unset. Deploys `TestUSDC`,
deploys the engine pointing at BlockProver `0x…0FD2`, and mints `POOL_LIQUIDITY` into the
pool so borrowers have something to draw.

Record `CreditcoinPoolEngine` and `TestUSDC` into `docs/addresses.md`.

## 3. End-to-end smoke test

This is the first time the receipt decoder meets a *real* Sepolia receipt. Unit tests
build their own RLP, so this step is what actually validates the decoder.

```bash
# Sepolia: register, value, lock
cast send $ORIGIN_VAULT "registerPortfolio(uint256)" 1042 \
  --rpc-url $SEPOLIA_RPC_URL --account bifrost
cast send $ORIGIN_VAULT "setValuation(uint256,uint256)" 1042 250000000000 \
  --rpc-url $SEPOLIA_RPC_URL --account bifrost
cast send $ORIGIN_VAULT "lockPortfolio(uint256)" 1042 \
  --rpc-url $SEPOLIA_RPC_URL --account bifrost
```

Note the lock tx hash and its block number, then wait for Attestcoin to attest that
height (8-20 min). Build the proof with `@gluwa/usc-sdk` (`waitUntilHeightAttested`,
then `getProof`), and dry-run before spending gas.

`previewIngest` returns `(bool ok, string reason)`. Expected failure modes and what they
mean:

| reason | meaning |
|---|---|
| `precompile rejected proof` | proof is malformed, or the height isn't attested yet |
| `lock log not found` | wrong `ORIGIN_VAULT`, or the receipt has no `PortfolioLocked` |
| `value mismatch` | claim disagrees with the proven receipt — this is the guard working |
| `receipt already used` | replay guard; that receipt has already opened a line |

Once it returns `ok`, submit `attestAndOpenCredit`, then `draw`.

## Redeploying

Contracts hold no upgrade path. A redeploy is a fresh address; update `.env`,
`docs/addresses.md`, and any frontend config. Lines open on an old engine stay there —
keep the old address recorded so borrowers can still `repay`.
