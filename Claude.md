# CLAUDE.md

Guidance for Claude Code when working in this repository.

---

## 1. Project status

**Contracts deployed and validated end-to-end; the portal is built and driving them.**
`contracts/` is a Foundry project with the origin vault, the Creditcoin pool engine, a
receipt decoder, and 40 passing tests. Live on Sepolia and CC3 testnet as of 2026-09-08 —
addresses in `docs/addresses.md`. `app/` is the React portal, verified against the live
deployment as of 2026-09-09.

Sections 4-7 now describe shipped code.
## 2. What Bifrost is

**Bifrost is a cross-chain private credit protocol.** It lets real-world-asset (RWA)
lenders borrow stablecoins against a tokenized loan portfolio *without moving that
portfolio off its origin chain*.

**The problem.** RWA issuers — an emerging-market microfinance fund, a corporate invoice
factor — tokenize and audit their loan books on KYC-compliant EVM L2s (Base, Plume),
because that is where their compliance and developer stack lives. The deep capital,
credit-scoring registries, and yield-seeking LPs live on **Creditcoin L1**. Bridging
multi-million-dollar RWAs between them via conventional bridges reintroduces exactly the
centralized trust vectors — oracle multisigs, bridge operators — that institutional risk
officers categorically reject.

**The approach.** Don't move the asset; move a proof about it. The portfolio is locked in
escrow on its native chain. The **Attestcoin Protocol** cryptographically attests to that
lock — its value, ownership, and state root — and delivers a verifiable payload to
Creditcoin. Creditcoin verifies the proof on-chain and releases a stablecoin credit line
at up to 80% LTV. No oracle sits in the trust path.

**Context:** this is a hackathon project judged primarily on *depth of Attestcoin Protocol
utilization*. Integration realism with Attestcoin matters more than breadth of features.

---

## 3. Architecture

```
┌──────────────────────────────────┐          ┌──────────────────────────────────┐
│  ORIGIN CHAIN (Sepolia)          │          │          CREDITCOIN L1           │
│                                  │          │                                  │
│  [Fintech Lender / RWA Issuer]   │          │   [Liquidity Provider Vaults]    │
│              │                   │          │              │                   │
│              ▼                   │          │              ▼                   │
│  ┌────────────────────────────┐  │          │  ┌────────────────────────────┐  │
│  │     RWAOriginVault.sol     │  │          │  │  CreditcoinPoolEngine.sol  │  │
│  ├────────────────────────────┤  │          │  ├────────────────────────────┤  │
│  │ • Escrows tokenized loan   │  │          │  │ • Holds USDC / CTC         │  │
│  │   portfolio                │  │          │  │ • Verifies Attestcoin proof│  │
│  │ • Emits attestation event  │  │          │  │ • Releases credit @ 80% LTV│  │
│  └─────────────┬──────────────┘  │          │  └─────────────▲──────────────┘  │
└────────────────┼─────────────────┘          └────────────────┼─────────────────┘
                 │                                             │
                 │        ┌──────────────────────────┐         │
                 └───────►│    ATTESTCOIN PROTOCOL   ├─────────┘
                          ├──────────────────────────┤
                          │ 1. Intercept lock event  │
                          │ 2. Build Merkle proof    │
                          │ 3. Validators sign       │
                          │ 4. Submit payload        │
                          └──────────────────────────┘
```

Three layers, built in this order:

| # | Layer | Where it runs | Deliverable |
|---|-------|---------------|-------------|
| 1 | RWA Origin Vault | Sepolia | `RWAOriginVault.sol` |
| 2 | Attestation payload | Attestcoin network | Payload schema + relay/simulation script |
| 3 | Credit Pool Engine | Creditcoin L1 (EVM) | `CreditcoinPoolEngine.sol` |

---

## 4. Layer 1 — RWA Origin Vault (Sepolia)

`src/RWAOriginVault.sol` — escrow for tokenized loan portfolios on the compliance chain.

Three roles, deliberately separated: an **admin** manages permissions, **originators**
register portfolios, and **valuers** publish valuations. An originator therefore cannot
price their own collateral, which is the credibility basis of the whole protocol — without
it, a borrower could assert any value and the attestation would faithfully prove a lie.

