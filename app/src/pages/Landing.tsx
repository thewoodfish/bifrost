import { useEffect, useMemo, useState } from "react";
import { useLagSeconds } from "../components/AppShell";
import { config, SEPOLIA_BLOCK_SECONDS } from "../lib/config";
import { origin } from "../lib/chains";
import { ago, duration, usd, usdShort } from "../lib/format";
import { creditFor, phaseOf, type Phase } from "../lib/phase";
import { useProtocol } from "../lib/protocol";
import { Link } from "../lib/router";
import { useSupportedChains } from "../lib/useAttestation";
import { AddressLink, ChainTag, Check, Cross, Icon, Logo, PhaseChip, Skeleton } from "../components/ui";

const FEATURE_ORDER: Phase[] = ["active", "ready", "in-transit", "repaid", "expired"];

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ── Nav ──────────────────────────────────────────────────────────────────────

function MarketingNav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <header className={`mk-nav${scrolled ? " scrolled" : ""}`}>
      <div className="wrap mk-nav-inner">
        <Link to="/" className="brand"><Logo /><span>Bifrost</span></Link>
        <nav className="mk-links">
          <button onClick={() => scrollTo("how")}>How it works</button>
          <button onClick={() => scrollTo("security")}>Security</button>
          <button onClick={() => scrollTo("faq")}>FAQ</button>
          <Link to="/ledger">Proof ledger</Link>
        </nav>
        <Link to="/app" className="btn btn-primary btn-sm">Launch app <Icon.ArrowRight size={14} /></Link>
      </div>
    </header>
  );
}

// ── Hero product shot ────────────────────────────────────────────────────────

/** The arc a proof travels along. Drawn once, so the gradient ids are safe. */
function BridgeArc({ moving }: { moving: boolean }) {
  const d = "M8 118 C 70 6, 250 6, 312 118";
  return (
    <svg className="arc" viewBox="0 0 320 124" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="arc-g" x1="0" x2="1">
          <stop offset="0" stopColor="#5563F0" />
          <stop offset="0.5" stopColor="#9460F0" />
          <stop offset="1" stopColor="#F29B12" />
        </linearGradient>
        <filter id="arc-glow" x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>
      <path d={d} fill="none" stroke="url(#arc-g)" strokeWidth="6" opacity="0.25" filter="url(#arc-glow)" />
      <path d={d} fill="none" stroke="url(#arc-g)" strokeWidth="2" />
      <path d={d} fill="none" stroke="#fff" strokeWidth="2" strokeDasharray="2 14" className="arc-dash" opacity="0.55" />
      <circle r="5" fill="#fff" stroke="#8457E8" strokeWidth="2.5" className="arc-packet">
        <animateMotion dur={moving ? "3.6s" : "2.8s"} repeatCount="indefinite" path={d} keyPoints="0;1" keyTimes="0;1" calcMode="linear" />
      </circle>
    </svg>
  );
}

