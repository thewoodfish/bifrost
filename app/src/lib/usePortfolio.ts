import { useCallback, useEffect, useState } from "react";
import { getAbiItem, type Address } from "viem";
import { ENGINE_ABI, VAULT_ABI } from "./abis";
import { config } from "./config";
import { creditcoinClient, originClient } from "./clients";
import { getWatched, watch } from "./store";

export interface Portfolio {
  owner: Address;
  dollarValue: bigint;
  valuationRound: bigint;
  exists: boolean;
  isLocked: boolean;
}

export interface CreditLine {
  borrower: Address;
  portfolioId: bigint;
  attestedValue: bigint;
  creditLimit: bigint;
  drawn: bigint;
  valuationRound: bigint;
  open: boolean;
}

/**
 * Where a portfolio sits in the cross-chain lifecycle.
 *
 * Derived from chain on every load rather than tracked locally: local state that
 * disagrees with the chain is worse than no local state at all.
 */
export type Stage =
  | "unregistered"
  | "registered"   // exists, awaiting a valuation
  | "valued"       // priced by a valuer, not yet locked
  | "locked"       // escrowed on the origin chain; attestation pending or ready
  | "open"         // credit line live on Creditcoin
  | "closed";      // line was opened and fully repaid

export interface PortfolioState {
  portfolio: Portfolio | null;
  line: CreditLine | null;
  stage: Stage;
  lockTx?: string;
  lockBlock?: number;
  lockedAt?: number;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function stageOf(p: Portfolio | null, line: CreditLine | null): Stage {
  if (line?.open) return "open";
  if (line && !line.open && line.creditLimit > 0n) return "closed";
  if (!p?.exists) return "unregistered";
  if (p.isLocked) return "locked";
  if (p.dollarValue > 0n) return "valued";
  return "registered";
}

const LOCKED_EVENT = getAbiItem({ abi: VAULT_ABI, name: "PortfolioLocked" });

/**
 * Public Sepolia RPCs reject `eth_getLogs` spanning more than 1000 blocks, so the search
 * is chunked below that limit rather than issued as one wide range.
 */
const LOG_CHUNK = 800n;
const CHUNK_CONCURRENCY = 5;

/**
 * Recover the lock transaction for a portfolio by searching for its PortfolioLocked
 * event, so a cleared browser or a different machine can still pick the position up.
 *
 * Walks backwards from the head: the lock we want is the most recent one, and a position
 * being recovered is usually days old at most, so the answer normally arrives in the first
 * batch. `windowBlocks` bounds how far back it is worth looking before giving up.
 */
export async function findLockTx(
  portfolioId: bigint,
  windowBlocks = 45_000n,
): Promise<{ txHash: string; blockNumber: number } | null> {
  const head = await originClient.getBlockNumber();
  const floor = head > windowBlocks ? head - windowBlocks : 0n;

  // Chunk boundaries, newest first.
  const ranges: { from: bigint; to: bigint }[] = [];
  for (let to = head; to >= floor; to -= LOG_CHUNK) {
    const from = to > floor + LOG_CHUNK ? to - LOG_CHUNK + 1n : floor;
    ranges.push({ from, to });
    if (from === floor) break;
  }

  for (let i = 0; i < ranges.length; i += CHUNK_CONCURRENCY) {
    const batch = ranges.slice(i, i + CHUNK_CONCURRENCY);
    const results = await Promise.all(
      batch.map((r) =>
        originClient
          .getLogs({
            address: config.originVault,
            event: LOCKED_EVENT,
            args: { portfolioId },
            fromBlock: r.from,
            toBlock: r.to,
          })
          // One bad chunk must not sink the whole search — a later chunk may still answer.
          .catch(() => []),
      ),
    );
    const hits = results.flat();
    if (hits.length > 0) {
      const last = hits.reduce((a, b) => (b.blockNumber! > a.blockNumber! ? b : a));
      return { txHash: last.transactionHash!, blockNumber: Number(last.blockNumber!) };
    }
  }
  return null;
}

export function usePortfolio(portfolioId: string | null): PortfolioState {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [line, setLine] = useState<CreditLine | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lock, setLock] = useState<{ tx?: string; block?: number; at?: number }>({});