Lifecycle: `registerPortfolio` -> `setValuation` (valuer only, frozen once locked) ->
`lockPortfolio` (owner only, requires a *fresh* valuation) -> `unlockPortfolio` (admin).

`setValuation` stamps `valuedAt`, and `lockPortfolio` reverts with `StaleValuation` once
that stamp is older than `maxValuationAge` (7 days by default, admin-tunable up to
`MAX_VALUATION_AGE_LIMIT` of 90 days, never zero). Escrowing against a number nobody has
revisited is the failure the attestation cannot catch: it would prove a stale valuation
exactly as faithfully as a fresh one.

`lockPortfolio` emits the fact Attestcoin proves, and **the event layout is load-bearing**
because the Creditcoin engine decodes it out of the receipt:

```solidity
event PortfolioLocked(
    address indexed owner,        // topics[1] -> bound to borrower on Creditcoin
    uint256 indexed portfolioId,  // topics[2]
    uint256 dollarValue,          // data[0:32]
    uint64  valuationRound        // data[32:64]
);
```

Changing indexed-ness or field order here silently breaks `CreditcoinPoolEngine`. The
topic hash is `keccak256("PortfolioLocked(address,uint256,uint256,uint64)")`.

---

## 5. Layer 2 — Attestcoin integration surface (verified)

**This is the core evaluation criterion**, and the surface below is verified against the
live CC3 testnet (chain id `102031`), not taken from a draft.

### BlockProver precompile — `0x0000000000000000000000000000000000000FD2`

```solidity
function verifyAndEmit(
    uint64 chainKey,
    uint64 height,
    bytes calldata encodedTransaction,
    MerkleProof calldata merkleProof,        // { bytes32 root; MerkleProofEntry[] siblings; }
    ContinuityProof calldata continuityProof // { bytes32 lowerEndpointDigest; bytes32[] roots; }
) external returns (bool);

function verify(...) external view returns (bool);          // read-only dry run
function calculateTxIndex(bytes32, MerkleProof, ContinuityProof) external view returns (uint256);
```

**Struct field order is load-bearing.** `MerkleProof.root` must precede `siblings`. How this
was confirmed: calling `verify` with the correct signature and empty calldata returns the
precompile's own `"Transaction data cannot be empty"` revert, proving the selector
dispatched; a transposed struct order returns `"Unknown selector"` instead. Re-run that
differential check if the interface ever appears to break.

### `encodedTransaction` is an ABI envelope, not receipt RLP

This is the single easiest thing to get wrong, and getting it wrong fails only against
real proofs — never against your own fixtures. The payload is:

```
abi.encode(uint8 txType, bytes[] chunks)
```

Chunk count varies by transaction type (3 for legacy/access-list/1559, 4 for blob and
authorization types), and **the last chunk is always the receipt**:

```
abi.encode(uint8 status, uint64 gasUsed, tuple(address, bytes32[], bytes)[] logs, bytes logsBloom)
```

So logs are ABI-encoded, not RLP-encoded. Decoding is delegated to the Solidity ABI
decoder in `src/lib/AttestedTx.sol`, which bounds-checks for free. Take the last chunk
rather than a fixed index, and the decoder works for every transaction type.

Verified against usc-sdk v0.18.0 `encoding/abi/v1.ts` (`abiEncode`).

`status` must be checked: a **reverted** source transaction still produces a perfectly
attestable receipt, and would otherwise fund a credit line off a failed lock.

### Off-chain

- SDK: `@gluwa/usc-sdk` (v0.18.0) — `proofProvider`, `waitUntilHeightAttested`, `getProof`
- Prover API: `https://prover.cc3-testnet.creditcoin.network` — proofs at
  `GET /api/v1/proof-by-tx/{chainKey}/{txHash}`, which is what the SDK's `ProofBuilder`
  calls. Serves CORS `*`, so the browser can call it with no backend in between.
- Creditcoin CC3 testnet RPC: `https://rpc.cc3-testnet.creditcoin.network` (chain id 102031)
- **Sepolia `chainKey = 1`.** Ethereum mainnet is `chainKey = 3`; nothing else is supported.
- **Attestation latency is 8-20 minutes.** Design every flow and demo around this; it is
  not tunable. Allow ~30 min before timing out.

