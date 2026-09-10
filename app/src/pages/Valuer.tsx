import { useMemo, useState } from "react";
import { ago, duration, usd } from "../lib/format";
import type { PortfolioRecord } from "../lib/indexer";
import { phaseOf } from "../lib/phase";
import { useProtocol } from "../lib/protocol";
import { Link } from "../lib/router";
import { useRoles } from "../lib/usePortfolio";
import { useWallet } from "../lib/wallet";
import { ValuationForm } from "../components/ValuationForm";
import { AddressLink, Chip, Notice, Spinner } from "../components/ui";

type Urgency = { rank: number; label: string; tone: "amber" | "red" | "green" | "grey" };

/** How badly a portfolio needs a valuer, and why. Locked books are frozen and cannot be revalued. */
function urgency(p: PortfolioRecord, maxAge: number | null): Urgency {
  if (p.locked) return { rank: 4, label: "Locked · frozen", tone: "grey" };
  if (p.value === 0n) return { rank: 0, label: "Needs first valuation", tone: "amber" };
  if (maxAge !== null && p.valuedAt !== undefined) {
    const left = maxAge - (Date.now() - p.valuedAt) / 1000;
    if (left < 0) return { rank: 1, label: "Expired", tone: "red" };
    if (left < 86_400) return { rank: 2, label: `Expires in ${duration(left)}`, tone: "amber" };
    return { rank: 3, label: `Fresh · ${duration(left)} left`, tone: "green" };
  }
  return { rank: 3, label: "Valued", tone: "green" };
}

/**
 * The valuer's desk. The separation of originator and valuer is the credibility of the
 * whole protocol, so the valuer gets their own surface — a queue, not a warning banner
 * on somebody else's screen.
 */
export function Valuer() {
  const { address, connect, available } = useWallet();
  const roles = useRoles(address);
  const { portfolios, params, attestation, synced, sync } = useProtocol();
  const [filter, setFilter] = useState<"attention" | "all">("attention");
  const [open, setOpen] = useState<string | null>(null);

  const rows = useMemo(() => {
    const all = Object.values(portfolios)
      .map((p) => ({ p, u: urgency(p, params?.maxValuationAge ?? null), info: phaseOf(p, attestation, params) }))
      .sort((a, b) => a.u.rank - b.u.rank || Number(b.p.id) - Number(a.p.id));
    return filter === "attention" ? all.filter((r) => r.u.rank <= 2) : all;
  }, [portfolios, params, attestation, filter]);

  const attentionCount = useMemo(
    () => Object.values(portfolios).filter((p) => urgency(p, params?.maxValuationAge ?? null).rank <= 2).length,
    [portfolios, params],
  );

  return (
    <div className="shell page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Valuation desk</div>
          <h1 className="h1">Nothing is lent until you price it.</h1>
          <p className="muted lede-sm">
            Borrowers can't value their own collateral. Approved valuers publish the number on
            Sepolia; it stays lockable for {params ? duration(params.maxValuationAge) : "7 days"}, then
            has to be revisited. Once a portfolio is locked, its valuation is frozen.
          </p>
        </div>
      </div>

      {!address ? (
        <Notice title="Read-only">
          Anyone can see the queue. <button className="link-btn" onClick={connect} disabled={!available}>Connect a valuer wallet</button> to publish.
        </Notice>
      ) : roles.loaded && !roles.valuer ? (
        <Notice tone="amber" title="This wallet isn't an approved valuer">
          The vault admin grants the valuer role to independent auditors. You can still browse the queue.
        </Notice>
      ) : null}

      <div className="tabs">
        <button className={filter === "attention" ? "on" : ""} onClick={() => setFilter("attention")}>
          Needs attention <span className="count">{attentionCount}</span>
        </button>
        <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>
          All portfolios <span className="count">{Object.keys(portfolios).length}</span>
        </button>
      </div>

      <div className="list card">
        <div className="list-head list-head-valuer">
          <span>Portfolio</span>
          <span>Owner</span>
          <span>Current value</span>
          <span>Freshness</span>
          <span />
        </div>
        {rows.length === 0 ? (
          <div className="list-empty">
            {synced ? (filter === "attention" ? "The queue is clear. Every unlocked portfolio has a fresh valuation." : "No portfolios registered yet.") : <><Spinner /> Reading the vault…</>}
          </div>
        ) : (
          rows.map(({ p, u }) => (
            <div key={p.id} className={`list-row static${open === p.id ? " expanded" : ""}`}>
              <div className="list-row-main list-row-valuer">
                <Link to={`/p/${p.id}`} className="list-id"><strong className="num">#{p.id}</strong></Link>
                <span><AddressLink side="origin" address={p.owner} /></span>
                <span className="num">
                  {p.value > 0n ? usd(p.value) : <span className="dim">—</span>}
                  {p.valuedAt && <div className="dim small">round {String(p.round)} · {ago(p.valuedAt)}</div>}
                </span>
                <span><Chip tone={u.tone}>{u.label}</Chip></span>
                <span className="r">
                  {!p.locked && roles.valuer && (
                    <button className="btn btn-secondary btn-sm" onClick={() => setOpen(open === p.id ? null : p.id)}>
                      {open === p.id ? "Cancel" : p.value > 0n ? "Revalue" : "Value"}
                    </button>
                  )}
                </span>
              </div>
              {open === p.id && (
                <div className="list-row-extra">
                  <ValuationForm
                    portfolioId={p.id}
                    current={p.value}
                    onDone={async () => {
                      setOpen(null);
                      await sync();
                    }}
                  />
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
