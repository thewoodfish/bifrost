import { useMemo } from "react";
import { config, SEPOLIA_BLOCK_SECONDS } from "../lib/config";
import { origin } from "../lib/chains";
import { ago, duration, usd, usdShort } from "../lib/format";
import { creditFor, phaseOf, type Phase } from "../lib/phase";
import { useProtocol } from "../lib/protocol";
import { Link } from "../lib/router";
import { useSupportedChains } from "../lib/useAttestation";
import { AddressLink, ChainTag, Check, Cross, PhaseChip, Spinner } from "../components/ui";

const FEATURE_ORDER: Phase[] = ["active", "ready", "in-transit", "repaid", "expired"];

/** A real position, live from both chains — the product is its own best screenshot. */
function LiveTermSheet() {
  const { portfolios, attestation, params, synced } = useProtocol();

  const featured = useMemo(() => {
    const locked = Object.values(portfolios).filter((p) => p.lastLock);
    const ranked = locked
      .map((p) => ({ p, info: phaseOf(p, attestation, params) }))
      .sort(
        (a, b) =>
          FEATURE_ORDER.indexOf(a.info.phase) - FEATURE_ORDER.indexOf(b.info.phase) ||
          b.p.lastLock!.block - a.p.lastLock!.block,
      );
    return ranked[0];
  }, [portfolios, attestation, params]);

  if (!featured) {
    return (
      <div className="termsheet card">
        <div className="termsheet-empty">{synced ? "No positions yet." : <><Spinner /> Reading both chains…</>}</div>
      </div>
    );
  }

  const { p, info } = featured;
  const line = p.activeLine ?? p.lines[p.lines.length - 1];
  const value = p.lastLock!.value;
  const limit = line?.creditLimit ?? creditFor(value, params);

  return (
    <div className="termsheet card">
      <div className="termsheet-head">
        <div>
          <div className="eyebrow">Live position</div>
          <div className="termsheet-title num">Portfolio #{p.id}</div>
        </div>
        <PhaseChip phase={info.phase} />
      </div>

      <div className="termsheet-rows">
        <div className="ts-row">
          <div>
            <div className="ts-label">Collateral escrowed</div>
            <div className="ts-sub"><ChainTag side="origin" /> never leaves its chain</div>
          </div>
          <div className="ts-value num">{usd(value)}</div>
        </div>
        <div className="ts-bridge">
          <span className="ts-bridge-line" />
          <span className="ts-bridge-label">
            <ChainTag side="attest" /> proof, not asset
          </span>
          <span className="ts-bridge-line" />
        </div>
        <div className="ts-row">
          <div>
            <div className="ts-label">{p.activeLine ? "Credit line" : "Credit available"}</div>
            <div className="ts-sub"><ChainTag side="creditcoin" /> {(params?.ltvBps ?? 8000) / 100}% advance rate</div>
          </div>
          <div className="ts-value ts-value-hero num">{usd(limit)}</div>
        </div>
      </div>

      <div className="termsheet-foot">
        <span className="dim small">
          Locked at block {p.lastLock!.block.toLocaleString()} {p.lastLock!.ts && `· ${ago(p.lastLock!.ts)}`}
        </span>
        <Link to={`/verify/${p.id}`} className="btn btn-secondary btn-sm">Verify this proof →</Link>
      </div>
    </div>
  );
}

function StatsBand() {
  const { liquidity, stats, attestation: a } = useProtocol();
  const lag = a.behind === null ? null : a.behind / (a.rate && a.rate > 0 ? a.rate : 1 / SEPOLIA_BLOCK_SECONDS);
  return (
    <div className="band">
      <div className="shell band-grid">
        <div className="band-stat">
          <div className="band-value num">{usdShort(liquidity)}</div>
          <div className="band-label">Pool liquidity on Creditcoin</div>
        </div>
        <div className="band-stat">
          <div className="band-value num">{usdShort(stats.collateralEscrowed)}</div>
          <div className="band-label">Collateral escrowed on Sepolia</div>
        </div>
        <div className="band-stat">
          <div className="band-value num">{usdShort(stats.creditExtended)}</div>
          <div className="band-label">Credit extended against proofs</div>
        </div>
        <div className="band-stat">
          <div className="band-value num">{lag !== null ? duration(lag) : "—"}</div>
          <div className="band-label">Live attestation lag</div>
        </div>
      </div>
    </div>
  );
}

