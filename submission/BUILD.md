# Bifrost

**Borrow against your loan book. Without moving it.**
Cross-chain private credit, proven by Attestcoin and funded on Creditcoin.

![Bifrost landing page with a live position bridging Sepolia collateral to Creditcoin credit](https://raw.githubusercontent.com/thewoodfish/bifrost/main/docs/screenshots/landing.png)

**Demo video:** https://youtu.be/ufsz9Mp4Bbw · **Code:** https://github.com/thewoodfish/bifrost · **Live on:** Sepolia → Creditcoin CC3 testnet · **Tests:** 78 contract, 38 portal

---

## The problem

Real-world-asset lenders, such as an emerging-market microfinance fund or an invoice
factor, tokenize and audit their loan books on compliance-first EVM chains. The capital
they want to borrow is on Creditcoin. Today the only way to use one against the other is
a bridge, which means a multisig, an oracle and a custodian. That is exactly the trust
institutional risk officers refuse to sign off on for a multi-million-dollar portfolio.

## What Bifrost does

**Bifrost doesn't move the asset. It moves a proof about the asset.**

1. **Lock on the home chain.** An originator registers a portfolio in `RWAOriginVault`
   on Sepolia. An *independent* valuer prices it, and the owner locks it in escrow. The
   lock emits `PortfolioLocked(owner, portfolioId, dollarValue, valuationRound)`.
2. **Attestcoin attests the block.** Validators attest the Sepolia block containing the
   lock (8–20 minutes). The prover serves a Merkle inclusion proof and a continuity proof
   back to the attested checkpoint.
3. **Creditcoin verifies and lends.** `CreditcoinPoolEngine` passes the proof to the
   `BlockProver` precompile, decodes the lock event out of the proven receipt and opens a
   stablecoin credit line at 80% of the attested value. The borrower can then draw and repay.

No bridge, oracle or committee sits in the trust path. The collateral value comes from
the proven receipt, never from the borrower's calldata.

![Walkthrough: landing, dashboard, pre-flight claim checks, in-browser proof verification, forged receipt rejected](https://raw.githubusercontent.com/thewoodfish/bifrost/main/docs/screenshots/demo.gif)

## Attestcoin integration

Attestcoin is the credit decision itself, not a side feature. Bifrost uses every part of
its surface, both on-chain and from the browser:

| Attestcoin surface | How Bifrost uses it |
|---|---|
| **BlockProver `verifyAndEmit`** | The gate on every credit line, called inside `attestAndOpenCredit`. If it doesn't return `true`, no money moves. |
| **BlockProver `verify`** | A free dry-run (`previewIngest`) before the borrower signs, plus in-browser re-verification of any position by anyone. |
| **ChainInfo `get_latest_attestation_height_and_hash`** | Lock freshness **on-chain**. The engine rejects a proof whose lock is more than `maxLockAge` blocks behind the attestation frontier (`LockTooOld`). |
| **ChainInfo `is_height_attested`** | Tells the SDK and the portal when to start proving. The claim button waits on it, not on a timer. |
| **ChainInfo `get_supported_chains`** | Shows which source chains are actually attested, read live on the landing page and by the CLI. |
| **Prover API `proof-by-tx`** | The SDK gets proofs through `@gluwa/usc-sdk`'s `ProofBuilder`. The portal fetches them straight from the browser, so it needs no backend. |
| **Attestation lag** | The frontier is compared with the Sepolia head every 15 seconds. That drives the sidebar widget and every ETA, with no fake progress bars. |

### What we learned from the live network, not the docs

- **`encodedTransaction` is an ABI envelope, not receipt RLP.** It is `abi.encode(uint8 txType, bytes[] chunks)`, and the *last* chunk is the ABI-encoded receipt. Our `AttestedTx.sol` decoder takes the last chunk, so it works for every transaction type. It is tested against a real attested Sepolia receipt.
- **`MerkleProof` field order is load-bearing.** We confirmed it with differential calls: the correct order dispatches, and a transposed one returns `Unknown selector`.
- **ChainInfo functions are snake_case.** A camelCase call looks exactly like a missing precompile.
- **Reverted transactions are still attestable.** The engine checks the receipt's `status`, so a failed lock can't fund a line.
- **CC3's EVM is pre-merge.** Contracts compile for `london`, because `paris` and later fail with `prevrandao not set`.
- **Only Ethereum (key 3) and Sepolia (key 1) are attested.** We measured this with `get_supported_chains()`, and it's why the origin chain is Sepolia.

## Try to break it

`LockClaim` only *locates* the log in the proven receipt. Every field has to match what
the receipt says.

| Attack | Defense |
|---|---|
| Inflate the collateral value | The value is decoded from the verified receipt → `ClaimDoesNotMatchProof` |
| Forge or tamper with the receipt | The precompile checks the Merkle and continuity proofs → `ProofRejected` |
| Price your own collateral | Originator and valuer are separate vault roles → `NotValuer` |
| Lock against an old valuation | Valuations expire after 7 days → `StaleValuation` |
| Sit on a proof and borrow later | The lock is aged against the ChainInfo frontier → `LockTooOld` |
| Reuse a receipt | The receipt is consumed on first use → `ReceiptAlreadyUsed` |
| Use a reverted lock transaction | The receipt `status` must be 1 → `SourceTxFailed` |
| Claim someone else's lock | The borrower must be `msg.sender` and the proven owner → `BorrowerMismatch` |
| Emit the event from a look-alike contract | Only the configured vault's log counts → `LockLogNotFound` |
| Steal the next LP deposit through share inflation | A virtual share offset makes the attack cost more than it gains (tested) |

**Don't take our word for it.** On any position's verify page, your browser fetches the
proof, decodes the receipt and asks the precompile itself. Change the dollar value in the
attested receipt, leaving every other byte untouched, and Creditcoin rejects it:

![Forged receipt claiming $7,500,000 rejected by Creditcoin](https://raw.githubusercontent.com/thewoodfish/bifrost/main/docs/screenshots/forge.png)

## What's built

- **Contracts (Foundry, 78 tests).** `RWAOriginVault` handles escrow, role separation and
  valuation freshness. `CreditcoinPoolEngine` handles proof-gated credit lines, LP shares,
  8% APR interest and a 25% reserve factor. `AttestedTx` decodes Attestcoin's encoded-tx
  envelope.
- **Portal (React + viem, 38 tests, no backend).** It has a borrower console that finds
  your portfolios by wallet, pre-flight claim checks, a live proof-in-transit view, a
  valuation desk, a lender page, a public proof ledger and in-browser proof verification.
  It also has a ⌘K command palette, an EIP-6963 wallet picker, and it adds CC3 to your
  wallet automatically.
- **SDK / CLI (TypeScript).** It runs the whole lifecycle from a terminal:
  `lock → wait for attestation → prove → open → draw → repay`.

| Dashboard | Claim with pre-flight checks |
|---|---|
| ![Dashboard](https://raw.githubusercontent.com/thewoodfish/bifrost/main/docs/screenshots/dashboard.png) | ![Claim](https://raw.githubusercontent.com/thewoodfish/bifrost/main/docs/screenshots/claim.png) |
| **In-browser verification** | **Active line with live interest** |
| ![Verify](https://raw.githubusercontent.com/thewoodfish/bifrost/main/docs/screenshots/verify.png) | ![Line](https://raw.githubusercontent.com/thewoodfish/bifrost/main/docs/screenshots/line.png) |

## Proven end to end on real proofs

- **From the portal, with a real wallet.** Portfolio 2000's attested $300,000 lock opened
  a $240,000 line on Creditcoin. It drew $100,000 and repaid $25,000. The repayment paid
  the accrued interest first (25% to protocol reserves, the rest to lenders) and the
  remainder as principal.
- **From the SDK.** Portfolio 1042 opened a $200,000 line from a real attested receipt,
  and a replay of the same receipt was rejected.

| Contract | Chain | Address |
|---|---|---|
| `RWAOriginVault` | Sepolia | [`0x13F8630216EeF192ea74fc2AfA47Bd9edA372b7b`](https://sepolia.etherscan.io/address/0x13f8630216eef192ea74fc2afa47bd9eda372b7b#code) (verified) |
| `CreditcoinPoolEngine` | Creditcoin CC3 | [`0xBD39e340a43A5693Ae55E0E77b707558Fe67F3e8`](https://creditcoin-testnet.blockscout.com/address/0xBD39e340a43A5693Ae55E0E77b707558Fe67F3e8) |
| `TestUSDC` (10M supplied by LPs) | Creditcoin CC3 | [`0x6C1e351d926E45Bf88CbdA0412C8831E40AF865B`](https://creditcoin-testnet.blockscout.com/address/0x6C1e351d926E45Bf88CbdA0412C8831E40AF865B) |

## Business model

Bifrost is asset-light middleware and never lends its own balance sheet.

- **Rate spread, live on-chain.** Borrowers pay 8% APR, and a 25% reserve factor gives the
  protocol about 2% while lenders earn about 6% at full utilization.
- **Origination fee** *(planned)*: 0.25–0.50% of line value (a $10M line earns $25–50k).
- **Attestation and settlement fees** *(planned)*: charged per cross-chain message and
  shared with validator incentives.

Traditional private credit takes 3–6 months of paperwork. Bifrost opens a line in about
15 minutes, and anyone can check the proof behind it. Every lock, attestation and drawdown
is on-chain activity on Creditcoin, and it pulls RWA liquidity that is stranded on other
chains.

## Known gaps

- There is no health factor or liquidation yet. The 80% LTV is enforced only when a line opens.
- Undrawn credit isn't reserved, and the borrow rate is a flat 8% rather than utilization-based.
- Escrow release is admin-gated, because repayment on Creditcoin isn't visible from Sepolia.
- The code is unaudited.

## What's next

1. **Re-attested valuations.** A `PortfolioRevalued` event is proven to the engine, which
   then shrinks the limit or halts draws. Attestcoin becomes continuous collateral
   monitoring, not a one-time gate. This can be built on today's Attestcoin.
2. **Many origin chains.** The engine accepts a set of `(chainKey, vault)` pairs.
   Ethereum mainnet is already attested.
3. **Proven settlement back to the origin chain.** Once Creditcoin → origin attestation
   exists, the vault can release escrow on a proof of repayment, which removes the last
   admin key.
