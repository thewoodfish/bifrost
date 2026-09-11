import type { AbiEvent, Address, Hex, PublicClient } from "viem";
import { ENGINE_EVENTS, VAULT_EVENTS } from "./abis";
import { creditcoinClient, originClient } from "./clients";
import { config } from "./config";

/**
 * A browser-side indexer over both halves of the protocol.
 *
 * Every question the product asks — which portfolios does this wallet own, what is the
 * pool lending, which lock backs which line — is answered by the vault's and engine's
 * events. Reading them once and deriving everything else replaces the per-portfolio
 * watch-list and the backwards lock search, and it is what lets a borrower connect a
 * wallet and see their book instead of typing ids.
 *
 * Progress is cached in localStorage per contract, so a reload reads only new blocks.
 * The cache is only ever a head start: a cleared browser rebuilds it from chain.
 */

interface Base {
  block: number;
  tx: Hex;
  logIndex: number;
  /** Block timestamp in ms. Filled in after the log is read; absent if that read failed. */
  ts?: number;
}

/** Distribute over the union so `kind` narrows each member, not the intersection. */
type On<S, U> = U extends unknown ? Base & { side: S } & U : never;

export type VaultEvent = On<"origin",
  | { kind: "registered"; portfolioId: string; owner: Address }
  | { kind: "valued"; portfolioId: string; value: bigint; round: bigint }
  | { kind: "locked"; portfolioId: string; owner: Address; value: bigint; round: bigint }
  | { kind: "unlocked"; portfolioId: string; owner: Address }
  | { kind: "valuer"; account: Address; allowed: boolean }
  | { kind: "originator"; account: Address; allowed: boolean }
>;

export type EngineEvent = On<"creditcoin",
  | {
      kind: "opened"; portfolioId: string; borrower: Address;
      attestedValue: bigint; creditLimit: bigint; round: bigint; receiptId: Hex;
    }
  | { kind: "drawn" | "repaid"; portfolioId: string; borrower: Address; amount: bigint }
  | { kind: "closed"; portfolioId: string }
  | { kind: "interest"; portfolioId: string; payer: Address; amount: bigint; toReserves: bigint }
  | { kind: "deposited"; lp: Address; assets: bigint; shares: bigint }
  | { kind: "withdrawn"; lp: Address; assets: bigint; shares: bigint }
>;

export type ProtocolEvent = VaultEvent | EngineEvent;
export type LockedEvent = Extract<VaultEvent, { kind: "locked" }>;
export type ValuedEvent = Extract<VaultEvent, { kind: "valued" }>;
export type OpenedEvent = Extract<EngineEvent, { kind: "opened" }>;
export type LpEvent = Extract<EngineEvent, { kind: "deposited" | "withdrawn" }>;

// ── Cache ────────────────────────────────────────────────────────────────────

interface Cache<E> {
  /** Last block fully scanned. */
  to: string;
  events: E[];
}

const CACHE_VERSION = 1;

function cacheKey(side: string, address: string) {
  return `bifrost.idx.v${CACHE_VERSION}.${side}.${address.toLowerCase()}`;
}

// bigints do not survive JSON; tag them so they round-trip.
const replacer = (_: string, v: unknown) => (typeof v === "bigint" ? `${v}n` : v);
const reviver = (_: string, v: unknown) =>
  typeof v === "string" && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v;

function loadCache<E>(side: string, address: string): Cache<E> | null {
  try {
    const raw = localStorage.getItem(cacheKey(side, address));
    return raw ? (JSON.parse(raw, reviver) as Cache<E>) : null;
  } catch {
    return null;
  }
}

function saveCache<E>(side: string, address: string, c: Cache<E>) {
  try {
    localStorage.setItem(cacheKey(side, address), JSON.stringify(c, replacer));
  } catch {
    // Quota or private mode: the next load rescans. Slower, never wrong.
  }
}

// ── Scanning ─────────────────────────────────────────────────────────────────

interface ScanPlan {
  side: "origin" | "creditcoin";
  client: PublicClient;
  address: Address;
  events: readonly AbiEvent[];
  fromBlock: bigint;
  /** Public Sepolia RPCs cap eth_getLogs at 1000 blocks; CC3 times out well past 5000. */
  chunk: bigint;
  concurrency: number;
}

