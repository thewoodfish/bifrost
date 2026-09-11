import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { lockPortfolio, previewOpen, submitOpen, type PreviewResult } from "../lib/actions";
import { creditcoin, origin } from "../lib/chains";
import { SEPOLIA_BLOCK_SECONDS } from "../lib/config";
import { ago, dateTime, duration, usd, usdFine } from "../lib/format";
import type { PortfolioRecord, ProtocolEvent } from "../lib/indexer";
import { creditFor, phaseOf, type PhaseInfo } from "../lib/phase";
import { verifyOnCreditcoin } from "../lib/proof";
import { explainReason, fetchProof, ProverError } from "../lib/prover";
import { useProtocol } from "../lib/protocol";
import { Link } from "../lib/router";
import { useHeightAttested } from "../lib/useAttestation";
import { usePortfolioLive, useRoles, type LiveState } from "../lib/usePortfolio";
import { useTx } from "../lib/useTx";
import { useWallet } from "../lib/wallet";
import { CreditAccount } from "../components/CreditAccount";
import { ProofJourney } from "../components/ProofJourney";
import { ValuationForm } from "../components/ValuationForm";
import { Avatar, AddressLink, ChainTag, Check, Cross, Empty, Icon, Notice, PhaseChip, Skeleton, Spinner, TxLink } from "../components/ui";
import type { Phase } from "../lib/phase";

// ── Offer ────────────────────────────────────────────────────────────────────

function OfferHero({
  rec, info, isOwner, onLocked,
}: { rec: PortfolioRecord; info: PhaseInfo; isOwner: boolean; onLocked: () => unknown }) {
  const { params } = useProtocol();
  const { address } = useWallet();
  const { busy, error, run } = useTx();
  const limit = creditFor(rec.value, params);
  const ltv = (params?.ltvBps ?? 8000) / 100;
  const stale = info.phase === "stale";

  return (
    <div className="card hero-card glow-card">
      <div className="eyebrow">{stale ? "Offer paused" : "Your offer"}</div>
      <div className="offer-amount num">{usd(limit)}</div>
      <div className="offer-terms">
        against <strong>{usd(rec.value)}</strong> of collateral · {ltv}% advance rate · valued{" "}
        {rec.valuedAt ? ago(rec.valuedAt) : ""} by an independent valuer
      </div>

      {stale ? (
        <Notice tone="amber" title="The valuation is too old to lock against">
          The vault only escrows against a valuation revisited in the last{" "}
          {params ? duration(params.maxValuationAge) : "7 days"}. Ask your valuer to republish —
          the offer comes back the moment they do.
        </Notice>
      ) : (
        <>
          <ol className="accept-steps">
            <li>
              <span className="accept-n">1</span>
              <div><strong>Lock on Sepolia</strong><span className="muted"> — one signature. Your portfolio stays in the vault.</span></div>
            </li>
            <li>
              <span className="accept-n">2</span>
              <div><strong>Attestcoin proves it</strong><span className="muted"> — about 8–20 minutes. Nothing for you to do.</span></div>
            </li>
            <li>
              <span className="accept-n">3</span>
              <div><strong>Claim on Creditcoin</strong><span className="muted"> — one signature. Stablecoins in your wallet.</span></div>
            </li>
          </ol>

          {isOwner ? (
            <button
              className="btn btn-primary btn-xl"
              disabled={busy !== null}
              onClick={() => void run("lock", origin.id, (w, a) => lockPortfolio(w, a, BigInt(rec.id)), onLocked)}
            >
              {busy ? <><Spinner /> Locking on Sepolia…</> : <>Accept &amp; lock collateral <Icon.ArrowRight size={16} /></>}
            </button>
          ) : (
            <Notice>
              {address ? "Only the portfolio owner can accept this offer." : "Connect the owner's wallet to accept this offer."}
            </Notice>
          )}
          {info.freshnessLeft !== null && (
            <div className="fine">
              Valuation stays lockable for {duration(info.freshnessLeft)}. Once locked, it's frozen.
            </div>
          )}
        </>
      )}
      {error && <Notice tone="red">{error}</Notice>}
    </div>
  );
}

// ── Claim ────────────────────────────────────────────────────────────────────

type CheckState = { state: "idle" | "run" | "ok" | "fail" | "wait"; detail?: string };

const RETRY_MS = 15_000;

