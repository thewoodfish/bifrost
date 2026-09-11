import { useMemo } from "react";
import { ago, usd, usdShort } from "../lib/format";
import { creditFor, phaseOf } from "../lib/phase";
import { useProtocol } from "../lib/protocol";
import { go, Link } from "../lib/router";
import { AddressLink, Avatar, Icon, PhaseChip, Skeleton, Stat, TxLink } from "../components/ui";

/**
 * Every lock and every line, public. For a lender this is the pool's book; for anyone
 * else it is the claim "every dollar here is backed by a proof" made checkable, one
 * click per row.
 */
export function Ledger() {
  const { portfolios, attestation, params, liquidity, stats, synced } = useProtocol();

  const rows = useMemo(
    () =>
      Object.values(portfolios)
        .filter((p) => p.lastLock)
        .map((p) => ({ p, info: phaseOf(p, attestation, params) }))
        .sort((a, b) => (b.p.lastLock!.ts ?? b.p.lastLock!.block) - (a.p.lastLock!.ts ?? a.p.lastLock!.block)),
    [portfolios, attestation, params],
  );

  const utilization =
    liquidity !== null && liquidity + stats.outstanding > 0n
      ? Number((stats.outstanding * 10_000n) / (liquidity + stats.outstanding)) / 100
      : null;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Proof ledger</h1>
          <p className="page-sub">
            Every position, and the proof behind it. Each line was opened only after Creditcoin
            verified an Attestcoin proof of its Sepolia lock — open any row to re-run that check in
            your browser.
          </p>
        </div>
      </div>

      <div className="kpis kpis-4">
        <div className="card kpi"><Stat label="Pool liquidity" icon={<Icon.Coins size={14} />} value={usdShort(liquidity)} note="Idle stablecoins on Creditcoin" /></div>
        <div className="card kpi"><Stat label="Collateral escrowed" icon={<Icon.Lock size={14} />} value={usdShort(stats.collateralEscrowed)} note={`${stats.locks} lock${stats.locks === 1 ? "" : "s"} on Sepolia`} /></div>
        <div className="card kpi"><Stat label="Credit extended" icon={<Icon.Bolt size={14} />} value={usdShort(stats.creditExtended)} note={`${stats.linesOpened} line${stats.linesOpened === 1 ? "" : "s"} opened`} /></div>
        <div className="card kpi"><Stat label="Outstanding" icon={<Icon.Pulse size={14} />} value={usdShort(stats.outstanding)} note={utilization !== null ? `${utilization.toFixed(1)}% utilization` : " "} /></div>
      </div>

      <div className="card table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Portfolio</th>
              <th>Owner</th>
              <th className="r">Collateral</th>
              <th className="r">Credit</th>
              <th>Status</th>
              <th>Sepolia lock</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="table-empty">
                  {synced ? "No collateral has been locked yet." : <span className="row" style={{ justifyContent: "center" }}><Skeleton w={220} /></span>}
                </td>
              </tr>
            )}
            {rows.map(({ p, info }) => {
              const line = p.activeLine ?? p.lines[p.lines.length - 1];
              return (
                <tr key={p.id} className="clickable" onClick={() => go(`/p/${p.id}`)}>
                  <td><div className="cell-id"><span className="id-badge"><Icon.Layers size={14} /></span><strong className="num">#{p.id}</strong></div></td>
                  <td onClick={(e) => e.stopPropagation()}><span className="row gap-xs"><Avatar address={p.owner} size={16} /><AddressLink side="origin" address={p.owner} /></span></td>
                  <td className="r num">{usd(p.lastLock!.value)}</td>
                  <td className="r num">
                    {p.activeLine ? (
                      <>
                        {usd(p.activeLine.creditLimit)}
                        <div className="dim small">{usd(p.activeLine.drawn)} drawn</div>
                      </>
                    ) : line ? (
                      <span className="dim">{usd(line.creditLimit)} · closed</span>
                    ) : (
                      <span className="dim">{usd(creditFor(p.lastLock!.value, params))} unclaimed</span>
                    )}
                  </td>
                  <td><PhaseChip phase={info.phase} /></td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <TxLink side="origin" hash={p.lastLock!.tx}>#{p.lastLock!.block.toLocaleString()}</TxLink>
                    {p.lastLock!.ts && <div className="dim small">{ago(p.lastLock!.ts)}</div>}
                  </td>
                  <td className="r" onClick={(e) => e.stopPropagation()}>
                    {info.phase !== "in-transit" ? (
                      <Link to={`/verify/${p.id}`} className="btn btn-secondary btn-sm"><Icon.Shield size={13} /> Verify</Link>
                    ) : (
                      <span className="chip chip-violet"><span className="chip-dot pulse" />Attesting</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