### ChainInfo precompile — `0x…0FD3`, snake_case names

Live and working. **Its functions are snake_case**, not camelCase — querying
`getSupportedChains()` returns `Unknown selector`, which reads like the precompile is
missing when it is simply named differently. See `src/interfaces/IChainInfo.sol`.

`CreditcoinPoolEngine` calls `get_latest_attestation_height_and_hash` on-chain to age a
lock against the attestation frontier, rejecting a proof more than `maxLockAge` source
blocks behind it — so ChainInfo is part of the credit decision, not only the UI.

`get_supported_chains()` on CC3 returns exactly two attested source chains:

| chainKey | chainId | name |
|---|---|---|
| 3 | 1 | Ethereum |
| 1 | 11155111 | Sepolia ethereum |

**Base and Plume are not supported.** This is measured, not inferred, and it is why the
protocol targets Sepolia. Useful calls: `is_height_attested(chainKey, height)` and
`get_latest_attestation_height_and_hash(chainKey)` — the latter is how to show real
attestation lag in the UI rather than a fake progress bar.

---

## 8. Commands

```bash
cd contracts

forge build            # compile (via_ir enabled; needed for engine stack depth)
forge test             # 55 tests
forge test -vvv        # with traces
forge fmt              # format

# Deploy — see docs/DEPLOYMENT.md for the full runbook
forge script script/DeployOrigin.s.sol     --rpc-url $SEPOLIA_RPC_URL    --account bifrost --broadcast
ORIGIN_VAULT=0x... \
forge script script/DeployCreditcoin.s.sol --rpc-url $CREDITCOIN_RPC_URL --account bifrost --broadcast
```

**`evm_version` is pinned to `london`.** CC3 testnet's EVM is pre-merge and rejects
`paris` and later with `header validation error: prevrandao not set`. London bytecode
runs on both chains. Do not raise it.

### SDK — the off-chain proof pipeline

```bash
cd sdk && npm install
npm run bifrost -- status              # supported chains + live attestation lag
npm run bifrost -- lock 1042 250000    # register, value, lock on Sepolia
npm run bifrost -- open <txHash>       # wait for attestation, prove, open credit
npm run bifrost -- line 1042
```

### Portal

```bash
cd app && npm install
npm run dev          # http://localhost:5173
npm run build        # tsc -b && vite build
npm run typecheck
```

No backend: the portal reads both chains over RPC and calls the prover directly, which
serves `Access-Control-Allow-Origin: *`. Addresses default to `docs/addresses.md`;
override with `VITE_ORIGIN_VAULT`, `VITE_POOL_ENGINE`, `VITE_STABLECOIN`,
`VITE_PROVER_URL`, `VITE_CHAIN_KEY` — and, on any redeploy, `VITE_ORIGIN_VAULT_FROM_BLOCK`
and `VITE_POOL_ENGINE_FROM_BLOCK` (the deploy blocks the indexer starts from).

Hash-routed surfaces, one per persona: `#/` landing (live stats and a real position),
`#/app` borrower console (portfolios found by owner — no ids to type), `#/p/:id` the
portfolio, driven by one `phase` (`lib/phase.ts`) from offer → proof in transit → claim →
active line, `#/valuer` the valuation desk, `#/ledger` every lock and line, and
`#/verify/:id`, which re-runs the proof in the browser: prover fetch, receipt decode
(`lib/proof.ts`, mirroring `AttestedTx.sol`), `BlockProver.verify()`, receiptId binding —
plus a forged-value submission the precompile rejects.

`lib/indexer.ts` reads every vault and engine event since deploy, caches progress in
localStorage, and derives portfolios, lines and totals; `lib/protocol.tsx` shares it with
the attestation frontier and pool liquidity. Live `getPortfolio`/`getCreditLine` reads
still gate every write.

**Set `VITE_SEPOLIA_RPC_URL` for a demo.** The default public Sepolia endpoint caps
`eth_getLogs` at 1000 blocks and rate-limits. The indexer chunks below that limit (and
CC3 at 5000, past which it times out) so it works either way, but a dedicated endpoint
answers in fewer calls.
## 9. Open decisions and known gaps