const PLANS: ScanPlan[] = [
  {
    side: "origin", client: originClient as PublicClient, address: config.originVault,
    events: VAULT_EVENTS, fromBlock: config.originVaultFromBlock, chunk: 800n, concurrency: 5,
  },
  {
    side: "creditcoin", client: creditcoinClient as PublicClient, address: config.poolEngine,
    events: ENGINE_EVENTS, fromBlock: config.poolEngineFromBlock, chunk: 5000n, concurrency: 3,
  },
];

/**
 * Blocks behind head treated as settled. Anything newer is rescanned on the next pass,
 * so a shallow reorg costs a duplicate read rather than a phantom event.
 */
const SETTLE = 6n;

type RawLog = {
  eventName: string;
  args: Record<string, unknown>;
  blockNumber: bigint;
  transactionHash: Hex;
  logIndex: number;
};

function toEvent(side: "origin" | "creditcoin", l: RawLog): ProtocolEvent | null {
  const base = { block: Number(l.blockNumber), tx: l.transactionHash, logIndex: l.logIndex };
  const a = l.args as Record<string, never>;
  const id = a.portfolioId !== undefined ? String(a.portfolioId) : "";
  if (side === "origin") {
    switch (l.eventName) {
      case "PortfolioRegistered":
        return { ...base, side, kind: "registered", portfolioId: id, owner: a.owner };
      case "PortfolioValued":
        return { ...base, side, kind: "valued", portfolioId: id, value: a.dollarValue, round: a.valuationRound };
      case "PortfolioLocked":
        return { ...base, side, kind: "locked", portfolioId: id, owner: a.owner, value: a.dollarValue, round: a.valuationRound };
      case "PortfolioUnlocked":
        return { ...base, side, kind: "unlocked", portfolioId: id, owner: a.owner };
      case "ValuerSet":
        return { ...base, side, kind: "valuer", account: a.valuer, allowed: a.allowed };
      case "OriginatorSet":
        return { ...base, side, kind: "originator", account: a.originator, allowed: a.allowed };
    }
  } else {
    switch (l.eventName) {
      case "CreditLineOpened":
        return {
          ...base, side, kind: "opened", portfolioId: id, borrower: a.borrower,
          attestedValue: a.attestedValue, creditLimit: a.creditLimit, round: a.valuationRound,
          receiptId: a.receiptId,
        };
      case "Drawn":
        return { ...base, side, kind: "drawn", portfolioId: id, borrower: a.borrower, amount: a.amount };
      case "Repaid":
        return { ...base, side, kind: "repaid", portfolioId: id, borrower: a.borrower, amount: a.amount };
      case "CreditLineClosed":
        return { ...base, side, kind: "closed", portfolioId: id };
      case "InterestPaid":
        return { ...base, side, kind: "interest", portfolioId: id, payer: a.payer, amount: a.interest, toReserves: a.toReserves };
      case "Deposited":
        return { ...base, side, kind: "deposited", lp: a.lp, assets: a.assets, shares: a.shares };
      case "Withdrawn":
        return { ...base, side, kind: "withdrawn", lp: a.lp, assets: a.assets, shares: a.shares };
    }
  }
  return null;
}

async function getLogsRetry(p: ScanPlan, from: bigint, to: bigint): Promise<RawLog[]> {
  const q = () =>
    p.client.getLogs({ address: p.address, events: p.events, fromBlock: from, toBlock: to }) as unknown as Promise<RawLog[]>;
  try {
    return await q();
  } catch {
    await new Promise((r) => setTimeout(r, 800));
    return q();
  }
}

/**
 * Read new events for one contract, advancing only over a contiguous run of successful
 * chunks. A failed chunk halts progress there, so a gap is retried next pass rather than
 * silently skipped.
 */