const STEPS = [
  {
    side: "origin" as const,
    title: "Escrow where it lives",
    body: "Your tokenized loan book stays in a vault on its compliance chain. An independent valuer — never you — sets the number you borrow against.",
    tech: "RWAOriginVault.lockPortfolio()",
  },
  {
    side: "attest" as const,
    title: "Proven, not bridged",
    body: "Attestcoin validators attest the Sepolia block containing your lock. No bridge takes custody. No oracle reports a price. About 8–20 minutes.",
    tech: "Merkle + continuity proof",
  },
  {
    side: "creditcoin" as const,
    title: "Funded on Creditcoin",
    body: "Creditcoin's BlockProver precompile checks the proof on-chain and the pool releases stablecoins at up to 80% of attested value.",
    tech: "BlockProver 0x…0FD2 · verify()",
  },
];

const COMPARE: { label: string; tradfi: string; bridge: string; bifrost: string }[] = [
  { label: "Time to funds", tradfi: "3–6 months", bridge: "Minutes", bifrost: "~15 minutes" },
  { label: "Collateral leaves its chain", tradfi: "No — it's on paper", bridge: "Yes, wrapped", bifrost: "Never" },
  { label: "What you trust", tradfi: "Lawyers & custodians", bridge: "A bridge multisig", bifrost: "A proof anyone can check" },
  { label: "Who prices collateral", tradfi: "The lender", bridge: "A price oracle", bifrost: "Independent valuer, on-chain" },
];

function SupportedChains() {
  const { chains, error } = useSupportedChains();
  if (error) return <span className="dim">ChainInfo precompile unreachable</span>;
  if (chains.length === 0) return <span className="dim">Reading…</span>;
  return (
    <>
      {chains.map((c) => (
        <span key={c.chainKey} className="pill-sm">
          {c.chainName}
          {c.chainId === origin.id && c.chainKey === config.chainKey && <strong> · in use</strong>}
        </span>
      ))}
    </>
  );
}

