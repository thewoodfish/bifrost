import { useState } from "react";
import { formatUnits } from "viem";
import { draw, repay } from "../lib/actions";
import { config } from "../lib/config";
import { creditcoin, explorerTx } from "../lib/chains";
import { usd } from "../lib/format";
import type { CreditLine } from "../lib/usePortfolio";
import { useWallet } from "../lib/wallet";

type Mode = "draw" | "repay";

/**
 * Draw and repay against an open line.
 *
 * Both are capped by what is actually possible — undrawn headroom, or outstanding debt —
 * because a wallet prompt that reverts is worse than a disabled button.
 */
export function CreditControls({
  line, portfolioId, balance, onDone,
}: {
  line: CreditLine;
  portfolioId: bigint;
  balance: bigint | null;
  onDone: () => void;
}) {
  const { address, chainId, clientFor, switchTo } = useWallet();
  const [mode, setMode] = useState<Mode>("draw");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tx, setTx] = useState<string | null>(null);

  const isBorrower = !!address && address.toLowerCase() === line.borrower.toLowerCase();
  const headroom = line.creditLimit - line.drawn;
  const max = mode === "draw" ? headroom : line.drawn;
  const maxStr = formatUnits(max, config.decimals);

  const parsed = Number(amount);
  const valid =
    amount.trim() !== "" && Number.isFinite(parsed) && parsed > 0 && parsed <= Number(maxStr);

  const insufficientBalance =
    mode === "repay" && balance !== null && valid && balance < BigInt(Math.round(parsed * 1e6));

  async function run() {
    if (!address || !valid) return;
    setBusy(true);
    setErr(null);
    setTx(null);
    try {
      if (chainId !== creditcoin.id) await switchTo(creditcoin.id);
      const w = clientFor(creditcoin.id);
      const hash =
        mode === "draw"
          ? await draw(w, address, portfolioId, amount)
          : (await repay(w, address, portfolioId, amount)).repayTx;
      setTx(hash);
      setAmount("");
      onDone();
    } catch (e) {
      const m = (e as Error).message ?? String(e);
      setErr(/user rejected|denied/i.test(m) ? "Transaction rejected in wallet." : m);
    } finally {
      setBusy(false);
    }
  }

  if (!isBorrower) {
    return (
      <div className="notice">
        This line belongs to another address. Connect as the borrower to draw or repay.
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="row">
        <button
          className={mode === "draw" ? "primary" : "ghost"}
          onClick={() => { setMode("draw"); setAmount(""); setErr(null); }}
        >
          Draw
        </button>
        <button
          className={mode === "repay" ? "primary" : "ghost"}
          onClick={() => { setMode("repay"); setAmount(""); setErr(null); }}
        >
          Repay
        </button>
        <span className="dim small">
          {mode === "draw" ? `${usd(headroom)} available` : `${usd(line.drawn)} outstanding`}
        </span>
      </div>

      <div className="field-row">
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={`Amount in USD (max ${Number(maxStr).toLocaleString()})`}
          inputMode="decimal"
          aria-label={`${mode} amount`}
        />
        <button className="ghost" onClick={() => setAmount(maxStr)} disabled={max === 0n}>
          Max
        </button>
        <button
          className="warm"
          onClick={run}
          disabled={!valid || busy || max === 0n || insufficientBalance}
        >
          {busy ? "Confirming…" : mode === "draw" ? "Draw" : "Repay"}
        </button>
      </div>

      {insufficientBalance && (
        <div className="notice warn">
          Wallet holds {usd(balance ?? 0n)} — not enough to repay that amount.
        </div>
      )}

      {mode === "repay" && (
        <div className="dim small">
          Repaying approves the engine for the exact amount first, if its allowance is short.
        </div>
      )}

      {err && (
        <div className="notice error">
          <div className="notice-title">Transaction failed</div>
          <span className="small">{err}</span>
        </div>
      )}

      {tx && (
        <div className="notice ok small">
          Confirmed ·{" "}
          <a href={explorerTx(creditcoin.id, tx)} target="_blank" rel="noreferrer">
            view on Blockscout
          </a>
        </div>
      )}
    </div>
  );
}
