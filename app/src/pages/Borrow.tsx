import { useMemo, useState } from "react";
import { registerPortfolio } from "../lib/actions";
import { origin } from "../lib/chains";
import { ago, duration, usd, usdFine, usdShort } from "../lib/format";
import { chronological, type ProtocolEvent } from "../lib/indexer";
import { creditFor, PHASE_META, phaseOf } from "../lib/phase";
import { useProtocol } from "../lib/protocol";
import { go, Link } from "../lib/router";
import { useRoles } from "../lib/usePortfolio";
import { useTx } from "../lib/useTx";
import { useWallet } from "../lib/wallet";
import { ChainTag, Check, Empty, Icon, Notice, PhaseChip, Skeleton, Spinner, Stat } from "../components/ui";

/** Protocol-wide numbers, so a visitor without a wallet still lands on something real. */
function PoolCard() {
  const { liquidity, stats, pool } = useProtocol();
  const total = liquidity !== null ? liquidity + stats.outstanding : null;
  const util = total && total > 0n ? Number((stats.outstanding * 10_000n) / total) / 100 : 0;
  const pct = (bps: number | undefined) => (bps === undefined ? "—" : `${(bps / 100).toFixed(2)}%`);
  return (
    <div className="card pad pool">
      <div className="card-head">
        <span className="card-title">Creditcoin pool</span>
        <Link to="/lend" className="card-link">Lend <Icon.ArrowRight size={13} /></Link>
      </div>
      <div className="pool-value num">{liquidity !== null ? usd(liquidity) : <Skeleton w={160} h={28} />}</div>
      <div className="dim small">available to borrow · TestUSDC</div>
      <div className="util"><span style={{ width: `${Math.max(util, 0.6)}%` }} /></div>
      <div className="util-legend small">
        <span><i className="sw sw-a" /> Lent {usdShort(stats.outstanding)}</span>
        <span className="dim">{util.toFixed(1)}% utilized</span>
      </div>
      <div className="pool-rates small">
        <span>Borrow APR <strong className="num">{pct(pool?.borrowRateBps)}</strong></span>
        <span>Lenders earn <strong className="num">{pct(pool?.supplyRateBps)}</strong></span>
      </div>
    </div>
  );
}

