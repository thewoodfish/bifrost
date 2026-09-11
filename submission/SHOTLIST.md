# Bifrost — submission video shot list

**Video:** `bifrost-demo.mp4` — 2:53, 1920×1080, 30 fps, H.264, no audio.
**Per-scene clips:** `clips/` — cut on the scene boundaries below, so a scene can be
slowed, trimmed or re-timed to fit its narration without touching the others.
**Beat timings:** `timeline.json` (seconds from the start of the video).

Recorded 2026-09-11 from the live portal against Sepolia and Creditcoin CC3 testnet.
Everything on screen is live chain data. The wallet is a read-only stand-in for the owner
account, so nothing in the video was signed; the claim button is hovered, not clicked.

**Narration budget:** ~150 wpm ≈ 2.5 words/second. The whole video holds ~430 words;
each scene's budget is below. Leave the first ~0.5 s of each scene quiet for cuts.

**What the judges score first:** depth of Attestcoin Protocol utilization. Scenes 05, 07,
08 and 11 carry that — give them the most precise language. Name the actual surfaces:
the prover, `BlockProver.verify` / `verifyAndEmit`, the ChainInfo precompile.

---

## 01 · Hook — 0:00.3 → 0:15.6 (15 s, ~36 words)

Landing hero: *"Borrow against your loan book. Without moving it."* Below it, a live position
(portfolio 2000): $300,000 escrowed on Sepolia → an Attestcoin proof arcs across →
$240,000 credit line on Creditcoin.

- 0:11.0 · cursor rests on the Attestcoin proof between the two chains

