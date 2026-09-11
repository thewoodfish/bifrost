import { useCallback, useState } from "react";
import type { Address, WalletClient } from "viem";
import { creditcoin, explorerTx } from "./chains";
import { useProtocol } from "./protocol";
import { useToasts } from "./toast";
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

const COPY: Record<string, [pending: string, done: string]> = {
  register: ["Registering portfolio", "Portfolio registered"],
  value: ["Publishing valuation", "Valuation published"],
  lock: ["Locking collateral", "Collateral locked — proof in transit"],
  open: ["Opening credit line", "Credit line opened"],
  draw: ["Drawing funds", "Funds sent to your wallet"],
  repay: ["Repaying", "Repayment settled"],
  deposit: ["Depositing", "Deposited — you're earning"],
  withdraw: ["Withdrawing", "Withdrawn to your wallet"],
  mint: ["Minting test USDC", "100,000 tUSDC minted"],
};

/** The hash a write returned, whichever shape its action uses. */
function hashOf(out: unknown): string | undefined {
  if (typeof out === "string") return out;
  const o = out as { txHash?: string; repayTx?: string } | undefined;
  return o?.txHash ?? o?.repayTx;
}

/**
 * One write, end to end: switch the wallet to the right chain, send, wait, then resync
 * every surface. Chain switching is the product's job, not the borrower's — they should
 * never need to know which of the two chains a button lives on.
 */
export function useTx() {
  const { address, chainId, clientFor, switchTo } = useWallet();
  const { sync } = useProtocol();
  const toasts = useToasts();
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
      const [pending, done] = COPY[label] ?? [label, `${label} confirmed`];
      const where = chain === creditcoin.id ? "Creditcoin" : "Sepolia";
      setBusy(label);
      setError(null);
      const t = toasts.push({ tone: "loading", title: pending, body: `Confirm in your wallet · ${where}` });
      try {
        if (chainId !== chain) await switchTo(chain);
        const out = await fn(clientFor(chain), address);
        const hash = hashOf(out);
        toasts.update(t, {
          tone: "success", title: done, body: `Confirmed on ${where}`,
          href: hash ? explorerTx(chain, hash) : undefined, hrefLabel: "View transaction",
        });
        await Promise.all([sync(), after?.()]);
        return out;
      } catch (e) {
        const msg = explainTxError(e, chain);
        toasts.update(t, { tone: "error", title: /cancelled/.test(msg) ? "Cancelled" : `${pending} failed`, body: msg });
        setError(msg);
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [address, chainId, clientFor, switchTo, sync, toasts],
  );

  return { busy, error, setError, run };
}