function feedLine(e: ProtocolEvent): { icon: React.ReactNode; text: React.ReactNode } | null {
  switch (e.kind) {
    case "registered": return { icon: <Icon.Plus size={14} />, text: <>Portfolio <strong>#{e.portfolioId}</strong> registered</> };
    case "valued": return { icon: <Icon.Scale size={14} />, text: <><strong>#{e.portfolioId}</strong> valued at <strong>{usd(e.value)}</strong></> };
    case "locked": return { icon: <Icon.Lock size={14} />, text: <><strong>{usd(e.value)}</strong> locked as collateral · #{e.portfolioId}</> };
    case "unlocked": return { icon: <Icon.Lock size={14} />, text: <>Escrow released · #{e.portfolioId}</> };
    case "opened": return { icon: <Icon.Shield size={14} />, text: <>Line of <strong>{usd(e.creditLimit)}</strong> opened against a proof · #{e.portfolioId}</> };
    case "drawn": return { icon: <Icon.Coins size={14} />, text: <><strong>{usd(e.amount)}</strong> drawn · #{e.portfolioId}</> };
    case "repaid": return { icon: <Icon.Coins size={14} />, text: <><strong>{usd(e.amount)}</strong> repaid · #{e.portfolioId}</> };
    case "closed": return { icon: <Check size={14} />, text: <>Line closed · #{e.portfolioId}</> };
    case "interest": return { icon: <Icon.Pulse size={14} />, text: <><strong>{usdFine(e.amount)}</strong> interest paid · #{e.portfolioId}</> };
    case "deposited": return { icon: <Icon.Plus size={14} />, text: <><strong>{usd(e.assets)}</strong> supplied by a lender</> };
    case "withdrawn": return { icon: <Icon.ArrowLeft size={14} />, text: <><strong>{usd(e.assets)}</strong> withdrawn by a lender</> };
    default: return null;
  }
}

/** The protocol's pulse: every vault and engine event, newest first. */
function ActivityFeed() {
  const { events, synced } = useProtocol();
  const rows = useMemo(
    () =>
      [...events]
        .sort(chronological)
        .reverse()
        .map((e) => ({ e, l: feedLine(e) }))
        .filter((r): r is { e: ProtocolEvent; l: NonNullable<ReturnType<typeof feedLine>> } => r.l !== null)
        .slice(0, 8),
    [events],
  );
  return (
    <div className="card">
      <div className="card-head card-head-pad">
        <span className="card-title"><span className="dot dot-live" /> Protocol activity</span>
        <Link to="/ledger" className="card-link">All positions <Icon.ArrowRight size={13} /></Link>
      </div>
      {rows.length === 0 ? (
        <div className="rows-skel">{synced ? <Empty title="No activity yet." /> : [0, 1, 2].map((i) => <div key={i} className="row-skel"><Skeleton w={200} /><Skeleton w={80} /></div>)}</div>
      ) : (
        <ul className="feed">
          {rows.map(({ e, l }) => (
            <li key={`${e.tx}:${e.logIndex}`} className={`feed-item feed-${e.side}`}>
              <span className="feed-icon">{l.icon}</span>
              <div className="feed-text">
                <div>{l.text}</div>
                <div className="feed-meta"><ChainTag side={e.side} /></div>
              </div>
              <span className="feed-when">{e.ts ? ago(e.ts) : `#${e.block.toLocaleString()}`}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ConnectGate() {
  const { connect, connecting, available, error } = useWallet();
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-sub">Your credit lines, offers and collateral, across both chains.</p>
        </div>
      </div>
      <div className="dash-grid">
        <div className="card connect">
          <div className="connect-glow" />
          <div className="connect-icon"><Icon.Wallet size={22} /></div>
          <h2 className="h-card-lg">Connect the wallet that owns your loan book</h2>
          <p className="muted">
            Bifrost reads the vault on Sepolia and the pool on Creditcoin, finds every portfolio your
            wallet owns, and shows what each one can borrow. Nothing to type, nothing to import.
          </p>
          <div className="row">
            {available ? (
              <button className="btn btn-primary btn-lg" onClick={connect} disabled={connecting}>
                {connecting ? <><Spinner /> Connecting…</> : "Connect wallet"}
              </button>
            ) : (
              <a className="btn btn-primary btn-lg" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
                Install a browser wallet
              </a>
            )}
            <Link to="/ledger" className="btn btn-ghost btn-lg">Browse live positions</Link>
          </div>
          {error && <Notice tone="red">{error}</Notice>}
          <div className="connect-steps">
            <span><Icon.Lock size={14} /> Lock on Sepolia</span>
            <span><Icon.Shield size={14} /> Attestcoin proves it</span>
            <span><Icon.Coins size={14} /> Funded on Creditcoin</span>
          </div>
        </div>
        <div className="dash-side"><PoolCard /></div>
      </div>
      <div className="dash-grid">
        <ActivityFeed />
      </div>
    </div>
  );
}

function RegisterPanel({ suggested, onDone, onClose }: { suggested: string; onDone: (id: string) => void; onClose: () => void }) {
  const [id, setId] = useState(suggested);
  const { portfolios } = useProtocol();
  const { busy, error, run } = useTx();
  const taken = !!portfolios[id];
  const valid = /^\d+$/.test(id) && !taken;

  return (
    <div className="card pad register">
      <div className="card-head">
        <div>
          <div className="card-title">Register a portfolio</div>
          <div className="dim small">Creates its escrow slot in the Sepolia vault. One signature.</div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon.Close size={15} /></button>
      </div>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          void run("register", origin.id, (w, a) => registerPortfolio(w, a, BigInt(id))).then((h) => h && onDone(id));
        }}
      >
        <label className="field">
          <span className="field-label">Portfolio ID</span>
          <div className="input-wrap"><span className="input-prefix">#</span><input value={id} onChange={(e) => setId(e.target.value.trim())} inputMode="numeric" /></div>
        </label>
        <button className="btn btn-primary btn-md" disabled={!valid || busy !== null}>
          {busy ? <><Spinner /> Registering…</> : "Register"}
        </button>
      </form>
      {taken && <div className="field-hint warn">#{id} is already registered.</div>}
      {error && <Notice tone="red">{error}</Notice>}
    </div>
  );
}

export function Borrow() {
  const { address } = useWallet();
  const roles = useRoles(address);
  const { portfolios, attestation, params, synced } = useProtocol();
  const [registering, setRegistering] = useState(false);

  const mine = useMemo(() => {
    if (!address) return [];
    return Object.values(portfolios)
      .filter((p) => p.owner.toLowerCase() === address.toLowerCase())
      .map((p) => ({ p, info: phaseOf(p, attestation, params) }))
      .sort((a, b) => Number(b.p.id) - Number(a.p.id));
  }, [portfolios, address, attestation, params]);

  const totals = useMemo(() => {
    let available = 0n, drawn = 0n, escrowed = 0n, pending = 0n, limit = 0n;
    for (const { p, info } of mine) {
      if (p.activeLine) {
        available += p.activeLine.creditLimit - p.activeLine.drawn;
        drawn += p.activeLine.drawn;
        limit += p.activeLine.creditLimit;
      }
      if (p.locked && p.lastLock) escrowed += p.lastLock.value;
      if (info.phase === "ready" || info.phase === "in-transit" || info.phase === "offer") {
        pending += creditFor(p.lastLock?.value ?? p.value, params);
      }
    }
    return { available, drawn, escrowed, pending, limit };
  }, [mine, params]);

  const suggested = useMemo(() => {
    const ids = Object.keys(portfolios).map(Number).filter(Number.isFinite);
    return String(ids.length ? Math.max(...ids) + 1 : 1000);
  }, [portfolios]);

  if (!address) return <ConnectGate />;

  const needsAction = mine.filter(({ info }) => info.phase === "offer" || info.phase === "ready" || info.phase === "in-transit");
  const usedPct = totals.limit > 0n ? Number((totals.drawn * 10_000n) / totals.limit) / 100 : 0;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-sub">Your credit lines, offers and collateral, across both chains.</p>
        </div>
        {roles.originator && (
          <button className="btn btn-primary" onClick={() => setRegistering((r) => !r)}>
            <Icon.Plus size={15} /> Register portfolio
          </button>
        )}
      </div>

      {roles.valuer && (
        <Notice tone="violet" title="This wallet is an approved valuer">
          Portfolios waiting on a number are in the <Link to="/valuer" className="link">valuation desk →</Link>
        </Notice>
      )}

      {registering && (
        <RegisterPanel
          suggested={suggested}
          onClose={() => setRegistering(false)}
          onDone={(id) => {
            setRegistering(false);
            go(`/p/${id}`);
          }}
        />
      )}

      <div className="kpis">
        <div className="card kpi kpi-hero">
          <Stat big label="Available to draw" value={usd(totals.available)} note={totals.limit > 0n ? `of ${usd(totals.limit)} in open lines` : "Open a line to start drawing"} />
          <div className="util"><span style={{ width: `${usedPct}%` }} /></div>
          <div className="util-legend small">
            <span><i className="sw sw-a" /> Drawn {usd(totals.drawn)}</span>
            <span className="dim">{usedPct.toFixed(1)}% used</span>
          </div>
        </div>
        <div className="card kpi"><Stat label="In flight" icon={<Icon.Clock size={14} />} value={usd(totals.pending)} note="Offers and proofs on their way" /></div>
        <div className="card kpi"><Stat label="Collateral escrowed" icon={<Icon.Lock size={14} />} value={usd(totals.escrowed)} note="Held on Sepolia" /></div>
      </div>

      {needsAction.length > 0 && (
        <div className="actions">
          {needsAction.map(({ p, info }) => {
            const amount = creditFor(p.lastLock?.value ?? p.value, params);
            const [title, cta] =
              info.phase === "ready" ? [`${usd(amount)} is ready to claim`, "Claim"]
              : info.phase === "offer" ? [`Offer of ${usd(amount)} waiting for you`, "Review offer"]
              : [`${usd(amount)} on its way`, "Track"];
            return (
              <Link key={p.id} to={`/p/${p.id}`} className={`action action-${info.phase}`}>
                <span className="action-icon">
                  {info.phase === "ready" ? <Icon.Coins size={16} /> : info.phase === "offer" ? <Icon.Bolt size={16} /> : <Icon.Pulse size={16} />}
                </span>
                <span className="action-text">
                  <strong>{title}</strong>
                  <span className="dim small">
                    Portfolio #{p.id}
                    {info.phase === "in-transit" && info.eta !== null && ` · Attestcoin ~${duration(info.eta)} away`}
                  </span>
                </span>
                <span className="action-cta">{cta} <Icon.ArrowRight size={14} /></span>
              </Link>
            );
          })}
        </div>
      )}

      <div className="card">
        <div className="card-head card-head-pad">
          <span className="card-title">Portfolios <span className="count">{mine.length}</span></span>
        </div>
        {!synced && mine.length === 0 ? (
          <div className="rows-skel">{[0, 1, 2].map((i) => <div key={i} className="row-skel"><Skeleton w={90} /><Skeleton w={110} /><Skeleton w={120} /><Skeleton w={100} h={22} r={999} /></div>)}</div>
        ) : mine.length === 0 ? (
          <Empty icon={<Icon.Layers size={20} />} title="No portfolios in this wallet yet.">
            <p>
              {roles.originator
                ? "Register your first portfolio to open its escrow slot."
                : roles.loaded
                  ? "Only approved originators can register portfolios. Bifrost onboards originators after KYC — the vault admin grants the role."
                  : "Checking this wallet's roles…"}
            </p>
            {roles.originator && !registering && (
              <button className="btn btn-primary" onClick={() => setRegistering(true)}><Icon.Plus size={15} /> Register portfolio</button>
            )}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Portfolio</th>
                  <th className="r">Collateral</th>
                  <th className="r">Credit</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {mine.map(({ p, info }) => {
                  const line = p.activeLine;
                  const base = p.lastLock?.value ?? p.value;
                  return (
                    <tr key={p.id} className="clickable" onClick={() => go(`/p/${p.id}`)}>
                      <td>
                        <div className="cell-id">
                          <span className="id-badge"><Icon.Layers size={14} /></span>
                          <div>
                            <strong className="num">#{p.id}</strong>
                            <div className="dim small">{PHASE_META[info.phase].next}</div>
                          </div>
                        </div>
                      </td>
                      <td className="r num">{base > 0n ? usd(base) : <span className="dim">Unvalued</span>}</td>
                      <td className="r num">
                        {line ? (
                          <>{usd(line.creditLimit - line.drawn)} <div className="dim small">free of {usd(line.creditLimit)}</div></>
                        ) : base > 0n && info.phase !== "repaid" ? (
                          <span className="dim">up to {usd(creditFor(base, params))}</span>
                        ) : (
                          <span className="dim">—</span>
                        )}
                      </td>
                      <td>
                        <div className="row gap-sm">
                          <PhaseChip phase={info.phase} />
                          {info.phase === "in-transit" && info.eta !== null && <span className="dim small">~{duration(info.eta)}</span>}
                        </div>
                      </td>
                      <td className="r"><Icon.ArrowRight size={15} className="row-go" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