/**
 * The claim, preceded by the same checks the engine will make — run automatically, for
 * free, before the borrower is asked to sign anything. `attestAndOpenCredit` consumes the
 * receipt on first success, so a borrower should never be the one to discover a problem.
 */
function ClaimHero({
  rec, info, live, isOwner, onClaimed,
}: { rec: PortfolioRecord; info: PhaseInfo; live: LiveState; isOwner: boolean; onClaimed: () => unknown }) {
  const { params } = useProtocol();
  const { address } = useWallet();
  const { busy, error, run } = useTx();
  const lock = rec.lastLock!;
  const confirmed = useHeightAttested(lock.block);

  const [fetchC, setFetchC] = useState<CheckState>({ state: "idle" });
  const [verifyC, setVerifyC] = useState<CheckState>({ state: "idle" });
  const [engineC, setEngineC] = useState<CheckState>({ state: "idle" });
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const runChecks = useCallback(async () => {
    clearTimeout(timer.current);
    setPreview(null);
    setFetchC({ state: "run" });
    setVerifyC({ state: "idle" });
    setEngineC({ state: "idle" });
    let proof;
    try {
      proof = await fetchProof(lock.tx);
    } catch (e) {
      if (e instanceof ProverError && e.transient) {
        setFetchC({ state: "wait", detail: "The prover is still materializing this proof. Retrying automatically." });
        timer.current = setTimeout(() => void runChecks(), RETRY_MS);
      } else {
        setFetchC({ state: "fail", detail: (e as Error).message });
      }
      return;
    }
    setFetchC({
      state: "ok",
      detail: `Block ${proof.height.toLocaleString()}, tx ${proof.txIndex} · ${proof.merkleProof.siblings.length} Merkle siblings · ${proof.continuityProof.roots.length} continuity roots`,
    });

    setVerifyC({ state: "run" });
    const v = await verifyOnCreditcoin(proof);
    if (!v.ok) {
      setVerifyC({ state: "fail", detail: v.reason ?? "Rejected" });
      return;
    }
    setVerifyC({ state: "ok", detail: `BlockProver.verify() returned true in ${Math.round(v.ms)} ms` });

    setEngineC({ state: "run" });
    try {
      const p = await previewOpen(BigInt(rec.id), lock.tx, lock.owner, lock.value, lock.round, proof);
      if (p.ok) {
        setPreview(p);
        setEngineC({ state: "ok", detail: "Owner, value, round and lock age all match the receipt" });
      } else {
        const x = explainReason(p.reason);
        setEngineC({ state: "fail", detail: `${x.title}. ${x.detail}` });
      }
    } catch (e) {
      setEngineC({ state: "fail", detail: (e as Error).message });
    }
  }, [lock.tx, lock.owner, lock.value, lock.round, rec.id]);

  useEffect(() => {
    if (confirmed) void runChecks();
    return () => clearTimeout(timer.current);
  }, [confirmed, runChecks]);

  const limit = creditFor(lock.value, params);
  const hoursLeft = info.claimBlocksLeft !== null ? info.claimBlocksLeft * SEPOLIA_BLOCK_SECONDS : null;

  const rows: [string, CheckState][] = [
    ["Proof fetched from Attestcoin", fetchC],
    ["Verified by Creditcoin's BlockProver", verifyC],
    ["Claim matches the attested receipt", engineC],
  ];

  return (
    <div className="card hero-card glow-card">
      <div className="eyebrow">Funds ready</div>
      <div className="offer-amount num">{usd(limit)}</div>
      <div className="offer-terms">
        Your lock is attested. Creditcoin will verify the proof and release the line in one transaction.
      </div>

      <div className="checks">
        {confirmed === false && (
          <div className="check is-run"><span className="check-icon"><Spinner /></span><div>Confirming attestation with <span className="mono">is_height_attested</span>…</div></div>
        )}
        {rows.map(([label, c]) => (
          <div key={label} className={`check is-${c.state}`}>
            <span className="check-icon">
              {c.state === "ok" ? <Check /> : c.state === "fail" ? <Cross /> : c.state === "run" || c.state === "wait" ? <Spinner /> : <span className="check-idle" />}
            </span>
            <div>
              <div>{label}</div>
              {c.detail && <div className="check-detail">{c.detail}</div>}
            </div>
          </div>
        ))}
      </div>

      {isOwner ? (
        <button
          className="btn btn-primary btn-xl"
          disabled={!preview || busy !== null}
          onClick={() => preview && void run("open", creditcoin.id, (w, a) => submitOpen(w, a, preview), async () => { await live.refresh(); await onClaimed(); })}
        >
          {busy ? <><Spinner /> Verifying on Creditcoin…</> : preview ? <>Claim {usd(limit)} <Icon.ArrowRight size={16} /></> : <><Spinner /> Running checks…</>}
        </button>
      ) : (
        <Notice>{address ? "Only the portfolio owner can claim this line." : "Connect the owner's wallet to claim."}</Notice>
      )}
      <div className="fine">
        {hoursLeft !== null && <>Claim window: {duration(hoursLeft)} left. </>}
        Each lock opens exactly one line. <Link to={`/verify/${rec.id}`} className="link">Inspect the proof →</Link>
      </div>
      {(engineC.state === "fail" || verifyC.state === "fail" || fetchC.state === "fail") && (
        <button className="btn btn-ghost btn-sm" onClick={() => void runChecks()}><Icon.Refresh size={14} /> Run checks again</button>
      )}
      {error && <Notice tone="red">{error}</Notice>}
    </div>
  );
}