  const refresh = useCallback(async () => {
    if (!portfolioId) return;
    setLoading(true);
    setError(null);
    try {
      const id = BigInt(portfolioId);
      const [p, l] = await Promise.all([
        originClient.readContract({
          address: config.originVault, abi: VAULT_ABI, functionName: "getPortfolio", args: [id],
        }) as Promise<Portfolio>,
        creditcoinClient.readContract({
          address: config.poolEngine, abi: ENGINE_ABI, functionName: "getCreditLine", args: [id],
        }) as Promise<CreditLine>,
      ]);
      setPortfolio(p);
      setLine(l);

      const w = getWatched(portfolioId);
      setLock({ tx: w?.lockTx, block: w?.lockBlock, at: w?.lockedAt });

      // Locked on chain but no local record — recover the lock from its event so the
      // position is usable from any browser, not just the one that created it.
      if (p.isLocked && !l.open && !w?.lockTx) {
        const found = await findLockTx(id).catch(() => null);
        if (found) {
          watch(portfolioId, { lockTx: found.txHash, lockBlock: found.blockNumber });
          setLock({ tx: found.txHash, block: found.blockNumber });
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [portfolioId]);

  useEffect(() => {
    setPortfolio(null);
    setLine(null);
    void refresh();
  }, [refresh]);

  return {
    portfolio, line,
    stage: stageOf(portfolio, line),
    lockTx: lock.tx, lockBlock: lock.block, lockedAt: lock.at,
    loading, error, refresh,
  };
}

/** Vault role membership for the connected wallet, so the UI can explain what it cannot do. */
export function useRoles(address: Address | null) {
  const [roles, setRoles] = useState({ originator: false, valuer: false, admin: false, loaded: false });

  useEffect(() => {
    if (!address) {
      setRoles({ originator: false, valuer: false, admin: false, loaded: false });
      return;
    }
    let alive = true;
    (async () => {
      const [originator, valuer, adminAddr] = await Promise.all([
        originClient.readContract({ address: config.originVault, abi: VAULT_ABI, functionName: "isOriginator", args: [address] }) as Promise<boolean>,
        originClient.readContract({ address: config.originVault, abi: VAULT_ABI, functionName: "isValuer", args: [address] }) as Promise<boolean>,
        originClient.readContract({ address: config.originVault, abi: VAULT_ABI, functionName: "admin" }) as Promise<Address>,
      ]);
      if (alive) {
        setRoles({
          originator, valuer,
          admin: adminAddr.toLowerCase() === address.toLowerCase(),
          loaded: true,
        });
      }
    })().catch(() => alive && setRoles((r) => ({ ...r, loaded: true })));
    return () => { alive = false; };
  }, [address]);

  return roles;
}

/**
 * Stage for each watched portfolio, for the sidebar.
 *
 * A separate, cheaper read than `usePortfolio`: the list needs one word per row, not the
 * full position. Failures collapse to "unregistered" rather than blanking the list — a
 * flaky RPC should not make a tracked portfolio look deleted.
 */
export function useStages(ids: string[], nonce = 0): Record<string, Stage> {
  const [stages, setStages] = useState<Record<string, Stage>>({});
  const key = ids.join(",");

  useEffect(() => {
    const list = key ? key.split(",") : [];
    if (list.length === 0) {
      setStages({});
      return;
    }
    let alive = true;
    (async () => {
      const entries = await Promise.all(
        list.map(async (id) => {
          try {
            const bid = BigInt(id);
            const [p, l] = await Promise.all([
              originClient.readContract({
                address: config.originVault, abi: VAULT_ABI, functionName: "getPortfolio", args: [bid],
              }) as Promise<Portfolio>,
              creditcoinClient.readContract({
                address: config.poolEngine, abi: ENGINE_ABI, functionName: "getCreditLine", args: [bid],
              }) as Promise<CreditLine>,
            ]);
            return [id, stageOf(p, l)] as const;
          } catch {
            return [id, "unregistered" as Stage] as const;
          }
        }),
      );
      if (alive) setStages(Object.fromEntries(entries));
    })();
    return () => { alive = false; };
  }, [key, nonce]);

  return stages;
}
