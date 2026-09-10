import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { ENGINE_ABI, VAULT_ABI } from "./abis";
import { config } from "./config";
import { creditcoinClient, originClient } from "./clients";

export interface Portfolio {
  owner: Address;
  dollarValue: bigint;
  valuationRound: bigint;
  /** When the current valuation was published. Zero until first valued. */
  valuedAt: bigint;
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

export interface LiveState {
  portfolio: Portfolio | null;
  line: CreditLine | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Current contract state for one portfolio, read straight from both chains.
 *
 * The indexer answers "what happened"; this answers "what is true now", and it is what
 * every write is gated on. Local state that disagrees with the chain is worse than none.
 */
export function usePortfolioLive(portfolioId: string | null): LiveState {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [line, setLine] = useState<CreditLine | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against a slow read for one portfolio landing after the user moved to another.
  const request = useRef(0);

  const refresh = useCallback(async () => {
    if (!portfolioId) return;
    const mine = ++request.current;
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
      if (mine !== request.current) return;
      setPortfolio(p);
      setLine(l);
    } catch (e) {
      if (mine === request.current) setError((e as Error).message);
    } finally {
      if (mine === request.current) setLoading(false);
    }
  }, [portfolioId]);

  useEffect(() => {
    setPortfolio(null);
    setLine(null);
    void refresh();
  }, [refresh]);

  return { portfolio, line, loading, error, refresh };
}

export interface Roles {
  originator: boolean;
  valuer: boolean;
  admin: boolean;
  loaded: boolean;
}

/** Vault role membership for the connected wallet. */
export function useRoles(address: Address | null): Roles {
  const [roles, setRoles] = useState<Roles>({ originator: false, valuer: false, admin: false, loaded: false });

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