export function Landing() {
  const { portfolios, attestation, params } = useProtocol();

  // Point "try to break it" at a real, verifiable lock.
  const verifiable = useMemo(
    () =>
      Object.values(portfolios)
        .filter((p) => p.lastLock && phaseOf(p, attestation, params).phase !== "in-transit")
        .sort((a, b) => b.lastLock!.block - a.lastLock!.block)[0],
    [portfolios, attestation, params],
  );

  return (
    <div className="landing">
      <section className="hero shell">
        <div className="hero-copy">
          <span className="kicker"><span className="kicker-dot" /> Live on Sepolia → Creditcoin testnet</span>
          <h1 className="display">
            Borrow against your loan book.
            <em> Without moving it.</em>
          </h1>
          <p className="lede">
            Bifrost turns a tokenized loan portfolio into a stablecoin credit line in about fifteen
            minutes. The portfolio stays escrowed on its home chain; Creditcoin checks a
            cryptographic proof of the lock. No bridge, no oracle, no multisig in between.
          </p>
          <div className="hero-ctas">
            <Link to="/app" className="btn btn-primary btn-lg">Get a credit line</Link>
            <Link to="/ledger" className="btn btn-secondary btn-lg">See every live proof</Link>
          </div>
        </div>
        <div className="hero-visual">
          <LiveTermSheet />
        </div>
      </section>

      <StatsBand />

      <section className="shell section">
        <div className="section-head">
          <div className="eyebrow">How it works</div>
          <h2 className="h2">Don't move the asset. Move a proof about it.</h2>
        </div>
        <div className="steps">
          {STEPS.map((s, i) => (
            <div key={s.title} className={`step-card step-${s.side}`}>
              <div className="step-top">
                <span className="step-num num">0{i + 1}</span>
                <ChainTag side={s.side} />
              </div>
              <h3 className="h3">{s.title}</h3>
              <p className="muted">{s.body}</p>
              <div className="step-tech mono">{s.tech}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="shell section">
        <div className="section-head">
          <div className="eyebrow">Why now</div>
          <h2 className="h2">Private credit that closes in minutes, not quarters.</h2>
        </div>
        <div className="compare-wrap">
          <table className="compare">
            <thead>
              <tr>
                <th />
                <th>Traditional private credit</th>
                <th>Bridged DeFi lending</th>
                <th className="compare-us">Bifrost</th>
              </tr>
            </thead>
            <tbody>
              {COMPARE.map((r) => (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  <td>{r.tradfi}</td>
                  <td>{r.bridge}</td>
                  <td className="compare-us">{r.bifrost}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="dark-band">
        <div className="shell dark-inner">
          <div>
            <div className="eyebrow eyebrow-dark">Don't trust us</div>
            <h2 className="h2 h2-dark">Try to break it.</h2>
            <p className="dark-copy">
              Pick any position and your browser fetches its Attestcoin proof, decodes the
              receipt, and asks Creditcoin's BlockProver precompile to check it — live. Then
              change the attested value by a single dollar and ask again.
            </p>
            {verifiable ? (
              <Link to={`/verify/${verifiable.id}`} className="btn btn-light btn-lg">
                Verify portfolio #{verifiable.id} yourself
              </Link>
            ) : (
              <Link to="/ledger" className="btn btn-light btn-lg">Open the proof ledger</Link>
            )}
          </div>
          <div className="dark-demo" aria-hidden>
            <div className="dd-row ok"><span className="dd-icon"><Check /></span><span>Genuine receipt</span><span className="mono">verify() → true</span></div>
            <div className="dd-row bad"><span className="dd-icon"><Cross /></span><span>Value changed by $1</span><span className="mono">Merkle proof validation failed</span></div>
            <div className="dd-row bad"><span className="dd-icon"><Cross /></span><span>Receipt reused</span><span className="mono">ReceiptAlreadyUsed()</span></div>
            <div className="dd-row bad"><span className="dd-icon"><Cross /></span><span>Lock 7,200+ blocks old</span><span className="mono">LockTooOld()</span></div>
          </div>
        </div>
      </section>

      <section className="shell section">
        <div className="audiences">
          <Link to="/app" className="audience card">
            <div className="eyebrow">For originators</div>
            <h3 className="h3">Unlock working capital from the book you already have.</h3>
            <p className="muted">Connect the wallet that owns your portfolios. Bifrost finds them, shows your offer, and walks each one from escrow to funded.</p>
            <span className="audience-cta">Open the borrower console →</span>
          </Link>
          <Link to="/valuer" className="audience card">
            <div className="eyebrow">For valuers</div>
            <h3 className="h3">Price collateral. Nothing gets lent without you.</h3>
            <p className="muted">A queue of portfolios waiting on an independent number, with freshness tracked for you. Stale valuations can't be locked against.</p>
            <span className="audience-cta">Open the valuation desk →</span>
          </Link>
        </div>
      </section>

      <footer className="footer">
        <div className="shell footer-inner">
          <div className="footer-col">
            <div className="footer-label">Attested source chains <span className="dim">· live from ChainInfo</span></div>
            <div className="footer-chips"><SupportedChains /></div>
          </div>
          <div className="footer-col">
            <div className="footer-label">Contracts</div>
            <div className="footer-contracts small">
              <span>Origin vault</span> <AddressLink side="origin" address={config.originVault} />
              <span>Pool engine</span> <AddressLink side="creditcoin" address={config.poolEngine} />
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