Resolved since the first draft: the Attestcoin interface is verified (section 5), the
value-binding vulnerability is closed (section 6), vault access control now separates
originator from valuer, valuation freshness is bounded on both sides (below), and the
naming is settled — the protocol is Bifrost, and no `intersect.fi` reference survives
anywhere in the tree.

> **The contracts are ahead of the deployed addresses.** Valuation freshness landed after
> the 2026-09-08 deploy, so the live vault and engine in `docs/addresses.md` do not
> enforce it. Redeploying means new addresses and re-seeding the demo state, since
> `originVault` is immutable on the engine.

Still open:

1. **Sepolia is the only usable testnet origin chain**, confirmed by
   `get_supported_chains()`: only Ethereum mainnet (key 3) and Sepolia (key 1) are
   attested. Base/Plume are not supported at all — treat multi-chain origin as a request
   to Gluwa, not a roadmap item you can build.
2. **Deployed, and the decoder survived a real receipt.** Both chains are live
   (`docs/addresses.md`). Portfolio 1042 locked at $250,000 on Sepolia, attested at height
   11664110, opened a $200,000 line on CC3 and drew $50,000; a replayed receipt was
   rejected. The decoder needed no changes for a genuine Sepolia receipt.
   The vault is verified on Sepolia Etherscan; CC3 offers no explorer verification.
3. **Portal is read/write complete but unaudited.** `app/` drives the full lifecycle —
   register, value, lock, watch attestation, preview, open, draw, repay. The 2026-09-10
   rebuild was checked in a headless browser against the live deployment — landing,
   ledger, valuation desk, portfolio 2001's claim checks, and the verify page including
   the forged-value rejection — but no write was sent from it, so the offer, in-transit,
   active-line and repaid screens are unexercised against real state. It has no tests.
4. **`unlockPortfolio` is admin-gated, not proven.** Creditcoin settlement isn't observable
   from Sepolia. Symmetric attestation (Creditcoin -> origin) would close the loop.
5. **No interest accrual, health factor, or liquidation.** The LTV buffer is enforced only
   at open. A position that goes underwater against a later valuation is not enforced
   on-chain.
6. **Freshness is bounded in code, not yet on chain.** Two controls, 55 tests:
   `RWAOriginVault.maxValuationAge` (default 7 days) rejects a lock whose valuation has
   gone stale, and `CreditcoinPoolEngine.maxLockAge` (default 7200 source blocks) rejects
   a proof whose lock the attestation frontier has left behind. Both are admin-tunable
   between hard bounds but cannot be switched off, mirroring `MAX_LTV_BPS`. Not deployed
   — see the note above.
## 10. Business context

Useful when writing pitch material, docs, or demo narration.

**Model.** Bifrost is asset-light middleware — it builds the contracts and verification
pipeline, it does not lend its own balance sheet. Revenue:
- **Origination fee:** 0.25–0.50% of credit line value at execution (a $10M line → $25–50k).
- **Interest rate spread:** LPs demand ~6%, borrowers pay ~8%; the protocol captures the ~2%.
- **Settlement / attestation fees:** per cross-chain message, split with validator incentives.

**Positioning.** Traditional off-chain private credit deals take 3–6 months of legal
paperwork. Bifrost issues an institutional credit line in minutes with cryptographic
certainty.

**Risk management.** 75–80% LTV over-collateralization buffer absorbs real-world default
risk. If attested portfolio performance drops below threshold, further drawdowns halt
automatically. Production would require KYC/AML partners and institutional custody
(Fireblocks, BitGo).

**Go-to-market.** Supply side: partner with RWA tokenization platforms (Plume, Centrifuge,
Goldfinch) that already have compliant originators wanting cheaper liquidity. Demand side:
work with Gluwa and Creditcoin ecosystem foundations routing stablecoins into real yield.

**Value to Creditcoin.** Every lock, attestation, and drawdown is on-chain activity driving
CTC utilization; it demonstrates oracle-free institutional-grade security; it vacuums RWA
liquidity stranded on other L2s onto Creditcoin; and it aligns with Gluwa's central-bank
and fintech partnerships by turning Creditcoin from a passive credit ledger into an active
capital-deployment engine.
