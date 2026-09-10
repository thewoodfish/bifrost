import { useMemo, useState } from "react";
import { registerPortfolio } from "../lib/actions";
import { origin } from "../lib/chains";
import { duration, usd } from "../lib/format";
import { creditFor, PHASE_META, phaseOf } from "../lib/phase";
import { useProtocol } from "../lib/protocol";
import { go, Link } from "../lib/router";
import { useRoles } from "../lib/usePortfolio";
import { useTx } from "../lib/useTx";
import { useWallet } from "../lib/wallet";
import { Notice, PhaseChip, Spinner, Stat } from "../components/ui";

function ConnectGate() {
  const { connect, connecting, available, error } = useWallet();
  return (
    <div className="shell page">
      <div className="gate card">
        <div className="eyebrow">Borrower console</div>
        <h1 className="h1">Connect the wallet that owns your loan book.</h1>
        <p className="muted">
          Bifrost reads the vault on Sepolia and the pool on Creditcoin, finds every portfolio
          your wallet owns, and shows what each one can borrow. Nothing to type, nothing to
          import.
        </p>
        <div className="row">
          {available ? (
            <button className="btn btn-primary btn-lg" onClick={connect} disabled={connecting}>
              {connecting ? "Connecting…" : "Connect wallet"}
            </button>
          ) : (
            <a className="btn btn-primary btn-lg" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
              Install a browser wallet
            </a>
          )}
          <Link to="/ledger" className="btn btn-ghost btn-lg">Browse live positions</Link>
        </div>
        {error && <Notice tone="red">{error}</Notice>}
      </div>
    </div>
  );
}

function RegisterPanel({ suggested, onDone }: { suggested: string; onDone: (id: string) => void }) {
  const [id, setId] = useState(suggested);
  const { portfolios } = useProtocol();
  const { busy, error, run } = useTx();
  const taken = !!portfolios[id];
  const valid = /^\d+$/.test(id) && !taken;

  return (
    <div className="card register">
      <div className="register-head">
        <div>
          <div className="h3">Register a portfolio</div>
          <div className="muted small">Creates its escrow slot in the Sepolia vault. One signature.</div>
        </div>
      </div>
      <form
        className="register-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          void run("register", origin.id, (w, a) => registerPortfolio(w, a, BigInt(id))).then((h) => h && onDone(id));
        }}
      >
        <label className="field">
          <span className="field-label">Portfolio ID</span>
          <input value={id} onChange={(e) => setId(e.target.value.trim())} inputMode="numeric" />
        </label>
        <button className="btn btn-primary" disabled={!valid || busy !== null}>
          {busy ? <><Spinner light /> Registering…</> : "Register"}
        </button>
      </form>
      {taken && <div className="field-hint">#{id} is already registered.</div>}
      {error && <Notice tone="red">{error}</Notice>}
    </div>
  );
}

