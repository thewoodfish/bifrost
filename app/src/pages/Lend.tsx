import { useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { deposit, lpPosition, mintTestUsdc, redeemAll, stablecoinBalance, withdraw } from "../lib/actions";
import { creditcoin } from "../lib/chains";
import { config } from "../lib/config";
import { ago, usd, usdShort } from "../lib/format";
import { useProtocol } from "../lib/protocol";
import { Link } from "../lib/router";
import { useTx } from "../lib/useTx";
import { useWallet } from "../lib/wallet";
import { Avatar, AddressLink, Empty, Icon, Notice, Skeleton, Spinner, Stat, TxLink } from "../components/ui";

type Mode = "deposit" | "withdraw";

const pct = (bps: number | undefined) => (bps === undefined ? "—" : `${(bps / 100).toFixed(2)}%`);

/** The three-way split of every interest dollar, drawn to scale. */
function RateSplit() {
  const { pool } = useProtocol();
  const borrow = pool?.borrowRateBps ?? 800;
  const reserve = pool?.reserveFactorBps ?? 2500;
  const toLps = (borrow * (10_000 - reserve)) / 10_000;
  return (
    <div className="card pad split">
      <div className="card-title">Where the interest goes</div>
      <p className="muted small">
        Borrowers pay {pct(borrow)} APR on what they draw. {pct(10_000 - reserve)} of every interest
        payment raises the value of LP shares; the rest is the protocol's reserve.
      </p>
      <div className="split-bar">
        <span className="split-lp" style={{ flex: 10_000 - reserve }}>LPs {pct(toLps)}</span>
        <span className="split-res" style={{ flex: reserve }}>Protocol {pct(borrow - toLps)}</span>
      </div>
      <ul className="split-notes">
        <li><Icon.Shield size={14} /><span>Every line was opened by a <Link to="/ledger" className="link">verified Attestcoin proof</Link> over at least 125% collateral.</span></li>
        <li><Icon.Clock size={14} /><span>Interest reaches LPs when borrowers pay it; unpaid interest never inflates share price.</span></li>
        <li><Icon.Coins size={14} /><span>Withdrawals are limited to idle liquidity — lent-out principal comes back as borrowers repay.</span></li>
      </ul>
    </div>
  );
}

function Position() {
  const { address, connect, available, connecting } = useWallet();
  const { pool, lpEvents, sync } = useProtocol();
  const { busy, error, setError, run } = useTx();
  const [mode, setMode] = useState<Mode>("deposit");
  const [amount, setAmount] = useState("");
  const [pos, setPos] = useState<{ shares: bigint; assets: bigint } | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);

  const refresh = async () => {
    if (!address) return;
    const [p, b] = await Promise.all([lpPosition(address), stablecoinBalance(address)]);
    setPos(p);
    setBalance(b);
  };

  useEffect(() => {
    setPos(null);
    setBalance(null);
    void refresh().catch(() => undefined);
  }, [address, pool?.totalAssets]);

  // Principal in, per this wallet's deposit/withdraw history. Earnings are the rest.
  const netDeposited = useMemo(() => {
    if (!address) return 0n;
    let n = 0n;
    for (const e of lpEvents) {
      if (e.lp.toLowerCase() !== address.toLowerCase()) continue;
      n += e.kind === "deposited" ? e.assets : -e.assets;
    }
    return n;
  }, [lpEvents, address]);

  if (!address) {
    return (
      <div className="card pad position">
        <Empty icon={<Icon.Wallet size={20} />} title="Connect a wallet to lend">
          <p>Deposit test USDC into the Creditcoin pool and earn the interest borrowers pay.</p>
          {available ? (
            <button className="btn btn-primary" onClick={connect} disabled={connecting}>{connecting ? <><Spinner /> Connecting…</> : "Connect wallet"}</button>
          ) : (
            <a className="btn btn-primary" href="https://metamask.io/download/" target="_blank" rel="noreferrer">Install a browser wallet</a>
          )}
        </Empty>
      </div>
    );
  }

  const idle = pool?.idle ?? 0n;
  const withdrawable = pos ? (pos.assets < idle ? pos.assets : idle) : 0n;
  const max = mode === "deposit" ? balance ?? 0n : withdrawable;
  const earned = pos && pos.assets > netDeposited ? pos.assets - netDeposited : 0n;

  const clean = amount.replace(/[,$\s]/g, "");
  let parsed: bigint | null = null;
  try {
    parsed = /^\d+(\.\d{0,6})?$/.test(clean) && Number(clean) > 0 ? parseUnits(clean, config.decimals) : null;
  } catch {
    parsed = null;
  }
  const over = parsed !== null && parsed > max;
  const exitAll = mode === "withdraw" && pos !== null && parsed !== null && parsed === withdrawable && withdrawable === pos.assets;

  const submit = async () => {
    if (!parsed || over) return;
    const ok = await run(mode, creditcoin.id, (w, a) =>
      mode === "deposit" ? deposit(w, a, clean) : exitAll ? redeemAll(w, a) : withdraw(w, a, clean),
    refresh);
    if (ok) setAmount("");
  };

  return (
    <div className="card position">
      <div className="position-top">
        <div>
          <div className="eyebrow">Your position</div>
          <div className="account-balance num">{pos ? usd(pos.assets) : <Skeleton w={200} h={48} />}</div>
          <div className="muted small">
            {pos && pos.assets > 0n ? (
              <>{usd(netDeposited > 0n ? netDeposited : 0n)} deposited · <span className="ok-text">+{usd(earned)} earned</span> · earning {pct(pool?.supplyRateBps)} now</>
            ) : (
              "No deposit yet"
            )}
          </div>
        </div>
        <div className="position-wallet">
          <Avatar address={address} size={16} />
          <span className="small">Wallet: <strong className="num">{balance !== null ? usd(balance) : "…"}</strong> tUSDC</span>
        </div>
      </div>

      <div className="account-actions">
        <div className="seg">
          <button className={mode === "deposit" ? "on" : ""} onClick={() => { setMode("deposit"); setAmount(""); setError(null); }}>Deposit</button>
          <button className={mode === "withdraw" ? "on" : ""} onClick={() => { setMode("withdraw"); setAmount(""); setError(null); }}>Withdraw</button>
        </div>
        <div className="amount-row">
          <label className="field money-field grow">
            <span className="field-prefix">$</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" inputMode="decimal" aria-label={`${mode} amount`} />
          </label>
          <button className="btn btn-primary btn-lg" onClick={submit} disabled={!parsed || over || busy !== null || max === 0n}>
            {busy ? <><Spinner /> Confirming…</> : mode === "deposit" ? "Deposit" : "Withdraw"}
          </button>
        </div>
        <div className="presets">
          {[0.25, 0.5, 1].map((f) => (
            <button
              key={f}
              className="preset"
              disabled={max === 0n}
              onClick={() => { setAmount(formatUnits(f === 1 ? max : (max * BigInt(f * 100)) / 100n, config.decimals)); setError(null); }}
            >
              {f === 1 ? "Max" : `${f * 100}%`}
            </button>
          ))}
          <span className="dim small presets-note">
            {mode === "deposit" ? `Wallet holds ${balance !== null ? usd(balance) : "…"}` : `Up to ${usd(withdrawable)} now`}
          </span>
        </div>
        {over && <div className="field-hint warn">{mode === "deposit" ? "More than your wallet holds." : "More than you can withdraw right now."}</div>}
        {mode === "withdraw" && pos && pos.assets > idle && (
          <div className="field-hint">Part of your position is lent out; it becomes withdrawable as borrowers repay.</div>
        )}
        {mode === "deposit" && balance === 0n && (
          <Notice tone="violet" title="No test USDC in this wallet">
            The pool's token is a testnet stablecoin anyone can mint.{" "}
            <button
              className="link-btn"
              disabled={busy !== null}
              onClick={() => void run("mint", creditcoin.id, (w, a) => mintTestUsdc(w, a, "100000"), async () => { await refresh(); await sync(); })}
            >
              Mint 100,000 tUSDC
            </button>
          </Notice>
        )}
        {error && <Notice tone="red">{error}</Notice>}
      </div>
    </div>
  );
}