**Say:** the problem (RWA loan books live on compliance chains; liquidity lives on
Creditcoin; bridges put a multisig and an oracle in the trust path) and the one-line answer
(don't move the asset — move a proof about it).

## 02 · Live metrics — 0:15.6 → 0:23.6 (8 s, ~19 words)

Live numbers from both chains (pool liquidity, collateral escrowed, credit extended, live
attestation lag), then **0 bridges · 0 oracles · 0 multisigs · 1 proof**.

- 0:21.0 · "1 proof" highlighted

**Say:** these numbers are read from the chains in the browser — nothing is mocked.

## 03 · How it works — 0:23.6 → 0:36.3 (13 s, ~30 words)

Three steps, one per chain.

- 0:26.7 · step 1 — escrow on Sepolia (independent valuer sets the value)
- 0:30.0 · step 2 — Attestcoin attests the block containing the lock
- 0:33.4 · step 3 — Creditcoin's BlockProver precompile verifies, pool lends up to 80%

**Say:** lock on the origin chain → Attestcoin proves it (8–20 min, no custody) →
Creditcoin verifies the proof on-chain and releases stablecoins at 80% LTV.

## 04 · Borrower dashboard — 0:36.3 → 0:46.6 (10 s, ~25 words)

Connected borrower. $165,000 available of a $240,000 line; two offers ready to claim
(#3001 $400,000, #2001 $600,000); portfolios found from the wallet — no IDs typed.

- 0:42.8 · sidebar: live Attestcoin lag, attested height vs. Sepolia head, read from the
  **ChainInfo precompile**

**Say:** the product finds your book; the attestation frontier is always on screen, so the
8–20 minute wait reads as normal, not broken.

## 05 · Claim with pre-flight checks — 0:46.6 → 1:02.7 (16 s, ~39 words)

Portfolio 3001 ($500,000 collateral → $400,000 offer). Lifecycle stepper at "Funded".

- 0:51.3 · all three pre-flight checks green: **proof fetched from the Attestcoin prover**
  (block 11,681,749, 8 Merkle siblings, 52 continuity roots) · **verified by Creditcoin's
  BlockProver** (`verify()` true in ~180 ms) · **claim matches the attested receipt**
  (the engine's `previewIngest`)
- 0:56.3 · cursor on "Claim $400,000" — not clicked
- 1:00.1 · proof journey: Sepolia → Attestcoin → Creditcoin

**Say:** before the borrower signs, the portal runs the same checks the contract will —
because a receipt can open exactly one line, nobody should discover a problem on-chain.

## 06 · A real line — 1:02.7 → 1:17.8 (15 s, ~36 words)

⌘K → "2000" → portfolio 2000's live line, opened from the portal with a real wallet.

- 1:04.2 · command palette
- 1:08.5 · owed: $75,000 principal + interest ticking per second at 8% APR
- 1:14.8 · activity: line of $240,000 opened against the proof · drew $100,000 · repaid
  $25,000 · paid $0.0152 interest

**Say:** this line exists because Creditcoin verified the proof; draw and repay like a bank
account, interest paid first.

## 07 · Verify it yourself — 1:17.8 → 1:41.6 (24 s, ~57 words)

The verify page for portfolio 2000. The browser re-runs the proof against live chains.

- 1:20.2 · all five steps green
- 1:24.4 · proof fetched from the Attestcoin prover: attested height, Merkle path to root,
  continuity proof back to the attested checkpoint
- 1:29.3 · receipt decoded in the browser: `abi.encode(txType, chunks)`, receipt is the last
  chunk; emitter is the Bifrost vault; owner, portfolio #2000, **$300,000** all ✓
- 1:34.4 · **`BlockProver.verify()` → true**
- 1:38.8 · receipt bound to the line it opened; reusable? **No — marked used on-chain**

**Say:** "don't trust us" — every step is a call the viewer's browser makes; this is the
check the pool ran before lending a dollar, and the receipt can never be used twice.

## 08 · Try to lie — 1:41.6 → 2:01.3 (20 s, ~47 words)

"Claim this portfolio is worth more."

- 1:45.6 · a forged value is typed: **$3,000,000** (10× the real one)
- 1:50.1 · **Rejected by Creditcoin** — *Merkle proof validation failed* (same proof, one
  field changed, every other byte identical)
- 1:57.8 · the genuine **$300,000** goes back in → accepted

**Say:** the collateral value is never taken from calldata — it's decoded from the proven
receipt; change one dollar and the precompile refuses. No admin key, oracle or Bifrost
server can make it pass.

## 09 · Ledger and valuation desk — 2:01.3 → 2:12.3 (11 s, ~26 words)

- 2:04.6 · proof ledger: every lock and line public, each row one click from Verify
- 2:09.7 · valuation desk: independent valuers — originators cannot price their own
  collateral, and stale valuations can't be locked against

**Say:** the book is auditable by anyone; the valuer role is separate by contract, which is
what makes the proven value mean something.

## 10 · Lend — 2:12.3 → 2:22.3 (10 s, ~24 words)

$10M supplied by lenders, lender APR, $0.0152 interest paid so far.

- 2:18.7 · split bar: borrowers pay 8% → **6% to LPs, 2% protocol**

**Say:** the business model runs on-chain — LP shares, interest, and a 25% reserve factor.

## 11 · The contract — 2:22.3 → 2:45.1 (23 s, ~56 words)

`attestAndOpenCredit` in `CreditcoinPoolEngine.sol` (lines 213–244, rendered from the repo).

- 2:26.7 · ① freshness and replay first — lock age checked against the ChainInfo
  attestation frontier (`LockTooOld`), receipt single-use (`ReceiptAlreadyUsed`)
- 2:30.8 · ② **`blockProver.verifyAndEmit(...)`** — Attestcoin verifies inclusion
- 2:35.4 · ③ `_decodeLock` — owner, value, round decoded from the proven receipt
- 2:39.5 · ④ claim bound to the proof → `creditLimit = provenValue × 80%`

**Say:** Attestcoin sits inside the credit decision three ways — the ChainInfo frontier
ages the lock, BlockProver verifies inclusion, and the attested receipt is the only source
of the collateral value. 78 contract tests, including a real attested Sepolia receipt.

## 12 · Close — 2:45.1 → 2:53.0 (8 s, ~19 words)

"Your loan book is already collateral." — Launch app / Browse live positions; footer shows
contracts and the attested chains read live from ChainInfo.

**Say:** Bifrost — cross-chain private credit, proven by Attestcoin, funded on Creditcoin.

---

## Verified numbers (safe to say)

| Fact | Value |
|---|---|
| Advance rate | 80% LTV (hard-capped in the contract) |
| Attestation latency | 8–20 minutes (on screen: 2–8 min lag during recording) |
| Portfolio 3001 | $500,000 locked, attested → $400,000 offer, unclaimed |
| Portfolio 2000 | $300,000 attested → $240,000 line; drew $100,000; repaid $25,000 |
| Forgery | $3,000,000 claimed → rejected, "Merkle proof validation failed" |
| Pool | $10M supplied; borrowers 8% APR; 25% of interest to protocol → ~6% / ~2% |
| Tests | 78 Foundry (incl. a real attested Sepolia receipt), 38 portal |
| Chains | Sepolia (chainKey 1) → Creditcoin CC3 (chain id 102031) |

## Re-recording

`tools/record.mjs` drives the portal headlessly (Playwright + CDP screencast, fake cursor,
read-only wallet); `tools/encode.py` turns the frames into the MP4 and `timeline.json`;
`tools/code.html` is the contract card for scene 11. The demo state changes over time —
3001's claim window closes around 12:40 UTC 2026-09-12 (frontier past block 11,688,949) — so re-lock and re-record if the
video needs to be regenerated after that.

```bash
cd app && npm run dev                          # portal on :5173
mkdir -p <outdir> && cp submission/tools/* <outdir>/
node <outdir>/record.mjs <outdir>              # needs playwright-core + its Chromium
cd <outdir> && python3 encode.py final.mp4
```
