import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ENGINE_ABI, VAULT_ABI } from "./abis";
import { poolState, type PoolState } from "./actions";
import { creditcoinClient, originClient } from "./clients";
import { config } from "./config";
import { cachedEvents, derive, scanAll, type ProtocolEvent, type ProtocolView } from "./indexer";
import { useAttestationStatus, type AttestationStatus } from "./useAttestation";

export interface Params {
  ltvBps: number;
  /** Source blocks a lock may trail the attestation frontier and still be claimed. */
  maxLockAge: number;
  /** Seconds a valuation stays fresh enough to lock against. */
  maxValuationAge: number;
}

interface ProtocolState extends ProtocolView {
  events: ProtocolEvent[];
  /** True once the first network scan has landed (cached data may show before that). */
  synced: boolean;
  syncing: boolean;
  error: string | null;
  /** Stablecoin available to draw or withdraw now (idle liquidity, reserves excluded). */
  liquidity: bigint | null;
  pool: PoolState | null;
  params: Params | null;
  attestation: AttestationStatus;
  /** Rescan now — call after any write so every surface reflects it. */
  sync: () => Promise<void>;
}

const Ctx = createContext<ProtocolState | null>(null);

const POLL_MS = 30_000;

export function ProtocolProvider({ children }: { children: React.ReactNode }) {
  const [events, setEvents] = useState<ProtocolEvent[]>(() => cachedEvents());
  const [synced, setSynced] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pool, setPool] = useState<PoolState | null>(null);
  const [params, setParams] = useState<Params | null>(null);
  const attestation = useAttestationStatus();
  const inflight = useRef<Promise<void> | null>(null);

  const sync = useCallback(() => {
    // Coalesce: a write and the poll firing together should cost one scan.
    if (inflight.current) return inflight.current;
    const run = (async () => {
      setSyncing(true);
      try {
        const [evs, p] = await Promise.all([scanAll(), poolState().catch(() => null)]);
        setEvents(evs);
        if (p !== null) setPool(p);
        setError(null);
        setSynced(true);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setSyncing(false);
        inflight.current = null;
      }
    })();
    inflight.current = run;
    return run;
  }, []);

  useEffect(() => {
    void sync();
    const id = setInterval(() => void sync(), POLL_MS);
    return () => clearInterval(id);
  }, [sync]);

  useEffect(() => {
    Promise.all([
      creditcoinClient.readContract({ address: config.poolEngine, abi: ENGINE_ABI, functionName: "ltvBps" }),
      creditcoinClient.readContract({ address: config.poolEngine, abi: ENGINE_ABI, functionName: "maxLockAge" }),
      originClient.readContract({ address: config.originVault, abi: VAULT_ABI, functionName: "maxValuationAge" }),
    ])
      .then(([ltv, lockAge, valAge]) =>
        setParams({ ltvBps: Number(ltv), maxLockAge: Number(lockAge), maxValuationAge: Number(valAge) }),
      )
      .catch(() => undefined);
  }, []);

  const view = useMemo(() => derive(events), [events]);

  const value = useMemo(
    () => ({ ...view, events, synced, syncing, error, liquidity: pool?.idle ?? null, pool, params, attestation, sync }),
    [view, events, synced, syncing, error, pool, params, attestation, sync],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProtocol(): ProtocolState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useProtocol must be used inside ProtocolProvider");
  return v;
}
