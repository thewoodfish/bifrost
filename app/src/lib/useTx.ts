import { useCallback, useState } from "react";
import type { Address, WalletClient } from "viem";
import { creditcoin } from "./chains";
import { useProtocol } from "./protocol";
import { useWallet } from "./wallet";

/** Turn a wallet or RPC failure into a sentence a borrower can act on. */
export function explainTxError(e: unknown, chain: number): string {
  const err = e as { shortMessage?: string; message?: string };
  const m = `${err.shortMessage ?? ""} ${err.message ?? ""}`;
  if (/user rejected|denied|rejected the request/i.test(m)) return "You cancelled the request in your wallet.";
  if (/insufficient funds/i.test(m)) {
    return chain === creditcoin.id
      ? "This wallet has no CTC to pay Creditcoin gas. Fund it from the Creditcoin testnet faucet and retry."
      : "This wallet has no Sepolia ETH for gas. Fund it from a Sepolia faucet and retry.";
  }
  return err.shortMessage ?? err.message ?? String(e);
}

/**
 * One write, end to end: switch the wallet to the right chain, send, wait, then resync
 * every surface. Chain switching is the product's job, not the borrower's — they should
 * never need to know which of the two chains a button lives on.
 */
export function useTx() {
  const { address, chainId, clientFor, switchTo } = useWallet();
  const { sync } = useProtocol();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async <T,>(
      label: string,
      chain: number,
      fn: (w: WalletClient, a: Address) => Promise<T>,
      after?: () => unknown,
    ): Promise<T | undefined> => {
      if (!address) return undefined;
      setBusy(label);
      setError(null);
      try {
        if (chainId !== chain) await switchTo(chain);
        const out = await fn(clientFor(chain), address);
        await Promise.all([sync(), after?.()]);
        return out;
      } catch (e) {
        setError(explainTxError(e, chain));
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [address, chainId, clientFor, switchTo, sync],
  );

  return { busy, error, setError, run };
}
