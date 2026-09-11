import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
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

/** An installed wallet, as announced over EIP-6963. */
export interface WalletOption {
  /** Reverse-DNS id, e.g. `io.rabby` or `io.metamask`. Stable across reloads. */
  rdns: string;
  name: string;
  /** Data URI supplied by the wallet itself. */
  icon: string;
  provider: Eip1193;
}

interface WalletState {
  address: Address | null;
  chainId: number | null;
  connecting: boolean;
  error: string | null;
  /** True when at least one wallet is installed. */
  available: boolean;
  wallets: WalletOption[];
  /** The wallet in use, once connected. */
  wallet: WalletOption | null;
  /** Open the picker (or connect straight away when only one wallet is installed). */
  connect: () => Promise<void>;
  connectWith: (w: WalletOption) => Promise<void>;
  disconnect: () => void;
  picking: boolean;
  closePicker: () => void;
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

/** Where the chosen wallet is remembered, so a reload reconnects to it and not to whichever
 *  extension happened to claim `window.ethereum`. */
const CHOICE_KEY = "bifrost.wallet";
/** Legacy injected provider, for wallets that don't announce over EIP-6963. */
const INJECTED = "injected";

function loadChoice(): string | null {
  try {
    return localStorage.getItem(CHOICE_KEY);
  } catch {
    return null;
  }
}

function saveChoice(rdns: string | null) {
  try {
    if (rdns) localStorage.setItem(CHOICE_KEY, rdns);
    else localStorage.removeItem(CHOICE_KEY);
  } catch {
    // Private mode: the wallet just isn't remembered across reloads.
  }
}

/**
 * True when a switch failed because the wallet has never heard of the chain. MetaMask says
 * so with code 4902; other wallets nest the code, stringify it, or only say it in words —
 * Rabby answers "Unrecognized chain ID … Try adding the chain … first". CC3 is in no
 * wallet's default list, so this is the normal first-use path, not an edge case.
 */
export function isUnknownChainError(e: unknown): boolean {
  const err = e as { code?: unknown; message?: string; data?: { originalError?: { code?: unknown } } };
  const codes = [err?.code, err?.data?.originalError?.code].map((c) => Number(c));
  if (codes.includes(4902)) return true;
  return /unrecognized chain|unknown chain|chain.*not (been )?added|not added|try adding the chain|wallet_addEthereumChain/i.test(err?.message ?? "");
}

/** Collect wallets announced over EIP-6963 (and keep collecting: extensions load late). */
function useAnnouncedWallets(): WalletOption[] {
  const [wallets, setWallets] = useState<WalletOption[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ info: { rdns: string; name: string; icon: string }; provider: Eip1193 }>).detail;
      if (!d?.info?.rdns || !d.provider) return;
      setWallets((ws) =>
        ws.some((w) => w.rdns === d.info.rdns)
          ? ws
          : [...ws, { rdns: d.info.rdns, name: d.info.name, icon: d.info.icon, provider: d.provider }],
      );
    };
    window.addEventListener("eip6963:announceProvider", on);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return () => window.removeEventListener("eip6963:announceProvider", on);
  }, []);
  return wallets;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const announced = useAnnouncedWallets();
  const [wallet, setWallet] = useState<WalletOption | null>(null);
  const [address, setAddress] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const restored = useRef(false);

  // Every option on offer: announced wallets, plus the legacy injected provider when no
  // wallet announces itself (older extensions, and the headless test harness).
  const wallets = useMemo<WalletOption[]>(() => {
    if (announced.length || typeof window === "undefined" || !window.ethereum) return announced;
    return [{ rdns: INJECTED, name: "Browser wallet", icon: "", provider: window.ethereum }];
  }, [announced]);

  const available = wallets.length > 0;

  const readChain = useCallback(async (p: Eip1193) => {
    const id = (await p.request({ method: "eth_chainId" })) as string;
    setChainId(Number.parseInt(id, 16));
  }, []);

  // Reconnect silently to the wallet chosen last time — never to a different one. A refresh
  // mid-attestation must not look like a disconnect, nor quietly swap accounts.
  useEffect(() => {
    if (restored.current || !wallets.length) return;
    const choice = loadChoice();
    const w = choice ? wallets.find((x) => x.rdns === choice) : wallets.length === 1 && wallets[0].rdns === INJECTED ? wallets[0] : undefined;
    if (!w) {
      // The remembered wallet may still be announcing; give extensions a moment.
      if (choice) return;
      restored.current = true;
      return;
    }
    restored.current = true;
    (async () => {
      const accounts = (await w.provider.request({ method: "eth_accounts" })) as string[];
      if (accounts?.length) {
        setWallet(w);
        setAddress(accounts[0] as Address);
        await readChain(w.provider);
      }
    })().catch(() => undefined);
  }, [wallets, readChain]);

  useEffect(() => {
    const p = wallet?.provider;
    if (!p?.on) return;
    const onAccounts = (a: string[]) => setAddress((a?.[0] as Address) ?? null);
    const onChain = (id: string) => setChainId(Number.parseInt(id, 16));
    p.on("accountsChanged", onAccounts);
    p.on("chainChanged", onChain);
    return () => {
      p.removeListener?.("accountsChanged", onAccounts);
      p.removeListener?.("chainChanged", onChain);
    };
  }, [wallet]);

  const connectWith = useCallback(async (w: WalletOption) => {
    setConnecting(true);
    setError(null);
    try {
      // Ask for permissions rather than accounts, so the wallet shows its account picker
      // instead of reusing whichever account it last handed out.
      try {
        await w.provider.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
      } catch (e) {
        if (/reject|denied|cancel/i.test((e as Error).message ?? "")) throw e;
        // Wallet doesn't support it; eth_requestAccounts below still prompts if needed.
      }
      const accounts = (await w.provider.request({ method: "eth_requestAccounts" })) as string[];
      setWallet(w);
      setAddress((accounts[0] as Address) ?? null);
      saveChoice(w.rdns);
      setPicking(false);
      await readChain(w.provider);
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      setError(/reject|denied|cancel/i.test(msg) ? "Connection request was rejected." : msg);
    } finally {
      setConnecting(false);
    }
  }, [readChain]);

  const connect = useCallback(async () => {
    if (!wallets.length) {
      setError("No browser wallet found. Install MetaMask, Rabby or another EIP-1193 wallet.");
      return;
    }
    if (wallets.length === 1) return connectWith(wallets[0]);
    setError(null);
    setPicking(true);
  }, [wallets, connectWith]);

  const disconnect = useCallback(() => {
    // Ask the wallet to forget this site too, where it supports that; otherwise the next
    // connect would be granted silently with the same account.
    wallet?.provider
      .request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] })
      .catch(() => undefined);
    saveChoice(null);
    setWallet(null);
    setAddress(null);
    setChainId(null);
    setError(null);
  }, [wallet]);

  const switchTo = useCallback(async (target: number) => {
    const p = wallet?.provider;
    if (!p) return;
    const hex = `0x${target.toString(16)}`;
    const request = () => p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
    try {
      await request();
    } catch (e) {
      if (!isUnknownChainError(e) || !CHAIN_PARAMS[target]) throw e;
      await p.request({ method: "wallet_addEthereumChain", params: [CHAIN_PARAMS[target]] });
      // Some wallets add without switching; ask again, now that the chain is known.
      await request().catch(() => undefined);
    }
    const now = Number.parseInt((await p.request({ method: "eth_chainId" })) as string, 16);
    setChainId(now);
    if (now !== target) {
      throw new Error(`Your wallet is still on chain ${now}. Switch it to ${target === creditcoin.id ? "Creditcoin CC3 testnet" : "Sepolia"} and try again.`);
    }
  }, [wallet]);

  const clientFor = useCallback(
    (id: number) => {
      if (!wallet) throw new Error("Connect a wallet first.");
      return createWalletClient({
        chain: id === creditcoin.id ? creditcoin : origin,
        transport: custom(wallet.provider),
      });
    },
    [wallet],
  );

  const value = useMemo(
    () => ({
      address, chainId, connecting, error, available, wallets, wallet, connect, connectWith,
      disconnect, picking, closePicker: () => setPicking(false), switchTo, clientFor,
    }),
    [address, chainId, connecting, error, available, wallets, wallet, connect, connectWith, disconnect, picking, switchTo, clientFor],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet must be used inside WalletProvider");
  return v;
}
