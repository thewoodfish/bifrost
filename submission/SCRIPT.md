# Bifrost — narration script (ElevenLabs)

Written against `bifrost-demo.mp4` (2:53) and `SHOTLIST.md`. About 390 words; every scene
leaves headroom under its length at a normal pace (~150 wpm).

## How to use

**Recommended: one generation per scene.** Paste each block below into ElevenLabs
separately, download each clip, and drop it on the video timeline at the scene's start
time (or lay it over the matching file in `clips/`). If a line runs long, you only redo
that scene.

- The text inside each block is exactly what gets spoken — paste only the block.
- `<break time="…" />` tags hold a pause so a key word lands on its on-screen moment.
  They work on Eleven Multilingual v2 and Flash/Turbo models. If your model reads them
  aloud or ignores them, delete the tags and nudge the audio in your editor instead.
- Numbers are spelled out on purpose; TTS reads "$300,000" unreliably.

**Voice settings (starting point):** a calm, confident narrator · Stability ~0.50 ·
Similarity ~0.75 · Style 0–0.15 · Speed 1.0. Keep the same voice and settings for all 12.

**Pronunciation:** pick one reading of *Bifrost* and keep it — **BYE-frost** (English) or
**BIV-rost** (Norse). If the voice wavers, add it to a pronunciation dictionary.
*Sepolia* = seh-POH-lee-uh. *Merkle* = MER-kul.

---

## 01 · Hook — starts 0:00.3 · scene 15.2 s · speech ≈ 14 s

On screen: the landing hero; the live position arcs from Sepolia to Creditcoin (0:11).

```
Real-world lenders keep their loan books on compliance chains, but the liquidity lives on Creditcoin. Bridging them means trusting a multisig and an oracle. <break time="0.6s" /> Bifrost doesn't move the asset. It moves a proof about it.
```

## 02 · Live metrics — starts 0:15.6 · scene 8.0 s · speech ≈ 7 s

On screen: live numbers, then "0 bridges · 0 oracles · 0 multisigs · 1 proof" (0:21).

```
Every number here is read live from both chains. <break time="0.5s" /> Zero bridges. Zero oracles. Zero multisigs. One proof.
```

## 03 · How it works — starts 0:23.6 · scene 12.7 s · speech ≈ 12 s

On screen: step 1 (0:26.7), step 2 (0:30.0), step 3 (0:33.4).

```
A portfolio is locked on Sepolia, at a value set by an independent valuer. Attestcoin attests that block. Then Creditcoin verifies the proof on-chain, and lends up to eighty percent.
```

## 04 · Dashboard — starts 0:36.3 · scene 10.3 s · speech ≈ 9 s

On screen: the borrower dashboard; cursor moves to the Attestcoin lag widget (0:42.8).

```
Connect a wallet, and Bifrost finds your portfolios and offers. The sidebar shows the live attestation lag, read from Attestcoin's Chain Info precompile.
```

## 05 · Claim pre-flight — starts 0:46.6 · scene 16.1 s · speech ≈ 15 s

On screen: portfolio 3001; three checks turn green (0:51.3); cursor on Claim (0:56.3).

```
This portfolio has a four hundred thousand dollar offer. <break time="0.5s" /> Before anyone signs, the portal fetches the proof from the Attestcoin prover, checks it with Creditcoin's Block Prover, and dry-runs the claim. Each receipt opens exactly one line.
```

## 06 · A real line — starts 1:02.7 · scene 15.2 s · speech ≈ 14 s

On screen: command palette (1:04), the live line with interest ticking (1:08.5), activity (1:14.8).

```
Jump to any portfolio. <break time="0.8s" /> This line opened from a verified proof: two hundred forty thousand dollars, against three hundred thousand in collateral. It's been drawn and partly repaid, and interest accrues by the second.
```

## 07 · Verify it yourself — starts 1:17.8 · scene 23.8 s · speech ≈ 21 s

On screen: five checks green (1:20); prover proof (1:24); decoded $300,000 (1:29);
`verify()` → true (1:34); receipt marked used (1:39).

```
Don't trust us. Verify it yourself. <break time="1.0s" /> Your browser fetches the proof from Attestcoin, decodes the attested receipt — owner, portfolio, three hundred thousand dollars — and asks Creditcoin's Block Prover if it holds. <break time="0.4s" /> True. The same check the pool ran before lending. And the receipt is marked used, so it can't be replayed.
```

## 08 · Try to lie — starts 1:41.6 · scene 19.7 s · speech ≈ 18.5 s

On screen: forged $3,000,000 typed (1:45.6); rejected (1:50.1); genuine $300,000 accepted (1:57.8).

```
Now try to lie. Rewrite one number in the attested receipt: three million dollars, instead of three hundred thousand. <break time="0.3s" /> Creditcoin rejects it. The Merkle proof fails. <break time="1.6s" /> Put the real value back, and it passes. No admin key or oracle can change that.
```

## 09 · Ledger and valuers — starts 2:01.3 · scene 10.9 s · speech ≈ 10 s

On screen: the proof ledger (2:04.6), then the valuation desk (2:09.7).

```
Every position is public, one click from its proof. <break time="1.2s" /> And valuation is a separate role: the borrower doesn't price its own collateral.
```

## 10 · Lend — starts 2:12.3 · scene 10.0 s · speech ≈ 9.5 s

On screen: the Lend page; the six-and-two split bar (2:18.7).

