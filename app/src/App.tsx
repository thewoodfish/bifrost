import { useCallback, useEffect, useMemo, useState } from "react";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { PortfolioView } from "./components/PortfolioView";
import { listWatched, unwatch, watch, type Watched } from "./lib/store";
import { useAttestationStatus } from "./lib/useAttestation";
import { usePortfolio, useStages } from "./lib/usePortfolio";
import { useWallet } from "./lib/wallet";

/**
 * Shown before any portfolio is tracked.
 *
 * The portal opens on an explanation rather than a form because the flow it drives is
 * unusual: the collateral never moves, and the credit line appears on a chain the
 * collateral has never touched. Someone who does not know that reads the 8-20 minute
 * attestation wait as a broken page.
 */
function Welcome() {
  return (
    <div className="stack">
      <div>
        <div className="section-label">Bifrost portal</div>
        <h1 style={{ margin: "4px 0 0", fontSize: 26, letterSpacing: "-0.02em" }}>
          Borrow against a portfolio that never leaves its chain
        </h1>
      </div>

      <div className="card">
        <div className="card-body stack">
          <p style={{ margin: 0, color: "var(--text-2)" }}>
            A tokenised loan portfolio is escrowed on <strong>Sepolia</strong>, where its
            compliance and audit trail already live. The Attestcoin Protocol proves that lock
            to <strong>Creditcoin</strong>, which verifies the proof on-chain and releases a
            stablecoin line at up to 80% LTV. No bridge holds the asset and no oracle sits in
            the trust path.
          </p>
          <ol className="stack small" style={{ margin: 0, paddingLeft: 18, color: "var(--text-2)" }}>
            <li>An approved originator registers the portfolio in the origin vault.</li>
            <li>An independent valuer — never the borrower — publishes its value.</li>
            <li>The owner locks it, freezing the valuation and emitting the attested event.</li>
            <li>Attestcoin validators attest the source block. This takes 8–20 minutes.</li>
            <li>Creditcoin verifies the proof and opens the line.</li>
          </ol>
          <div className="notice small">
            Track a portfolio by id in the sidebar to begin. Everything is read from chain, so
            an id that already exists picks up wherever it left off — including from a
            different browser.
          </div>
        </div>
      </div>
    </div>
  );
}

export function App() {
  const status = useAttestationStatus();
  const wallet = useWallet();

  const [watched, setWatched] = useState<Watched[]>(() => listWatched());
  const [selected, setSelected] = useState<string | null>(() => listWatched()[0]?.portfolioId ?? null);
  // Bumped whenever a write lands, so the sidebar stages re-read alongside the position.
  const [nonce, setNonce] = useState(0);

  const state = usePortfolio(selected);
  const ids = useMemo(() => watched.map((w) => w.portfolioId), [watched]);
  const stages = useStages(ids, nonce);

  // The selected portfolio's stage comes from the full read, which is fresher than the
  // list read and already reflects a write that just landed.
  const mergedStages = useMemo(() => {
    const m: Record<string, string> = { ...stages };
    if (selected && state.portfolio) m[selected] = state.stage;
    return m;
  }, [stages, selected, state.portfolio, state.stage]);

  useEffect(() => {
    if (state.portfolio) setNonce((n) => n + 1);
  }, [state.portfolio, state.line?.drawn, state.line?.open]);

  const add = useCallback((id: string) => {
    watch(id);
    setWatched(listWatched());
    setSelected(id);
  }, []);

  const remove = useCallback(
    (id: string) => {
      unwatch(id);
      const next = listWatched();
      setWatched(next);
      if (selected === id) setSelected(next[0]?.portfolioId ?? null);
    },
    [selected],
  );

  // A lock records its transaction in the store; reflect that in the list without a reload.
  useEffect(() => {
    if (state.lockTx) setWatched(listWatched());
  }, [state.lockTx]);

  return (
    <div className="app">
      <Header status={status} />

      <div className="body">
        <Sidebar
          watched={watched}
          selected={selected}
          stages={mergedStages}
          onSelect={setSelected}
          onAdd={add}
          onRemove={remove}
        />

        <main className="main">
          <div className="main-inner stack">
            {wallet.error && (
              <div className="notice error">
                <div className="notice-title">Wallet</div>
                <span className="small">{wallet.error}</span>
              </div>
            )}

            {selected ? (
              <PortfolioView portfolioId={selected} state={state} status={status} />
            ) : (
              <Welcome />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