function ProductShot() {
  const { portfolios, attestation, params, synced } = useProtocol();

  const featured = useMemo(() => {
    const locked = Object.values(portfolios).filter((p) => p.lastLock);
    return locked
      .map((p) => ({ p, info: phaseOf(p, attestation, params) }))
      .sort(
        (a, b) =>
          FEATURE_ORDER.indexOf(a.info.phase) - FEATURE_ORDER.indexOf(b.info.phase) ||
          b.p.lastLock!.block - a.p.lastLock!.block,
      )[0];
  }, [portfolios, attestation, params]);

  const p = featured?.p;
  const info = featured?.info;
  const line = p ? p.activeLine ?? p.lines[p.lines.length - 1] : undefined;
  const value = p?.lastLock?.value;
  const limit = line?.creditLimit ?? (value !== undefined ? creditFor(value, params) : undefined);
  const attested = info && info.phase !== "in-transit";

  return (
    <div className="frame">
      <div className="frame-bar">
        <span className="frame-dots"><i /><i /><i /></span>
        <span className="frame-url">
          <Icon.Lock size={11} /> app / portfolio {p ? <span className="num">#{p.id}</span> : "…"}
        </span>
        {info ? <PhaseChip phase={info.phase} /> : <span />}
      </div>

      {!p && (
        <div className="frame-empty">
          {synced ? "No positions yet — be the first." : <><Skeleton w={180} /> <Skeleton w={120} /></>}
        </div>
      )}

      {p && (
        <>
          <div className="bridge">
            <div className="bridge-end">
              <ChainTag side="origin" />
              <div className="be-label">Collateral escrowed</div>
              <div className="be-value num">{usd(value)}</div>
              <div className="be-sub">Block #{p.lastLock!.block.toLocaleString()} · never leaves Sepolia</div>
            </div>
            <div className="bridge-mid">
              <BridgeArc moving={!attested} />
              <div className="bridge-pill">
                <span className="dot dot-live" style={{ background: "var(--attest)" }} />
                Attestcoin proof
              </div>
              <div className="bridge-note">Proof, not asset</div>
            </div>
            <div className="bridge-end bridge-end-r">
              <ChainTag side="creditcoin" />
              <div className="be-label">{p.activeLine ? "Credit line" : "Credit available"}</div>
              <div className="be-value be-value-hero num">{usd(limit)}</div>
              <div className="be-sub">{(params?.ltvBps ?? 8000) / 100}% advance rate · USDC</div>
            </div>
          </div>

          <div className="frame-foot">
            <div className="mini-steps">
              <span className="ms done"><Check size={11} /> Locked</span>
              <span className={`ms ${attested ? "done" : "active"}`}>{attested ? <Check size={11} /> : <i />} Attested</span>
              <span className={`ms ${line ? "done" : attested ? "active" : ""}`}>{line ? <Check size={11} /> : <i />} Funded</span>
            </div>
            <span className="dim small hide-sm">{p.lastLock!.ts ? `Locked ${ago(p.lastLock!.ts)}` : ""}</span>
            <Link to={attested ? `/verify/${p.id}` : `/p/${p.id}`} className="frame-link">
              {attested ? "Verify this proof" : "Watch it land"} <Icon.ArrowRight size={13} />
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

// ── Sections ─────────────────────────────────────────────────────────────────

function Metrics() {
  const { liquidity, stats, synced } = useProtocol();
  const lag = useLagSeconds();
  const cell = (v: string | null, label: string) => (
    <div className="metric">
      <div className="metric-value num">{v ?? <Skeleton w={90} h={30} />}</div>
      <div className="metric-label">{label}</div>
    </div>
  );
  return (
    <section className="wrap metrics-wrap">
      <div className="metrics-head"><span className="dot dot-live" /> Live from both chains</div>
      <div className="metrics">
        {cell(liquidity !== null ? usdShort(liquidity) : null, "Pool liquidity on Creditcoin")}
        {cell(synced ? usdShort(stats.collateralEscrowed) : null, "Collateral escrowed on Sepolia")}
        {cell(synced ? usdShort(stats.creditExtended) : null, "Credit extended against proofs")}
        {cell(lag !== null ? duration(lag) : null, "Live attestation lag")}
      </div>
    </section>
  );
}

function Zeroes() {
  return (
    <section className="wrap zeroes">
      {[
        ["0", "bridges", "Collateral never leaves its chain."],
        ["0", "oracles", "No one reports a price into the trust path."],
        ["0", "multisigs", "No committee can sign a line into existence."],
        ["1", "proof", "Checked on-chain by Creditcoin itself."],
      ].map(([n, w, s]) => (
        <div key={w} className="zero">
          <div className="zero-n"><span className={n === "1" ? "grad" : ""}>{n}</span> {w}</div>
          <div className="zero-s">{s}</div>
        </div>
      ))}
    </section>
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
    body: "Attestcoin validators attest the Sepolia block containing your lock. No bridge takes custody. No oracle reports a price.",
    tech: "Merkle + continuity proof",
  },
  {
    side: "creditcoin" as const,
    title: "Funded on Creditcoin",
    body: "Creditcoin's BlockProver precompile checks the proof on-chain and the pool releases stablecoins at up to 80% of attested value.",
    tech: "BlockProver 0x…0FD2 · verify()",
  },
];

function How() {
  return (
    <section id="how" className="wrap section">
      <div className="section-head">
        <div className="eyebrow">How it works</div>
        <h2 className="h-section">Don't move the asset.<br /><span className="dim-2">Move a proof about it.</span></h2>
      </div>
      <div className="how">
        <div className="how-line" />
        {STEPS.map((s, i) => (
          <div key={s.title} className={`how-step how-${s.side}`}>
            <div className="how-node"><span className="num">{i + 1}</span></div>
            <ChainTag side={s.side} />
            <h3 className="h-card">{s.title}</h3>
            <p>{s.body}</p>
            <code className="how-code">{s.tech}</code>
          </div>
        ))}
      </div>
    </section>
  );
}

function Bento() {
  const { params } = useProtocol();
  const lag = useLagSeconds();
  const ltv = (params?.ltvBps ?? 8000) / 100;
  return (
    <section className="wrap section">
      <div className="section-head">
        <div className="eyebrow">Why Bifrost</div>
        <h2 className="h-section">Private credit that closes in minutes, not quarters.</h2>
      </div>
      <div className="bento">
        <div className="tile tile-wide">
          <div className="tile-copy">
            <Icon.Clock size={18} />
            <h3 className="h-card">Time to funds</h3>
            <p>Traditional private credit spends months on legal paperwork. A Bifrost line is one lock, one attestation, one claim.</p>
          </div>
          <div className="race">
            <div className="race-row">
              <span className="race-name">Traditional private credit</span>
              <div className="race-track"><span className="race-bar slow" /></div>
              <span className="race-t num">3–6 months</span>
            </div>
            <div className="race-row">
              <span className="race-name">Bifrost</span>
              <div className="race-track"><span className="race-bar fast" /></div>
              <span className="race-t num">~15 min</span>
            </div>
          </div>
        </div>

        <div className="tile">
          <Icon.Scale size={18} />
          <h3 className="h-card">Independent valuers</h3>
          <p>Borrowers can't price their own collateral. The vault enforces it: originators and valuers are separate roles.</p>
        </div>

        <div className="tile">
          <Icon.Clock size={18} />
          <h3 className="h-card">Freshness, enforced on-chain</h3>
          <div className="tile-nums">
            <div><strong className="num">{params ? duration(params.maxValuationAge) : "7 days"}</strong><span>max valuation age</span></div>
            <div><strong className="num">{params ? params.maxLockAge.toLocaleString() : "7,200"}</strong><span>max lock age, blocks</span></div>
          </div>
        </div>

        <div className="tile">
          <Icon.Shield size={18} />
          <h3 className="h-card">One receipt, one line</h3>
          <p>Every attested receipt is consumed when it opens a line. Replaying it reverts with <code>ReceiptAlreadyUsed()</code>.</p>
        </div>

        <div className="tile">
          <Icon.Layers size={18} />
          <h3 className="h-card">{ltv}% advance rate</h3>
          <p>Over-collateralized by design — the buffer absorbs real-world default risk.</p>
          <div className="ltv"><span style={{ width: `${ltv}%` }} /></div>
          <div className="ltv-legend"><span>Credit {ltv}%</span><span>Buffer {100 - ltv}%</span></div>
        </div>

        <div className="tile tile-strip">
          <Icon.Pulse size={18} />
          <h3 className="h-card">Honest latency</h3>
          <p>Attestation runs 8–20 minutes behind Sepolia. We show the real frontier, not a fake progress bar.</p>
          <div className="tile-live"><span className="dot dot-live" /> <span className="num">{lag !== null ? duration(lag) : "—"}</span> behind right now</div>
        </div>
      </div>
    </section>
  );
}

function BreakIt() {
  const { portfolios, attestation, params } = useProtocol();
  // Point "try to break it" at a real, verifiable lock.
  const verifiable = useMemo(
    () =>
      Object.values(portfolios)
        .filter((p) => p.lastLock && phaseOf(p, attestation, params).phase !== "in-transit")
        .sort((a, b) => b.lastLock!.block - a.lastLock!.block)[0],
    [portfolios, attestation, params],
  );
  const lockAge = params ? params.maxLockAge.toLocaleString() : "7,200";

  return (
    <section id="security" className="wrap section">
      <div className="breakit">
        <div className="breakit-copy">
          <div className="eyebrow">Don't trust us</div>
          <h2 className="h-section">Try to break it.</h2>
          <p className="lede">
            Pick any position and your browser fetches its Attestcoin proof, decodes the receipt,
            and asks Creditcoin's BlockProver precompile to check it — live. Then change the
            attested value by a single dollar and ask again.
          </p>
          <Link to={verifiable ? `/verify/${verifiable.id}` : "/ledger"} className="btn btn-primary btn-lg">
            {verifiable ? <>Verify portfolio #{verifiable.id} yourself</> : "Open the proof ledger"} <Icon.ArrowRight size={15} />
          </Link>
        </div>
        <div className="term" aria-hidden>
          <div className="term-bar"><span className="frame-dots"><i /><i /><i /></span><span>BlockProver · 0x…0FD2</span></div>
          <div className="term-body">
            <div className="term-line"><span className="t-ok"><Check size={12} /></span><span>Genuine receipt</span><span className="t-r">verify() → true</span></div>
            <div className="term-line"><span className="t-bad"><Cross size={12} /></span><span>Value changed by $1</span><span className="t-r">Merkle proof validation failed</span></div>
            <div className="term-line"><span className="t-bad"><Cross size={12} /></span><span>Receipt reused</span><span className="t-r">ReceiptAlreadyUsed()</span></div>
            <div className="term-line"><span className="t-bad"><Cross size={12} /></span><span>Lock {lockAge}+ blocks old</span><span className="t-r">LockTooOld()</span></div>
            <div className="term-line"><span className="t-bad"><Cross size={12} /></span><span>Source tx reverted</span><span className="t-r">SourceTxFailed()</span></div>
            <div className="term-cursor">_</div>
          </div>
        </div>
      </div>
    </section>
  );
}

const COMPARE: { label: string; tradfi: string; bridge: string; bifrost: string }[] = [
  { label: "Time to funds", tradfi: "3–6 months", bridge: "Minutes", bifrost: "~15 minutes" },
  { label: "Collateral leaves its chain", tradfi: "No — it's on paper", bridge: "Yes, wrapped", bifrost: "Never" },
  { label: "What you trust", tradfi: "Lawyers & custodians", bridge: "A bridge multisig", bifrost: "A proof anyone can check" },
  { label: "Who prices collateral", tradfi: "The lender", bridge: "A price oracle", bifrost: "Independent valuer, on-chain" },
];

function Compare() {
  return (
    <section className="wrap section">
      <div className="compare-wrap">
        <table className="compare">
          <thead>
            <tr>
              <th />
              <th>Traditional private credit</th>
              <th>Bridged DeFi lending</th>
              <th className="us"><span className="us-head"><Logo size={18} /> Bifrost</span></th>
            </tr>
          </thead>
          <tbody>
            {COMPARE.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                <td>{r.tradfi}</td>
                <td>{r.bridge}</td>
                <td className="us"><Check size={13} /> {r.bifrost}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Personas() {
  return (
    <section className="wrap section">
      <div className="section-head">
        <div className="eyebrow">Built for every side of the deal</div>
        <h2 className="h-section">One protocol. Three seats at the table.</h2>
      </div>
      <div className="personas">
        <Link to="/app" className="persona">
          <div className="persona-icon" style={{ color: "var(--sepolia)" }}><Icon.Wallet size={18} /></div>
          <div className="eyebrow">Originators</div>
          <h3 className="h-card">Unlock working capital from the book you already have.</h3>
          <p>Connect the wallet that owns your portfolios. Bifrost finds them, shows your offer, and walks each one from escrow to funded.</p>
          <span className="persona-cta">Open dashboard <Icon.ArrowRight size={14} /></span>
        </Link>
        <Link to="/valuer" className="persona">
          <div className="persona-icon" style={{ color: "var(--attest)" }}><Icon.Scale size={18} /></div>
          <div className="eyebrow">Valuers</div>
          <h3 className="h-card">Price collateral. Nothing gets lent without you.</h3>
          <p>A queue of portfolios waiting on an independent number, with freshness tracked for you. Stale valuations can't be locked against.</p>
          <span className="persona-cta">Open valuation desk <Icon.ArrowRight size={14} /></span>
        </Link>
        <Link to="/ledger" className="persona">
          <div className="persona-icon" style={{ color: "var(--credit)" }}><Icon.Eye size={18} /></div>
          <div className="eyebrow">Risk & LPs</div>
          <h3 className="h-card">Audit every dollar of the book, yourself.</h3>
          <p>Every lock and every line is public, and each one re-verifies in your browser against the live chains. No report to trust.</p>
          <span className="persona-cta">Open proof ledger <Icon.ArrowRight size={14} /></span>
        </Link>
      </div>
    </section>
  );
}

function SupportedChains() {
  const { chains, error } = useSupportedChains();
  if (error) return <span className="dim">ChainInfo precompile unreachable</span>;
  if (chains.length === 0) return <Skeleton w={160} />;
  return (
    <>
      {chains.map((c) => (
        <span key={c.chainKey} className="tag">
          {c.chainName}
          {c.chainId === origin.id && c.chainKey === config.chainKey && <strong> · in use</strong>}
        </span>
      ))}
    </>
  );
}

function Faq() {
  const { params } = useProtocol();
  const QA: [string, React.ReactNode][] = [
    [
      "What stops a borrower from inflating their collateral?",
      <>The vault separates roles: originators register and lock portfolios, but only an approved, independent valuer can publish a valuation. The originator's wallet cannot price its own book — and the vault refuses to lock against a valuation older than {params ? duration(params.maxValuationAge) : "7 days"}.</>,
    ],
    [
      "Why does a credit line take 8–20 minutes?",
      <>That's how long Attestcoin validators take to attest the Sepolia block containing your lock. It isn't tunable, and that's the point: there is no operator who could speed it up, because there is no operator in the trust path at all.</>,
    ],
    [
      "What exactly does Creditcoin verify?",
      <>Creditcoin's BlockProver precompile checks a Merkle proof that your lock transaction is in an attested Sepolia block, plus a continuity proof back to the attested checkpoint. The pool engine then decodes <code>PortfolioLocked</code> straight out of the receipt and checks the transaction succeeded, the owner, value, valuation round, lock age, and that the receipt has never been used.</>,
    ],
    [
      "Which chains can collateral live on?",
      <>Whatever Attestcoin attests. Right now the ChainInfo precompile reports: <span className="faq-chains"><SupportedChains /></span> Base and Plume will follow when Attestcoin supports them.</>,
    ],
    [
      "Is it live?",
      <>Yes — on Sepolia and Creditcoin CC3 testnet, with test assets. Every number on this page is read from those chains in your browser, and the <Link to="/ledger" className="link">proof ledger</Link> lists every position.</>,
    ],
  ];
  return (
    <section id="faq" className="wrap section faq-wrap">
      <div className="section-head">
        <div className="eyebrow">FAQ</div>
        <h2 className="h-section">Questions risk officers ask.</h2>
      </div>
      <div className="faq">
        {QA.map(([q, a], i) => (
          <details key={q} className="faq-item" open={i === 0}>
            <summary>{q}<span className="faq-plus"><Icon.Plus size={16} /></span></summary>
            <div className="faq-a">{a}</div>
          </details>
        ))}
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="wrap section">
      <div className="cta">
        <div className="cta-glow" />
        <h2 className="h-section">Your loan book is already collateral.</h2>
        <p className="lede">Connect the wallet that owns it and see your offer in seconds.</p>
        <div className="hero-ctas">
          <Link to="/app" className="btn btn-primary btn-lg">Launch app <Icon.ArrowRight size={15} /></Link>
          <Link to="/ledger" className="btn btn-secondary btn-lg">Browse live positions</Link>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="mk-footer">
      <div className="wrap footer-grid">
        <div className="footer-brand">
          <Link to="/" className="brand"><Logo /><span>Bifrost</span></Link>
          <p className="dim small">Cross-chain private credit. Proven by Attestcoin, funded on Creditcoin.</p>
        </div>
        <div>
          <div className="footer-label">Product</div>
          <Link to="/app">Dashboard</Link>
          <Link to="/ledger">Proof ledger</Link>
          <Link to="/valuer">Valuation desk</Link>
        </div>
        <div>
          <div className="footer-label">Contracts</div>
          <div className="footer-kv"><span>Origin vault</span><AddressLink side="origin" address={config.originVault} /></div>
          <div className="footer-kv"><span>Pool engine</span><AddressLink side="creditcoin" address={config.poolEngine} /></div>
        </div>
        <div>
          <div className="footer-label">Attested chains <span className="dim">· live</span></div>
          <div className="footer-tags"><SupportedChains /></div>
        </div>
      </div>
      <div className="wrap footer-base dim small">
        <span>Testnet deployment · test assets only</span>
        <span>Sepolia block time ~{SEPOLIA_BLOCK_SECONDS}s · CC3 chain id 102031</span>
      </div>
    </footer>
  );
}

export function Landing() {
  return (
    <div className="mk">
      <MarketingNav />
      <section className="hero">
        <div className="aurora" aria-hidden />
        <div className="gridlines" aria-hidden />
        <div className="wrap hero-inner">
          <Link to="/ledger" className="announce">
            <span className="announce-tag">Live</span>
            <span className="announce-long">Sepolia → Creditcoin testnet, verified by Attestcoin</span>
            <span className="announce-short">Running on testnet</span>
            <Icon.ArrowRight size={13} />
          </Link>
          <h1 className="hero-title">
            Borrow against your loan book.
            <br />
            <span className="grad">Without moving it.</span>
          </h1>
          <p className="hero-sub">
            Bifrost turns a tokenized loan portfolio into a stablecoin credit line in about fifteen
            minutes. The portfolio stays escrowed on its home chain; Creditcoin checks a
            cryptographic proof of the lock.
          </p>
          <div className="hero-ctas">
            <Link to="/app" className="btn btn-primary btn-lg">Launch app <Icon.ArrowRight size={15} /></Link>
            <button className="btn btn-secondary btn-lg" onClick={() => scrollTo("how")}>How it works</button>
          </div>
        </div>
        <div className="wrap hero-shot">
          <ProductShot />
        </div>
      </section>

      <Metrics />
      <Zeroes />
      <How />
      <Bento />
      <BreakIt />
      <Compare />
      <Personas />
      <Faq />
      <FinalCta />
      <Footer />
    </div>
  );
}