```
Lenders fund the pool and earn what borrowers pay. Eight percent in: six to lenders, two to the protocol. The business model runs on-chain.
```

## 11 · The contract — starts 2:22.3 · scene 22.8 s · speech ≈ 21.5 s

On screen: `attestAndOpenCredit`; ① freshness and replay (2:26.7), ② `verifyAndEmit` (2:30.8),
③ decode from the receipt (2:35.4), ④ bind the claim (2:39.5).

```
One function does it all. <break time="1.8s" /> First, freshness: the lock is aged against Attestcoin's attestation frontier, and every receipt works once. Then Block Prover verifies inclusion. The collateral value is decoded from the proven receipt itself, never taken from the caller, and bound to the claim before any credit is issued. Tested against a real attested receipt.
```

## 12 · Close — starts 2:45.1 · scene 7.9 s · speech ≈ 5.5 s

On screen: "Your loan book is already collateral."

```
Bifrost. <break time="0.4s" /> Your loan book is already collateral. Proven by Attestcoin, funded on Creditcoin.
```

---

## Fallback: one paste for the whole video

Use this only if you'd rather generate once. Scene pauses are approximate, so expect to
nudge sections by a second or two in your editor. ElevenLabs caps a single break at 3 s,
and many long breaks can make a voice unstable; if that happens, switch to the
per-scene method above.

```
Real-world lenders keep their loan books on compliance chains, but the liquidity lives on Creditcoin. Bridging them means trusting a multisig and an oracle. <break time="0.6s" /> Bifrost doesn't move the asset. It moves a proof about it. <break time="1.2s" />

Every number here is read live from both chains. <break time="0.5s" /> Zero bridges. Zero oracles. Zero multisigs. One proof. <break time="1.0s" />

A portfolio is locked on Sepolia, at a value set by an independent valuer. Attestcoin attests that block. Then Creditcoin verifies the proof on-chain, and lends up to eighty percent. <break time="1.0s" />

Connect a wallet, and Bifrost finds your portfolios and offers. The sidebar shows the live attestation lag, read from Attestcoin's Chain Info precompile. <break time="1.2s" />

This portfolio has a four hundred thousand dollar offer. <break time="0.5s" /> Before anyone signs, the portal fetches the proof from the Attestcoin prover, checks it with Creditcoin's Block Prover, and dry-runs the claim. Each receipt opens exactly one line. <break time="1.0s" />

Jump to any portfolio. <break time="0.8s" /> This line opened from a verified proof: two hundred forty thousand dollars, against three hundred thousand in collateral. It's been drawn and partly repaid, and interest accrues by the second. <break time="1.2s" />

Don't trust us. Verify it yourself. <break time="1.0s" /> Your browser fetches the proof from Attestcoin, decodes the attested receipt — owner, portfolio, three hundred thousand dollars — and asks Creditcoin's Block Prover if it holds. <break time="0.4s" /> True. The same check the pool ran before lending. And the receipt is marked used, so it can't be replayed. <break time="2.0s" />

Now try to lie. Rewrite one number in the attested receipt: three million dollars, instead of three hundred thousand. <break time="0.3s" /> Creditcoin rejects it. The Merkle proof fails. <break time="1.6s" /> Put the real value back, and it passes. No admin key or oracle can change that. <break time="1.0s" />

Every position is public, one click from its proof. <break time="1.2s" /> And valuation is a separate role: the borrower doesn't price its own collateral. <break time="0.8s" />

Lenders fund the pool and earn what borrowers pay. Eight percent in: six to lenders, two to the protocol. The business model runs on-chain. <break time="0.8s" />

One function does it all. <break time="1.8s" /> First, freshness: the lock is aged against Attestcoin's attestation frontier, and every receipt works once. Then Block Prover verifies inclusion. The collateral value is decoded from the proven receipt itself, never taken from the caller, and bound to the claim before any credit is issued. Tested against a real attested receipt. <break time="1.2s" />

Bifrost. <break time="0.4s" /> Your loan book is already collateral. Proven by Attestcoin, funded on Creditcoin.
```

---

## Merging (once the audio is back)

With ffmpeg, per-scene audio named `01.mp3` … `12.mp3`, each placed at its scene start:

```bash
ffmpeg -i bifrost-demo.mp4 \
  -i 01.mp3 -i 02.mp3 -i 03.mp3 -i 04.mp3 -i 05.mp3 -i 06.mp3 \
  -i 07.mp3 -i 08.mp3 -i 09.mp3 -i 10.mp3 -i 11.mp3 -i 12.mp3 \
  -filter_complex "\
[1]adelay=300:all=1[a1];[2]adelay=15590:all=1[a2];[3]adelay=23560:all=1[a3];\
[4]adelay=36280:all=1[a4];[5]adelay=46570:all=1[a5];[6]adelay=62650:all=1[a6];\
[7]adelay=77840:all=1[a7];[8]adelay=101620:all=1[a8];[9]adelay=121340:all=1[a9];\
[10]adelay=132290:all=1[a10];[11]adelay=142250:all=1[a11];[12]adelay=165060:all=1[a12];\
[a1][a2][a3][a4][a5][a6][a7][a8][a9][a10][a11][a12]amix=inputs=12:normalize=0,apad[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -shortest bifrost-submission.mp4
```

The delays are the scene start times in milliseconds from `timeline.json`. Or hand me the
12 files and I'll do the merge and check the sync.
