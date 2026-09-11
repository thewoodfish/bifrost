import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { derive, type ProtocolEvent } from "../indexer";
import { creditFor, phaseOf } from "../phase";
import type { Params } from "../protocol";
import type { AttestationStatus } from "../useAttestation";

/**
 * The indexer turns raw vault and engine events into portfolios, and phaseOf turns a
 * portfolio into the one question a borrower has: what happens next? Every screen reads
 * these two, so they are tested as a pair across the whole lifecycle.
 */

const OWNER = "0x3656abd007aed9b9a572a63c58447044d69f8daf" as Address;
const M = 1_000_000n; // one dollar at 6 decimals
const NOW = Date.UTC(2026, 8, 11, 12);
const params: Params = { ltvBps: 8000, maxLockAge: 7200, maxValuationAge: 7 * 86_400 };

let n = 0;
const tx = () => `0x${(++n).toString(16).padStart(64, "0")}` as Hex;
const base = (block: number, ts = NOW) => ({ block, tx: tx(), logIndex: 0, ts });

const registered = (id: string, block: number): ProtocolEvent =>
  ({ ...base(block), side: "origin", kind: "registered", portfolioId: id, owner: OWNER });
const valued = (id: string, block: number, dollars: bigint, round = 1n, ts = NOW): ProtocolEvent =>
  ({ ...base(block, ts), side: "origin", kind: "valued", portfolioId: id, value: dollars * M, round });
const locked = (id: string, block: number, dollars: bigint, round = 1n): ProtocolEvent =>
  ({ ...base(block), side: "origin", kind: "locked", portfolioId: id, owner: OWNER, value: dollars * M, round });
const opened = (id: string, dollars: bigint, round = 1n): ProtocolEvent => ({
  ...base(500), side: "creditcoin", kind: "opened", portfolioId: id, borrower: OWNER,
  attestedValue: dollars * M, creditLimit: (dollars * M * 8000n) / 10_000n, round, receiptId: tx(),
});
const moved = (kind: "drawn" | "repaid", id: string, dollars: bigint): ProtocolEvent =>
  ({ ...base(501), side: "creditcoin", kind, portfolioId: id, borrower: OWNER, amount: dollars * M });
const closed = (id: string): ProtocolEvent => ({ ...base(502), side: "creditcoin", kind: "closed", portfolioId: id });

const att = (attested: number | null): AttestationStatus =>
  ({ originHead: 1000, attested, behind: attested === null ? null : 1000 - attested, rate: 1 / 12, loading: false, error: null });

const phase = (events: ProtocolEvent[], a = att(1000), now = NOW) =>
  phaseOf(derive(events).portfolios["7"], a, params, now);

describe("phaseOf across the lifecycle", () => {
  it("is 'unregistered' for an unknown id", () => {
    expect(phaseOf(undefined, att(1000), params).phase).toBe("unregistered");
  });

  it("waits on a valuer after registration", () => {
    expect(phase([registered("7", 1)]).phase).toBe("awaiting-valuation");
  });

  it("offers 80% of a fresh valuation, and reports freshness left", () => {
    const p = phase([registered("7", 1), valued("7", 2, 1_000_000n)]);
    expect(p.phase).toBe("offer");
    expect(p.freshnessLeft).toBeCloseTo(7 * 86_400, 0);
  });

  it("pauses the offer once the valuation is older than maxValuationAge", () => {
    const eightDaysAgo = NOW - 8 * 86_400_000;
    const p = phase([registered("7", 1), valued("7", 2, 1_000_000n, 1n, eightDaysAgo)]);
    expect(p.phase).toBe("stale");
    expect(p.freshnessLeft!).toBeLessThan(0);
  });

  it("is in transit until the frontier reaches the lock, with a measured ETA", () => {
    const evs = [registered("7", 1), valued("7", 2, 1_000_000n), locked("7", 900, 1_000_000n)];
    const p = phase(evs, att(840));
    expect(p.phase).toBe("in-transit");
    expect(p.blocksToGo).toBe(60);
    expect(p.eta).toBeCloseTo(720, 0); // 60 blocks at 12 s
  });

  it("is claimable once attested, with the claim window counted down", () => {
    const evs = [registered("7", 1), valued("7", 2, 1_000_000n), locked("7", 900, 1_000_000n)];
    const p = phase(evs, att(1000));
    expect(p.phase).toBe("ready");
    expect(p.claimBlocksLeft).toBe(7200 - 100);
  });

  it("closes the claim window past maxLockAge, as the engine's LockTooOld does", () => {
    const evs = [registered("7", 1), valued("7", 2, 1_000_000n), locked("7", 900, 1_000_000n)];
    expect(phase(evs, att(900 + 7201)).phase).toBe("expired");
    expect(phase(evs, att(900 + 7200)).phase).toBe("ready");
  });

  it("is active once a line opens, and repaid once it closes", () => {
    const evs = [registered("7", 1), valued("7", 2, 1_000_000n), locked("7", 900, 1_000_000n), opened("7", 1_000_000n)];
    expect(phase(evs).phase).toBe("active");
    expect(phase([...evs, moved("drawn", "7", 100n), moved("repaid", "7", 100n), closed("7")]).phase).toBe("repaid");
  });
});

describe("derive", () => {
  it("tracks drawn balance and pairs each line with the lock it proved", () => {
    const lock = locked("7", 900, 750_000n);
    const v = derive([
      registered("7", 1), valued("7", 2, 750_000n), lock, opened("7", 750_000n),
      moved("drawn", "7", 200_000n), moved("repaid", "7", 50_000n),
    ]);
    const line = v.portfolios["7"].activeLine!;
    expect(line.creditLimit).toBe(600_000n * M);
    expect(line.drawn).toBe(150_000n * M);
    expect(line.lock?.tx).toBe((lock as { tx: Hex }).tx);
    expect(v.stats.creditExtended).toBe(600_000n * M);
    expect(v.stats.outstanding).toBe(150_000n * M);
    expect(v.stats.collateralEscrowed).toBe(750_000n * M);
  });

  it("does not pair a line with a lock of a different value", () => {
    const v = derive([registered("7", 1), valued("7", 2, 750_000n), locked("7", 900, 750_000n), opened("7", 999_999n)]);
    expect(v.portfolios["7"].activeLine!.lock).toBeUndefined();
  });

  it("drops a closed line from outstanding and credit extended", () => {
    const v = derive([
      registered("7", 1), valued("7", 2, 100n), locked("7", 900, 100n), opened("7", 100n),
      moved("drawn", "7", 10n), moved("repaid", "7", 10n), closed("7"),
    ]);
    expect(v.stats.outstanding).toBe(0n);
    expect(v.stats.creditExtended).toBe(0n);
    expect(v.stats.linesOpened).toBe(1);
  });
});

describe("creditFor", () => {
  it("applies the advance rate", () => {
    expect(creditFor(750_000n * M, params)).toBe(600_000n * M);
    expect(creditFor(750_000n * M, null)).toBe(600_000n * M); // defaults to 80%
  });
});
