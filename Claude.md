# CLAUDE.md

Guidance for Claude Code when working in this repository.

---

## 1. Project status

**Contracts implemented and tested; no frontend yet.** `contracts/` is a Foundry
project with the origin vault, the Creditcoin pool engine, a receipt decoder, and
32 passing tests. Not yet deployed to any network.

Sections 4-6 now describe shipped code. Section 7 (the portal) is still design only.
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
`lockPortfolio` (owner only, requires a valuation) -> `unlockPortfolio` (admin).

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

### `encodedTransaction` is the origin-chain receipt RLP

```
[status, cumulativeGasUsed, logsBloom, logs]     logs: [address, [topic...], data]
```

EIP-2718 typed receipts prepend a single type byte (<= 0x7f). `logsBloom` is 256 bytes, so
its prefix is `0xb9 0x01 0x00` — a long string with a two-byte length. Any RLP reader that
computes long-form length as `prefix - 0xb8` instead of `- 0xb7` misreads it. See
`src/lib/ReceiptDecoder.sol`.

### Off-chain

- SDK: `@gluwa/usc-sdk` (v0.18.0) — `proofProvider`, `waitUntilHeightAttested`, `getProof`
- Prover API: `https://proof-gen-api.cc3-testnet.creditcoin.network`
- Creditcoin CC3 testnet RPC: `https://rpc.cc3-testnet.creditcoin.network` (chain id 102031)
- **Sepolia `chainKey = 1`.** This is the only source chain confirmed working.
- **Attestation latency is 8-20 minutes.** Design every flow and demo around this; it is
  not tunable. Allow ~30 min before timing out.

### ChainInfo precompile — `0x…0FD3` does not respond as documented

`getSupportedChains()` and `getAttestedHeight(uint64)` both return `Unknown selector` on
CC3. The precompile exists and dispatches, so these signatures are wrong or unavailable.
There is therefore **no on-chain way to enumerate attested source chains** — which is why
Sepolia is hardcoded rather than discovered.
## 6. Layer 3 — Creditcoin Credit Pool Engine

`src/CreditcoinPoolEngine.sol` — issues stablecoin credit against a portfolio that
Attestcoin has proven locked on Sepolia.

**The security property that makes this protocol mean anything:** collateral value is never
read from calldata. `attestAndOpenCredit` calls the BlockProver precompile, then decodes
the `PortfolioLocked` log *out of the receipt the precompile just verified*, and takes
owner, value, and valuation round from there. The `LockClaim` argument only locates and
cross-checks that log — every field must equal what the proven receipt says or the call
reverts with `ClaimDoesNotMatchProof`. A borrower cannot mint credit beyond what an
independent valuer published and the origin chain actually escrowed.

Order of operations:

1. `chainKey` matches the configured source chain; caller is the claimed borrower
2. Receipt not already consumed (`usedReceipt[keccak256(encodedTx)]`), portfolio has no open line
3. `blockProver.verifyAndEmit(...)` must return true
4. `ReceiptDecoder.findLog` locates the log **emitted by `originVault`** with topic0
   `PortfolioLocked(address,uint256,uint256,uint64)` — a log from any other contract is
   not found, so an attacker cannot emit a lookalike event from their own contract
5. `topics[1]` (owner) and `topics[2]` (portfolioId) and the decoded `(dollarValue,
   valuationRound)` are all bound against the claim
6. `creditLimit = provenValue * ltvBps / 10_000`, with `MAX_LTV_BPS = 8000` as a hard
   ceiling the admin cannot raise past

Also implements `previewIngest` — a staticcall dry run over the precompile's read-only
`verify`, returning a reason string so the UI can explain a bad proof before the user
spends gas.

Beyond attestation: `draw`, `repay` (closes the line at zero), `setLtvBps`, `transferAdmin`.
## 7. Product: the Bifrost Operator Portal

Not a retail dApp. A **B2B institutional portal** — a sleek dual-pane enterprise dashboard.

**Users**
- **Borrower (Fintech / RWA issuer).** A credit fund manager holding, say, $1M in verified
  local business loans on a compliance ledger, who needs liquid stablecoins to originate more.
- **Lender (Liquidity Provider).** HNW investors or DAOs on Creditcoin seeking safe
  real-world yield.

**Interface**
- **Left pane — source chain status.** Compliance network connection (Base, Plume), total
  tokenized portfolio value, "Lock Asset" control panel.
- **Center — the Attestcoin status rail.** The signature element. A cryptographic progress
  bar: `Event Detected ➔ Merkle Proof Generated ➔ Validator Signatures Confirmed ➔ Proven`.
  This is what makes the backend legible to a judge or a risk officer.
- **Right pane — Creditcoin execution layer.** Active credit line balance, available
  capital to withdraw, interest rate, loan health factor.

**User journey**
1. **Connect dual wallets.** Institutional wallet (Fireblocks, MetaMask Institutional);
   the app verifies identity on both the compliance network and Creditcoin L1.
2. **Select collateral.** From inventory, e.g. *"Portfolio #1042: Emerging Market
   Microfinance Bundle — $250,000"*. Click **Request Credit Line**.
3. **Cross-chain lock.** User signs; `lockPortfolio` fires on the origin chain. UI:
   *"Securing asset on compliance chain…"*
4. **Attestation (no user interaction).** On block settlement, Attestcoin intercepts the
   event, compiles the proof, validators sign. The status rail animates through its stages.
5. **Claim on Creditcoin.** Status hits *Proven*; **Execute Credit Line on Creditcoin**
   activates. User signs, `attestAndCredit` runs, $200,000 USDC (80% LTV) lands in their
   Creditcoin account.

---

## 8. Commands

```bash
cd contracts

forge build            # compile (via_ir enabled; needed for engine stack depth)
forge test             # 32 tests
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

Frontend commands land here when the portal is scaffolded.
## 9. Open decisions and known gaps

Resolved since the first draft: the Attestcoin interface is verified (section 5), the
value-binding vulnerability is closed (section 6), and vault access control now separates
originator from valuer.

Still open:

1. **Sepolia is the only origin chain.** Base/Plume remain the stated business direction
   but are unverified and unbuildable today — ChainInfo cannot enumerate supported chains.
   Treat multi-chain origin as roadmap, not capability, in any writeup.
2. **Nothing is deployed.** Scripts are written and simulate cleanly against both live
   networks; the broadcast needs a funded keystore (`docs/DEPLOYMENT.md`). The end-to-end
   run is the first time the decoder meets a genuine Sepolia receipt rather than one the
   tests construct — expect that step, not the unit tests, to find remaining bugs.
3. **No frontend.** Section 7 is still design only.
4. **`unlockPortfolio` is admin-gated, not proven.** Creditcoin settlement isn't observable
   from Sepolia. Symmetric attestation (Creditcoin -> origin) would close the loop.
5. **No interest accrual, health factor, or liquidation.** The LTV buffer is enforced only
   at open. A position that goes underwater against a later valuation is not enforced
   on-chain.
6. **Valuation freshness is unbounded.** A valuer's number is trusted indefinitely once
   locked; there is no staleness check.
7. **Domain naming.** Earlier drafts referenced `intersect.fi` while the protocol is
   Bifrost. Pick one.
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
