import { useMemo } from "react";
import { ago, usd, usdShort } from "../lib/format";
import { creditFor, phaseOf } from "../lib/phase";
import { useProtocol } from "../lib/protocol";
import { go, Link } from "../lib/router";
import { AddressLink, PhaseChip, Spinner, Stat, TxLink } from "../components/ui";

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
    <div className="shell page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Proof ledger</div>
          <h1 className="h1">Every position, and the proof behind it.</h1>
          <p className="muted lede-sm">
            Each row is collateral escrowed on Sepolia. Each line was opened only after Creditcoin
            verified an Attestcoin proof of that lock. Open any row to re-run the verification in
            your browser.
          </p>
        </div>
      </div>

      <div className="card stats-card four">
        <Stat label="Pool liquidity" value={usdShort(liquidity)} note="Idle stablecoins on Creditcoin" />
        <Stat label="Collateral escrowed" value={usdShort(stats.collateralEscrowed)} note={`${stats.locks} lock${stats.locks === 1 ? "" : "s"} on Sepolia`} />
        <Stat label="Credit extended" value={usdShort(stats.creditExtended)} note={`${stats.linesOpened} line${stats.linesOpened === 1 ? "" : "s"} opened`} />
        <Stat label="Outstanding" value={usdShort(stats.outstanding)} note={utilization !== null ? `${utilization.toFixed(1)}% utilization` : " "} />
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
                  {synced ? "No collateral has been locked yet." : <><Spinner /> Indexing both chains…</>}
                </td>
              </tr>
            )}
            {rows.map(({ p, info }) => {
              const line = p.activeLine ?? p.lines[p.lines.length - 1];
              return (
                <tr key={p.id} className="clickable" onClick={() => go(`/p/${p.id}`)}>
                  <td><strong className="num">#{p.id}</strong></td>
                  <td onClick={(e) => e.stopPropagation()}><AddressLink side="origin" address={p.owner} /></td>
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
                      <Link to={`/verify/${p.id}`} className="btn btn-secondary btn-sm">Verify</Link>
                    ) : (
                      <span className="dim small">attesting…</span>
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
