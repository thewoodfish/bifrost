import { useEffect, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { draw, owed, repay, stablecoinBalance } from "../lib/actions";
import { creditcoin } from "../lib/chains";
import { config } from "../lib/config";
import { usd } from "../lib/format";
import { useProtocol } from "../lib/protocol";
import type { CreditLine } from "../lib/usePortfolio";
import { useTx } from "../lib/useTx";
import { useWallet } from "../lib/wallet";
import { Link } from "../lib/router";
import { Check, Notice, Spinner } from "./ui";

type Mode = "draw" | "repay";

/** Interest is small and moving, so it shows cents; everything else rounds to dollars. */
function usdCents(v: bigint): string {
  return (Number(v) / 10 ** config.decimals).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const YEAR = 365 * 86_400;
/** Headroom on "pay in full": interest keeps accruing between reading it and mining. The
 *  contract charges only what is owed, so the excess is never taken. */
const PAYOFF_BUFFER_SECONDS = 3_600;

/**
 * Interest owed right now, read from the engine and then ticked forward locally at the
 * line's rate, so the number moves like a real balance between reads.
 */
function useInterest(portfolioId: string, principal: bigint, rateBps: number) {
  const [read, setRead] = useState<{ interest: bigint; at: number } | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () =>
      owed(BigInt(portfolioId))
        .then((o) => alive && setRead({ interest: o.interest, at: Date.now() }))
        .catch(() => undefined);
    void load();
    const poll = setInterval(load, 15_000);
    const t = setInterval(() => tick((n) => n + 1), 1_000);
    return () => { alive = false; clearInterval(poll); clearInterval(t); };
  }, [portfolioId, principal]);

  const perSecond = (principal * BigInt(rateBps)) / BigInt(10_000 * YEAR);
  if (!read) return { interest: null, perSecond };
  const elapsed = BigInt(Math.floor((Date.now() - read.at) / 1000));
  return { interest: read.interest + perSecond * elapsed, perSecond };
}

/**
 * An open line, presented like a bank account: what you can spend, what you owe, and two
 * verbs. Amounts are capped by what the contract would accept, because a wallet prompt
 * that reverts is worse than a disabled button.
 */