export function Borrow() {
  const { address } = useWallet();
  const roles = useRoles(address);
  const { portfolios, attestation, params, synced } = useProtocol();
  const [registering, setRegistering] = useState(false);
  const [lookup, setLookup] = useState("");

  const mine = useMemo(() => {
    if (!address) return [];
    return Object.values(portfolios)
      .filter((p) => p.owner.toLowerCase() === address.toLowerCase())
      .map((p) => ({ p, info: phaseOf(p, attestation, params) }))
      .sort((a, b) => Number(b.p.id) - Number(a.p.id));
  }, [portfolios, address, attestation, params]);

  const totals = useMemo(() => {
    let available = 0n, drawn = 0n, escrowed = 0n, pending = 0n;
    for (const { p, info } of mine) {
      if (p.activeLine) {
        available += p.activeLine.creditLimit - p.activeLine.drawn;
        drawn += p.activeLine.drawn;
      }
      if (p.locked && p.lastLock) escrowed += p.lastLock.value;
      if (info.phase === "ready" || info.phase === "in-transit" || info.phase === "offer") {
        pending += creditFor(p.lastLock?.value ?? p.value, params);
      }
    }
    return { available, drawn, escrowed, pending };
  }, [mine, params]);

  const suggested = useMemo(() => {
    const ids = Object.keys(portfolios).map(Number).filter(Number.isFinite);
    return String(ids.length ? Math.max(...ids) + 1 : 1000);
  }, [portfolios]);

  if (!address) return <ConnectGate />;

  const needsAction = mine.filter(({ info }) => info.phase === "offer" || info.phase === "ready");

  return (
    <div className="shell page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Borrower console</div>
          <h1 className="h1">Your credit</h1>
        </div>
        <div className="row">
          <form
            className="lookup"
            onSubmit={(e) => {
              e.preventDefault();
              if (/^\d+$/.test(lookup)) go(`/p/${lookup}`);
            }}
          >
            <input placeholder="Look up portfolio #" value={lookup} onChange={(e) => setLookup(e.target.value.trim())} inputMode="numeric" />
          </form>
          {roles.originator && (
            <button className="btn btn-primary" onClick={() => setRegistering((r) => !r)}>
              {registering ? "Close" : "Register portfolio"}
            </button>
          )}
        </div>
      </div>

      {roles.valuer && (
        <Notice tone="violet" title="This wallet is an approved valuer">
          Portfolios waiting on a number are in the <Link to="/valuer" className="link">valuation desk →</Link>
        </Notice>
      )}

      {registering && (
        <RegisterPanel
          suggested={suggested}
          onDone={(id) => {
            setRegistering(false);
            go(`/p/${id}`);
          }}
        />
      )}

      <div className="card stats-card">
        <Stat big label="Available to draw" value={usd(totals.available)} note={totals.drawn > 0n ? `${usd(totals.drawn)} drawn` : "Across open lines"} />
        <Stat label="Awaiting claim or lock" value={usd(totals.pending)} note="Offers and proofs in flight" />
        <Stat label="Collateral escrowed" value={usd(totals.escrowed)} note="Held on Sepolia" />
      </div>

      {needsAction.length > 0 && (
        <div className="action-strip">
          {needsAction.map(({ p, info }) => (
            <Link key={p.id} to={`/p/${p.id}`} className="action-item">
              <span className="action-dot" />
              <span>
                <strong>#{p.id}</strong>{" "}
                {info.phase === "ready"
                  ? `— ${usd(creditFor(p.lastLock!.value, params))} is ready to claim`
                  : `— offer of ${usd(creditFor(p.value, params))} waiting for you`}
              </span>
              <span className="action-go">→</span>
            </Link>
          ))}
        </div>
      )}

      <div className="list card">
        <div className="list-head">
          <span>Portfolio</span>
          <span>Collateral</span>
          <span>Credit</span>
          <span>Status</span>
        </div>
        {!synced && mine.length === 0 ? (
          <div className="list-empty"><Spinner /> Reading your portfolios from Sepolia and Creditcoin…</div>
        ) : mine.length === 0 ? (
          <div className="list-empty">
            <div className="h3">No portfolios in this wallet yet.</div>
            <p className="muted">
              {roles.originator
                ? "Register your first portfolio to open its escrow slot."
                : roles.loaded
                  ? "Only approved originators can register portfolios. Bifrost onboards originators after KYC — the vault admin grants the role."
                  : "Checking this wallet's roles…"}
            </p>
            {roles.originator && !registering && (
              <button className="btn btn-primary" onClick={() => setRegistering(true)}>Register portfolio</button>
            )}
          </div>
        ) : (
          mine.map(({ p, info }) => {
            const line = p.activeLine;
            const base = p.lastLock?.value ?? p.value;
            return (
              <Link key={p.id} to={`/p/${p.id}`} className="list-row">
                <span className="list-id">
                  <strong className="num">#{p.id}</strong>
                  <span className="dim small">{PHASE_META[info.phase].next}</span>
                </span>
                <span className="num">{base > 0n ? usd(base) : <span className="dim">Unvalued</span>}</span>
                <span className="num">
                  {line ? (
                    <>{usd(line.creditLimit - line.drawn)} <span className="dim small">free</span></>
                  ) : base > 0n && info.phase !== "repaid" ? (
                    <span className="dim">up to {usd(creditFor(base, params))}</span>
                  ) : (
                    <span className="dim">—</span>
                  )}
                </span>
                <span className="list-status">
                  <PhaseChip phase={info.phase} />
                  {info.phase === "in-transit" && info.eta !== null && (
                    <span className="dim small">~{duration(info.eta)}</span>
                  )}
                </span>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