async function scanOne(p: ScanPlan): Promise<ProtocolEvent[]> {
  const cached = loadCache<ProtocolEvent>(p.side, p.address);
  const head = await p.client.getBlockNumber();
  const start = cached ? BigInt(cached.to) + 1n : p.fromBlock;
  const settled = head > SETTLE ? head - SETTLE : 0n;

  // The cache only ever holds settled events, so all of it stands.
  const kept = cached?.events ?? [];

  const ranges: { from: bigint; to: bigint }[] = [];
  for (let f = start; f <= head; f += p.chunk) {
    const t = f + p.chunk - 1n < head ? f + p.chunk - 1n : head;
    ranges.push({ from: f, to: t });
  }

  const fresh: ProtocolEvent[] = [];
  let reached = start - 1n;
  outer: for (let i = 0; i < ranges.length; i += p.concurrency) {
    const batch = ranges.slice(i, i + p.concurrency);
    const results = await Promise.allSettled(batch.map((r) => getLogsRetry(p, r.from, r.to)));
    for (let j = 0; j < batch.length; j++) {
      const r = results[j];
      if (r.status === "rejected") break outer;
      for (const l of r.value) {
        const e = toEvent(p.side, l);
        if (e) fresh.push(e);
      }
      reached = batch[j].to;
    }
  }

  const all = dedupe([...kept, ...fresh]);
  await fillTimestamps(p.client, all);

  const to = reached < settled ? reached : settled;
  if (to >= start - 1n) {
    saveCache(p.side, p.address, { to: to.toString(), events: all.filter((e) => BigInt(e.block) <= to) });
  }
  return all;
}

function dedupe(events: ProtocolEvent[]): ProtocolEvent[] {
  const seen = new Map<string, ProtocolEvent>();
  for (const e of events) {
    const k = `${e.tx}:${e.logIndex}`;
    // A rescanned log arrives without its timestamp; keep the one already fetched.
    const ts = e.ts ?? seen.get(k)?.ts;
    seen.set(k, ts === undefined ? e : { ...e, ts });
  }
  return [...seen.values()].sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
}

async function fillTimestamps(client: PublicClient, events: ProtocolEvent[]) {
  const blocks = [...new Set(events.filter((e) => e.ts === undefined).map((e) => e.block))];
  const ts = new Map<number, number>();
  for (let i = 0; i < blocks.length; i += 6) {
    await Promise.all(
      blocks.slice(i, i + 6).map(async (b) => {
        try {
          const blk = await client.getBlock({ blockNumber: BigInt(b) });
          ts.set(b, Number(blk.timestamp) * 1000);
        } catch {
          // Leave it unset; relative times degrade to block numbers.
        }
      }),
    );
  }
  for (const e of events) if (e.ts === undefined && ts.has(e.block)) e.ts = ts.get(e.block);
}

export async function scanAll(): Promise<ProtocolEvent[]> {
  const [o, c] = await Promise.all(PLANS.map(scanOne));
  return [...o, ...c];
}

/** Events already on disk, for an instant first paint before the network answers. */
export function cachedEvents(): ProtocolEvent[] {
  return PLANS.flatMap((p) => loadCache<ProtocolEvent>(p.side, p.address)?.events ?? []);
}

// ── Derivation ───────────────────────────────────────────────────────────────

export interface LineRecord {
  portfolioId: string;
  borrower: Address;
  attestedValue: bigint;
  creditLimit: bigint;
  drawn: bigint;
  round: bigint;
  receiptId: Hex;
  opened: OpenedEvent;
  open: boolean;
  /** Interest paid on this line so far. Not part of `drawn`: repayments carry principal only. */
  interestPaid: bigint;
  closedAt?: ProtocolEvent;
  /** The Sepolia lock whose attested receipt opened this line. */
  lock?: LockedEvent;
}

export interface PortfolioRecord {
  id: string;
  owner: Address;
  valuations: ValuedEvent[];
  locks: LockedEvent[];
  lines: LineRecord[];
  history: ProtocolEvent[];
  /** Current valuation per the event log. Live reads remain the authority for writes. */
  value: bigint;
  round: bigint;
  valuedAt?: number;
  locked: boolean;
  lastLock?: LockedEvent;
  activeLine?: LineRecord;
}

export interface ProtocolView {
  portfolios: Record<string, PortfolioRecord>;
  lines: LineRecord[];
  valuers: Address[];
  originators: Address[];
  /** Lender-side history, in order. */
  lpEvents: LpEvent[];
  stats: {
    /** Interest borrowers have paid, protocol reserves included. */
    interestPaid: bigint;
    lenders: number;
    collateralEscrowed: bigint;
    creditExtended: bigint;
    outstanding: bigint;
    linesOpened: number;
    portfolios: number;
    locks: number;
  };
}

/** Order across two chains by wall-clock time where known, else by chain then block. */
export function chronological(a: ProtocolEvent, b: ProtocolEvent): number {
  if (a.ts !== undefined && b.ts !== undefined && a.ts !== b.ts) return a.ts - b.ts;
  if (a.side !== b.side) return a.side === "origin" ? -1 : 1;
  return a.block - b.block || a.logIndex - b.logIndex;
}

