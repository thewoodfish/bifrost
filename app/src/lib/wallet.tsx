import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createWalletClient, custom, type Address, type WalletClient } from "viem";
import { creditcoin, origin } from "./chains";

type Eip1193 = {
  request: (a: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (e: string, h: (...a: any[]) => void) => void;
  removeListener?: (e: string, h: (...a: any[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: Eip1193;
  }
}

interface WalletState {
  address: Address | null;
  chainId: number | null;
  connecting: boolean;
  error: string | null;
  available: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  /** Switch the wallet to `chainId`, adding the network first if it is unknown. */
  switchTo: (chainId: number) => Promise<void>;
  clientFor: (chainId: number) => WalletClient;
}

const Ctx = createContext<WalletState | null>(null);

const CHAIN_PARAMS: Record<number, Record<string, unknown>> = {
  [creditcoin.id]: {
    chainId: `0x${creditcoin.id.toString(16)}`,
    chainName: creditcoin.name,
    nativeCurrency: creditcoin.nativeCurrency,
    rpcUrls: [...creditcoin.rpcUrls.default.http],
    blockExplorerUrls: [creditcoin.blockExplorers.default.url],
  },
};

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const available = typeof window !== "undefined" && !!window.ethereum;

  const readChain = useCallback(async () => {
    if (!window.ethereum) return;
    const id = (await window.ethereum.request({ method: "eth_chainId" })) as string;
    setChainId(Number.parseInt(id, 16));
  }, []);

  // Restore an existing authorisation without prompting. A refresh mid-attestation must
  // not look like a disconnect.
  useEffect(() => {
    if (!window.ethereum) return;
    (async () => {
      const accounts = (await window.ethereum!.request({ method: "eth_accounts" })) as string[];
      if (accounts?.length) {
        setAddress(accounts[0] as Address);
        await readChain();
      }
    })().catch(() => undefined);
  }, [readChain]);

  useEffect(() => {
    if (!window.ethereum?.on) return;
    const onAccounts = (a: string[]) => setAddress((a?.[0] as Address) ?? null);
    const onChain = (id: string) => setChainId(Number.parseInt(id, 16));
    window.ethereum.on("accountsChanged", onAccounts);
    window.ethereum.on("chainChanged", onChain);
    return () => {
      window.ethereum?.removeListener?.("accountsChanged", onAccounts);
      window.ethereum?.removeListener?.("chainChanged", onChain);
    };
  }, []);

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      setError("No browser wallet found. Install MetaMask or another EIP-1193 wallet.");
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const accounts = (await window.ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];
      setAddress((accounts[0] as Address) ?? null);
      await readChain();
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      setError(/user rejected/i.test(msg) ? "Connection request was rejected." : msg);
    } finally {
      setConnecting(false);
    }
  }, [readChain]);

  const disconnect = useCallback(() => {
    setAddress(null);
    setError(null);
  }, []);

  const switchTo = useCallback(async (target: number) => {
    if (!window.ethereum) return;
    const hex = `0x${target.toString(16)}`;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: hex }],
      });
    } catch (e) {
      // 4902: the wallet does not know this chain yet. CC3 is not in any wallet's
      // default list, so adding it is the normal path, not an error path.
      const code = (e as { code?: number }).code;
      if (code === 4902 && CHAIN_PARAMS[target]) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [CHAIN_PARAMS[target]],
        });
      } else {
        throw e;
      }
    }
  }, []);

  const clientFor = useCallback(
    (id: number) =>
      createWalletClient({
        chain: id === creditcoin.id ? creditcoin : origin,
        transport: custom(window.ethereum!),
      }),
    [],
  );

  const value = useMemo(
    () => ({ address, chainId, connecting, error, available, connect, disconnect, switchTo, clientFor }),
    [address, chainId, connecting, error, available, connect, disconnect, switchTo, clientFor],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet must be used inside WalletProvider");
  return v;
}