function LenderActivity() {
  const { lpEvents, synced } = useProtocol();
  const rows = [...lpEvents].reverse().slice(0, 8);
  return (
    <div className="card">
      <div className="card-head card-head-pad"><span className="card-title">Lender activity</span></div>
      {rows.length === 0 ? (
        <div className="rows-skel">{synced ? <Empty title="No deposits yet." /> : <div className="row-skel"><Skeleton w={200} /><Skeleton w={80} /></div>}</div>
      ) : (
        <ul className="feed">
          {rows.map((e) => (
            <li key={`${e.tx}:${e.logIndex}`} className="feed-item feed-creditcoin">
              <span className="feed-icon">{e.kind === "deposited" ? <Icon.Plus size={14} /> : <Icon.ArrowLeft size={14} />}</span>
              <div className="feed-text">
                <div><strong>{usd(e.assets)}</strong> {e.kind === "deposited" ? "deposited" : "withdrawn"}</div>
                <div className="feed-meta"><Avatar address={e.lp} size={12} /><AddressLink side="creditcoin" address={e.lp} /> · <TxLink side="creditcoin" hash={e.tx}>tx</TxLink></div>
              </div>
              <span className="feed-when">{e.ts ? ago(e.ts) : `#${e.block.toLocaleString()}`}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The lender side. Every dollar here funds lines that opened only on a verified proof of
 * escrowed collateral, and earns the interest those borrowers pay.
 */
export function Lend() {
  const { pool, stats } = useProtocol();
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Lend</h1>
          <p className="page-sub">
            Supply stablecoins to the Creditcoin pool. You fund credit lines that exist only
            because Creditcoin verified a proof of escrowed real-world collateral, and you earn
            the interest borrowers pay.
          </p>
        </div>
      </div>

      <div className="kpis kpis-4">
        <div className="card kpi"><Stat label="Supplied by lenders" icon={<Icon.Coins size={14} />} value={pool ? usdShort(pool.totalAssets) : "—"} note={`${stats.lenders} lender${stats.lenders === 1 ? "" : "s"}`} /></div>
        <div className="card kpi"><Stat label="Lent out" icon={<Icon.Layers size={14} />} value={pool ? usdShort(pool.borrowed) : "—"} note={`${pct(pool?.utilizationBps)} utilized`} /></div>
        <div className="card kpi kpi-hero"><Stat label="Lender APR now" icon={<Icon.Pulse size={14} />} value={pct(pool?.supplyRateBps)} note={`Borrowers pay ${pct(pool?.borrowRateBps)}`} /></div>
        <div className="card kpi"><Stat label="Interest paid" icon={<Icon.Bolt size={14} />} value={usd(stats.interestPaid)} note="By borrowers, to date" /></div>
      </div>

      <div className="dash-grid">
        <div className="detail-main">
          <Position />
          <LenderActivity />
        </div>
        <div className="dash-side"><RateSplit /></div>
      </div>
    </div>
  );
}