export function derive(events: ProtocolEvent[]): ProtocolView {
  const portfolios: Record<string, PortfolioRecord> = {};
  const roles = { valuer: new Map<string, boolean>(), originator: new Map<string, boolean>() };
  const lines: LineRecord[] = [];
  const openByPortfolio = new Map<string, LineRecord>();

  const ensure = (id: string, owner?: Address): PortfolioRecord =>
    (portfolios[id] ??= {
      id, owner: owner ?? ("0x0000000000000000000000000000000000000000" as Address),
      valuations: [], locks: [], lines: [], history: [],
      value: 0n, round: 0n, locked: false,
    });

  const origin = events.filter((e): e is VaultEvent => e.side === "origin");
  const engine = events.filter((e): e is EngineEvent => e.side === "creditcoin");

  for (const e of origin) {
    if (e.kind === "valuer" || e.kind === "originator") {
      roles[e.kind].set(e.account.toLowerCase(), e.allowed);
      continue;
    }
    const p = ensure(e.portfolioId, "owner" in e ? e.owner : undefined);
    p.history.push(e);
    if (e.kind === "registered") p.owner = e.owner;
    if (e.kind === "valued") {
      p.valuations.push(e);
      p.value = e.value;
      p.round = e.round;
      p.valuedAt = e.ts;
    }
    if (e.kind === "locked") {
      p.locks.push(e);
      p.locked = true;
      p.lastLock = e;
    }
    if (e.kind === "unlocked") p.locked = false;
  }

  // Pair each opened line with the lock it proved: same portfolio, same value and
  // round, earliest not already claimed. The engine binds exactly those fields to the
  // receipt, so a match here is the same match the contract made.
  const claimed = new Set<string>();
  const lpEvents: LpEvent[] = [];
  let interestPaid = 0n;
  for (const e of engine) {
    if (e.kind === "deposited" || e.kind === "withdrawn") {
      lpEvents.push(e);
      continue;
    }
    const p = ensure(e.portfolioId);
    p.history.push(e);
    if (e.kind === "opened") {
      const lock = p.locks.find(
        (l) => !claimed.has(l.tx) && l.value === e.attestedValue && l.round === e.round,
      );
      if (lock) claimed.add(lock.tx);
      const line: LineRecord = {
        portfolioId: e.portfolioId, borrower: e.borrower, attestedValue: e.attestedValue,
        creditLimit: e.creditLimit, drawn: 0n, round: e.round, receiptId: e.receiptId,
        opened: e, open: true, lock, interestPaid: 0n,
      };
      lines.push(line);
      p.lines.push(line);
      openByPortfolio.set(e.portfolioId, line);
    } else {
      const line = openByPortfolio.get(e.portfolioId);
      if (!line) continue;
      if (e.kind === "drawn") line.drawn += e.amount;
      if (e.kind === "repaid") line.drawn -= e.amount;
      if (e.kind === "interest") {
        line.interestPaid += e.amount;
        interestPaid += e.amount;
      }
      if (e.kind === "closed") {
        line.open = false;
        line.closedAt = e;
        openByPortfolio.delete(e.portfolioId);
      }
    }
  }

  let collateralEscrowed = 0n;
  for (const p of Object.values(portfolios)) {
    p.history.sort(chronological);
    p.activeLine = p.lines.find((l) => l.open);
    if (p.locked) collateralEscrowed += p.lastLock?.value ?? p.value;
  }

  const openLines = lines.filter((l) => l.open);
  const pick = (m: Map<string, boolean>) =>
    [...m.entries()].filter(([, ok]) => ok).map(([a]) => a as Address);

  return {
    portfolios,
    lines,
    valuers: pick(roles.valuer),
    originators: pick(roles.originator),
    lpEvents,
    stats: {
      interestPaid,
      lenders: new Set(lpEvents.filter((e) => e.kind === "deposited").map((e) => e.lp.toLowerCase())).size,
      collateralEscrowed,
      creditExtended: openLines.reduce((s, l) => s + l.creditLimit, 0n),
      outstanding: openLines.reduce((s, l) => s + l.drawn, 0n),
      linesOpened: lines.length,
      portfolios: Object.keys(portfolios).length,
      locks: origin.filter((e) => e.kind === "locked").length,
    },
  };
}
