import { SEPOLIA_BLOCK_SECONDS } from "./config";
import type { PortfolioRecord } from "./indexer";
import type { Params } from "./protocol";
import type { AttestationStatus } from "./useAttestation";

/**
 * Where a portfolio stands, in the borrower's terms rather than the contracts'.
 *
 * The contracts have four booleans; a borrower has one question — what happens next,
 * and is it on me? Every surface (list chip, page hero, ledger row) reads this one
 * function so they never disagree.
 */
export type Phase =
  | "unregistered"
  | "awaiting-valuation"
  | "stale"
  | "offer"
  | "in-transit"
  | "ready"
  | "expired"
  | "active"
  | "repaid";

export type Tone = "neutral" | "amber" | "violet" | "green" | "grey" | "red";

export const PHASE_META: Record<Phase, { label: string; tone: Tone; next: string }> = {
  "unregistered":       { label: "Not registered",      tone: "neutral", next: "Register the portfolio to begin" },
  "awaiting-valuation": { label: "Awaiting valuation",  tone: "amber",   next: "An independent valuer prices it" },
  "stale":              { label: "Valuation expired",   tone: "amber",   next: "Needs a fresh valuation before locking" },
  "offer":              { label: "Offer ready",         tone: "green",   next: "Accept to lock and request funds" },
  "in-transit":         { label: "Proof in transit",    tone: "violet",  next: "Attestcoin is attesting the lock" },
  "ready":              { label: "Funds ready",         tone: "green",   next: "Claim the line on Creditcoin" },
  "expired":            { label: "Claim window closed", tone: "red",     next: "Escrow must be released and re-locked" },
  "active":             { label: "Active line",         tone: "green",   next: "Draw or repay any time" },
  "repaid":             { label: "Repaid",              tone: "grey",    next: "Line closed in full" },
};

export interface PhaseInfo {
  phase: Phase;
  /** Source blocks until the lock is attested; 0 once it is. */
  blocksToGo: number | null;
  /** Seconds until attestation, from the measured rate or block time. */
  eta: number | null;
  /** Source blocks left before the lock is too old to claim. */
  claimBlocksLeft: number | null;
  /** Seconds of valuation freshness left, negative once stale. */
  freshnessLeft: number | null;
}

export function phaseOf(
  rec: PortfolioRecord | undefined,
  att: AttestationStatus,
  params: Params | null,
  now = Date.now(),
): PhaseInfo {
  const info: PhaseInfo = { phase: "unregistered", blocksToGo: null, eta: null, claimBlocksLeft: null, freshnessLeft: null };
  if (!rec) return info;

  if (rec.activeLine) return { ...info, phase: "active" };
  // A closed line is the end of the story unless the portfolio was locked again since —
  // i.e. the latest lock is not the one that line spent.
  const lastLine = rec.lines[rec.lines.length - 1];
  if (lastLine && (!rec.locked || !lastLine.lock || lastLine.lock.tx === rec.lastLock?.tx)) {
    return { ...info, phase: "repaid" };
  }

  if (rec.locked && rec.lastLock) {
    const lockBlock = rec.lastLock.block;
    const attested = att.attested;
    if (attested === null) return { ...info, phase: "in-transit" };
    if (attested < lockBlock) {
      const blocksToGo = lockBlock - attested;
      const rate = att.rate && att.rate > 0 ? att.rate : 1 / SEPOLIA_BLOCK_SECONDS;
      return { ...info, phase: "in-transit", blocksToGo, eta: blocksToGo / rate };
    }
    const age = attested - lockBlock;
    const claimBlocksLeft = params ? params.maxLockAge - age : null;
    if (claimBlocksLeft !== null && claimBlocksLeft < 0) {
      return { ...info, phase: "expired", blocksToGo: 0, claimBlocksLeft };
    }
    return { ...info, phase: "ready", blocksToGo: 0, eta: 0, claimBlocksLeft };
  }

  if (rec.value === 0n) return { ...info, phase: "awaiting-valuation" };

  const freshnessLeft =
    params && rec.valuedAt !== undefined
      ? params.maxValuationAge - (now - rec.valuedAt) / 1000
      : null;
  if (freshnessLeft !== null && freshnessLeft < 0) return { ...info, phase: "stale", freshnessLeft };
  return { ...info, phase: "offer", freshnessLeft };
}

export function creditFor(value: bigint, params: Params | null): bigint {
  return (value * BigInt(params?.ltvBps ?? 8000)) / 10_000n;
}