// ── Timeline ─────────────────────────────────────────────────────────────────

type TimelineItem = { key: string; side: "origin" | "attest" | "creditcoin"; text: React.ReactNode; ts?: number; tx?: string };

function describe(e: ProtocolEvent): React.ReactNode {
  switch (e.kind) {
    case "registered": return <>Registered in the vault</>;
    case "valued": return <>Valued at <strong>{usd(e.value)}</strong> · round {String(e.round)}</>;
    case "locked": return <>Locked as collateral at <strong>{usd(e.value)}</strong></>;
    case "unlocked": return <>Escrow released</>;
    case "opened": return <>Line of <strong>{usd(e.creditLimit)}</strong> opened against the proof</>;
    case "drawn": return <>Drew <strong>{usd(e.amount)}</strong></>;
    case "repaid": return <>Repaid <strong>{usd(e.amount)}</strong></>;
    case "closed": return <>Line repaid in full and closed</>;
    case "interest": return <>Paid <strong>{usdFine(e.amount)}</strong> interest</>;
    default: return null;
  }
}

function Timeline({ rec }: { rec: PortfolioRecord }) {
  const { attestation } = useProtocol();
  const items: TimelineItem[] = [];
  for (const e of rec.history) {
    items.push({ key: `${e.tx}:${e.logIndex}`, side: e.side, text: describe(e), ts: e.ts, tx: e.tx });
    if (e.kind === "locked" && attestation.attested !== null && attestation.attested >= e.block) {
      items.push({ key: `att:${e.tx}`, side: "attest", text: <>Block {e.block.toLocaleString()} attested</> });
    }
  }
  return (
    <div className="card side-card">
      <div className="card-title">Activity</div>
      <ol className="timeline">
        {[...items].reverse().map((i) => (
          <li key={i.key} className={`tl tl-${i.side}`}>
            <span className="tl-dot" />
            <div className="tl-body">
              <div className="tl-text">{i.text}</div>
              <div className="tl-meta">
                <ChainTag side={i.side} />
                {i.ts && <span title={dateTime(i.ts)}>{ago(i.ts)}</span>}
                {i.tx && i.side !== "attest" && <TxLink side={i.side} hash={i.tx}>tx</TxLink>}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

const STAGES = ["Registered", "Valued", "Locked", "Attested", "Funded"] as const;

/** How far along the five-stage lifecycle a phase is, and whether the current stage is live or stuck. */
function stageOf(phase: Phase): { at: number; state: "active" | "fail" | "done" } {
  switch (phase) {
    case "unregistered": return { at: 0, state: "active" };
    case "awaiting-valuation": return { at: 1, state: "active" };
    case "stale": return { at: 1, state: "fail" };
    case "offer": return { at: 2, state: "active" };
    case "in-transit": return { at: 3, state: "active" };
    case "ready": return { at: 4, state: "active" };
    case "expired": return { at: 4, state: "fail" };
    case "active":
    case "repaid": return { at: 5, state: "done" };
  }
}

function Lifecycle({ phase }: { phase: Phase }) {
  const { at, state } = stageOf(phase);
  return (
    <ol className="lifecycle">
      {STAGES.map((label, i) => {
        const s = i < at ? "done" : i === at ? state : "todo";
        return (
          <li key={label} className={`lc lc-${s}`}>
            <span className="lc-node">
              {s === "done" ? <Check size={12} /> : s === "fail" ? <Cross size={12} /> : s === "active" ? <i /> : <span className="num">{i + 1}</span>}
            </span>
            <span className="lc-label">{label === "Funded" && phase === "repaid" ? "Repaid" : label}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function PortfolioPage({ id }: { id: string }) {
  const { portfolios, attestation, params, sync, synced } = useProtocol();
  const { address } = useWallet();
  const roles = useRoles(address);
  const live = usePortfolioLive(id);
  const rec = portfolios[id];
  const info = useMemo(() => phaseOf(rec, attestation, params), [rec, attestation, params]);

  const refreshAll = useCallback(async () => {
    await Promise.all([live.refresh(), sync()]);
  }, [live, sync]);

  const owner = rec?.owner ?? live.portfolio?.owner;
  const isOwner = !!address && !!owner && owner.toLowerCase() === address.toLowerCase();
  const loading = !rec && (live.loading || !synced) && !live.portfolio;
  const notFound = !rec && live.portfolio && !live.portfolio.exists;

  if (loading) {
    return (
      <div className="page">
        <div className="page-head"><div><Skeleton w={260} h={34} /><div style={{ height: 10 }} /><Skeleton w={180} /></div></div>
        <div className="card pad"><Skeleton w="100%" h={36} /></div>
        <div className="detail">
          <div className="card pad"><Skeleton w={140} /><div style={{ height: 16 }} /><Skeleton w={280} h={56} /><div style={{ height: 16 }} /><Skeleton w="80%" /></div>
          <div className="card pad"><Skeleton w={120} /><div style={{ height: 16 }} /><Skeleton /><div style={{ height: 10 }} /><Skeleton /></div>
        </div>
      </div>
    );
  }

  if (notFound || !rec) {
    return (
      <div className="page">
        <div className="card">
          <Empty icon={<Icon.Search size={20} />} title={<>Nothing registered under #{id}.</>}>
            <p>
              {roles.originator
                ? "Register it from your dashboard to open its escrow slot."
                : "Portfolios are registered by approved originators. Check the ID, or browse live positions."}
            </p>
            <div className="row" style={{ justifyContent: "center" }}>
              <Link to="/app" className="btn btn-primary">Back to dashboard</Link>
              <Link to="/ledger" className="btn btn-ghost">Proof ledger</Link>
            </div>
          </Empty>
        </div>
      </div>
    );
  }

  const line = live.line?.open ? live.line : null;
  const claimed = rec.lines.length > 0 && info.phase !== "ready" && info.phase !== "in-transit";

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="row gap-sm">
            <h1 className="page-title num">Portfolio #{id}</h1>
            <PhaseChip phase={info.phase} />
          </div>
          <div className="owner-line">
            <Avatar address={owner!} size={16} />
            <AddressLink side="origin" address={owner!} />
            {isOwner && <span className="you">You</span>}
          </div>
        </div>
        {rec.lastLock && (
          <Link to={`/verify/${id}`} className="btn btn-secondary"><Icon.Shield size={15} /> Verify proof</Link>
        )}
      </div>

      <div className="card lifecycle-card"><Lifecycle phase={info.phase} /></div>

      <div className="detail">
        <div className="detail-main">
          {info.phase === "awaiting-valuation" && (
            <div className="card hero-card">
              <div className="eyebrow">Waiting on a valuer</div>
              <h2 className="h-card-lg">An independent valuation comes first</h2>
              <p className="muted">
                Bifrost never lets a borrower price their own collateral — otherwise the proof would
                faithfully certify whatever number you chose. An approved valuer publishes the value
                on Sepolia; your offer appears the moment they do.
              </p>
              {roles.valuer ? (
                <ValuationForm portfolioId={id} onDone={refreshAll} />
              ) : (
                <div className="row">
                  <Link to="/valuer" className="btn btn-secondary">Open the valuation desk</Link>
                  <span className="dim small">Share this with your valuer.</span>
                </div>
              )}
            </div>
          )}

          {(info.phase === "offer" || info.phase === "stale") && (
            <>
              <OfferHero rec={rec} info={info} isOwner={isOwner} onLocked={refreshAll} />
              {roles.valuer && (
                <div className="card pad">
                  <div className="card-title">Revalue</div>
                  <p className="muted small">You're an approved valuer. A new valuation replaces this one and restarts its freshness window.</p>
                  <ValuationForm portfolioId={id} current={rec.value} onDone={refreshAll} />
                </div>
              )}
            </>
          )}

          {info.phase === "in-transit" && rec.lastLock && (
            <div className="card hero-card glow-card glow-violet">
              <div className="eyebrow">Proof in transit</div>
              <h2 className="h-hero num">
                {info.eta !== null && info.eta > 0 ? <>~{duration(info.eta)} to go</> : <>Almost there</>}
              </h2>
              <p className="muted">
                Your collateral is locked on Sepolia. Attestcoin validators are working through the
                chain toward your block; once they sign it, Creditcoin can verify the lock and release{" "}
                <strong className="strong">{usd(creditFor(rec.lastLock.value, params))}</strong>. You can close this tab —
                everything lives on-chain.
              </p>
              <ProofJourney lock={rec.lastLock} info={info} claimed={false} />
            </div>
          )}

          {info.phase === "ready" && rec.lastLock && (
            <>
              <ClaimHero rec={rec} info={info} live={live} isOwner={isOwner} onClaimed={sync} />
              <div className="card pad">
                <ProofJourney lock={rec.lastLock} info={info} claimed={false} />
              </div>
            </>
          )}

          {info.phase === "expired" && rec.lastLock && (
            <div className="card hero-card">
              <div className="eyebrow eyebrow-red">Claim window closed</div>
              <h2 className="h-card-lg">This lock is too old to borrow against.</h2>
              <p className="muted">
                The pool only accepts a proof within {params?.maxLockAge.toLocaleString()} Sepolia blocks
                (about {params ? duration(params.maxLockAge * SEPOLIA_BLOCK_SECONDS) : "a day"}) of the
                attestation frontier — a valid proof of a stale position is still stale. This one is{" "}
                {Math.abs(info.claimBlocksLeft ?? 0).toLocaleString()} blocks past that. The vault admin
                releases the escrow, and the portfolio is revalued and locked again.
              </p>
            </div>
          )}

          {info.phase === "active" && line && (
            <CreditAccount line={line} portfolioId={id} onChange={refreshAll} />
          )}
          {info.phase === "active" && !line && (
            <div className="card pad"><Skeleton w={140} /><div style={{ height: 14 }} /><Skeleton w={260} h={52} /></div>
          )}

          {info.phase === "repaid" && (
            <div className="card hero-card">
              <div className="eyebrow">Closed</div>
              <h2 className="h-card-lg">Repaid in full.</h2>
              <p className="muted">
                The line is closed on Creditcoin.{" "}
                {rec.locked
                  ? "The portfolio stays escrowed on Sepolia until the vault admin releases it — settlement on Creditcoin isn't yet proven back to Sepolia."
                  : "The escrow has been released on Sepolia."}
              </p>
            </div>
          )}

          {claimed && rec.lastLock && info.phase === "active" && (
            <div className="card pad">
              <ProofJourney lock={rec.lastLock} info={info} claimed />
            </div>
          )}

          {live.error && <Notice tone="red" title="Couldn't read live state">{live.error}</Notice>}
        </div>

        <aside className="detail-side">
          <div className="card side-card">
            <div className="card-title">Collateral</div>
            <dl className="facts">
              <dt>Value</dt>
              <dd className="num">{rec.value > 0n ? usd(rec.value) : "Unvalued"}</dd>
              <dt>Valuation round</dt>
              <dd className="num">{rec.round > 0n ? String(rec.round) : "—"}</dd>
              <dt>Last valued</dt>
              <dd>{rec.valuedAt ? ago(rec.valuedAt) : "—"}</dd>
              <dt>Escrow</dt>
              <dd>{rec.locked ? <span className="ok-text"><Icon.Lock size={12} /> Locked</span> : "Not locked"}</dd>
              {rec.lastLock && (
                <>
                  <dt>Lock tx</dt>
                  <dd><TxLink side="origin" hash={rec.lastLock.tx} /></dd>
                </>
              )}
              {rec.activeLine && (
                <>
                  <dt>Receipt ID</dt>
                  <dd className="mono small" title={rec.activeLine.receiptId}>{rec.activeLine.receiptId.slice(0, 12)}…</dd>
                </>
              )}
            </dl>
          </div>
          <Timeline rec={rec} />
        </aside>
      </div>
    </div>
  );
}