export function CreditAccount({
  line, portfolioId, onChange,
}: { line: CreditLine; portfolioId: string; onChange: () => unknown }) {
  const { address } = useWallet();
  const { pool } = useProtocol();
  const { busy, error, setError, run } = useTx();
  const rateBps = pool?.borrowRateBps ?? 800;
  const { interest, perSecond } = useInterest(portfolioId, line.drawn, rateBps);
  const [mode, setMode] = useState<Mode>("draw");
  const [amount, setAmount] = useState("");
  const [balance, setBalance] = useState<bigint | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const isBorrower = !!address && address.toLowerCase() === line.borrower.toLowerCase();
  const available = line.creditLimit - line.drawn;
  const usedPct = line.creditLimit > 0n ? Number((line.drawn * 10_000n) / line.creditLimit) / 100 : 0;
  const debt = line.drawn + (interest ?? 0n);
  const payoff = debt + perSecond * BigInt(PAYOFF_BUFFER_SECONDS);
  const max = mode === "draw" ? available : payoff;

  useEffect(() => {
    if (!address) return setBalance(null);
    stablecoinBalance(address).then(setBalance).catch(() => setBalance(null));
  }, [address, line.drawn]);

  const clean = amount.replace(/[,$\s]/g, "");
  let parsed: bigint | null = null;
  try {
    parsed = /^\d+(\.\d{0,6})?$/.test(clean) && Number(clean) > 0 ? parseUnits(clean, config.decimals) : null;
  } catch {
    parsed = null;
  }
  const over = parsed !== null && parsed > max;
  const short = mode === "repay" && parsed !== null && balance !== null && parsed > balance;

  const preset = (fraction: number) => {
    const v = fraction === 1 ? max : (max * BigInt(Math.round(fraction * 100))) / 100n;
    setAmount(formatUnits(v, config.decimals));
    setError(null);
  };

  const submit = async () => {
    if (!parsed || over || short) return;
    setDone(null);
    const label = mode === "draw" ? `Drew ${usd(parsed)}` : `Repaid ${usd(parsed)}`;
    const ok = await run(mode, creditcoin.id, (w, a) =>
      mode === "draw" ? draw(w, a, BigInt(portfolioId), clean) : repay(w, a, BigInt(portfolioId), clean).then((r) => r.repayTx),
      onChange,
    );
    if (ok) {
      setAmount("");
      setDone(label);
    }
  };

  return (
    <div className="account card">
      <div className="account-top">
        <div>
          <div className="eyebrow">Available to draw</div>
          <div className="account-balance num">{usd(available)}</div>
          <div className="muted small">
            of a {usd(line.creditLimit)} line · backed by {usd(line.attestedValue)} attested collateral
          </div>
          {(line.drawn > 0n || (interest ?? 0n) > 0n) && (
            <div className="owed small">
              Owed <strong className="num">{usd(line.drawn)}</strong> principal
              {" + "}<strong className="num">{interest === null ? "…" : usdCents(interest)}</strong> interest
              <span className="dim"> · {(rateBps / 100).toFixed(2)}% APR, accruing per second</span>
            </div>
          )}
        </div>
        <Link to={`/verify/${portfolioId}`} className="proof-badge">
          <Check size={12} /> Backed by proof
        </Link>
      </div>

      <div className="meter">
        <div className="meter-fill" style={{ width: `${usedPct}%` }} />
      </div>
      <div className="meter-legend small">
        <span><span className="swatch swatch-ink" /> Drawn {usd(line.drawn)}</span>
        <span><span className="swatch swatch-light" /> Free {usd(available)}</span>
        <span className="dim">{usedPct.toFixed(1)}% utilized</span>
      </div>

      {!isBorrower ? (
        <Notice>Connect the borrower's wallet to draw or repay this line.</Notice>
      ) : (
        <div className="account-actions">
          <div className="seg">
            <button className={mode === "draw" ? "on" : ""} onClick={() => { setMode("draw"); setAmount(""); setError(null); }}>Draw</button>
            <button className={mode === "repay" ? "on" : ""} onClick={() => { setMode("repay"); setAmount(""); setError(null); }}>Repay</button>
          </div>

          <div className="amount-row">
            <label className="field money-field grow">
              <span className="field-prefix">$</span>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                inputMode="decimal"
                aria-label={`${mode} amount`}
              />
            </label>
            <button className="btn btn-primary btn-lg" onClick={submit} disabled={!parsed || over || short || busy !== null || max === 0n}>
              {busy ? <><Spinner /> Confirming…</> : mode === "draw" ? "Draw funds" : "Repay"}
            </button>
          </div>

          <div className="presets">
            {[0.25, 0.5, 1].map((f) => (
              <button key={f} className="preset" onClick={() => preset(f)} disabled={max === 0n}>
                {f === 1 ? (mode === "repay" ? "Pay in full" : "Max") : `${f * 100}%`}
              </button>
            ))}
            <span className="dim small presets-note">
              {mode === "draw" ? `Up to ${usd(available)}` : `${usdCents(debt)} to close the line`}
              {balance !== null && ` · wallet holds ${usd(balance)}`}
            </span>
          </div>

          {over && <div className="field-hint warn">That's more than {mode === "draw" ? "the line has free" : "you owe"}.</div>}
          {short && <div className="field-hint warn">Your wallet holds {usd(balance)} — not enough to repay that.</div>}
          {mode === "repay" && !over && !short && (
            <div className="field-hint">
              Payments cover interest first, then principal. The line closes once both are zero;
              anything above what's owed is never taken.
            </div>
          )}
          {done && <Notice tone="green" title={done}>Settled on Creditcoin.</Notice>}
          {error && <Notice tone="red">{error}</Notice>}
        </div>
      )}
    </div>
  );
}
