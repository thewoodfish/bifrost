import { useCallback, useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import {
  lockPortfolio, previewOpen, registerPortfolio, setValuation,
  stablecoinBalance, submitOpen, type PreviewResult,
} from "../lib/actions";
import { creditcoin, explorerTx, origin } from "../lib/chains";
import { config } from "../lib/config";
import { duration, shortHash, usd } from "../lib/format";
import { explainReason, ProverError } from "../lib/prover";
import { watch } from "../lib/store";
import { etaFor, type AttestationStatus } from "../lib/useAttestation";
import type { PortfolioState } from "../lib/usePortfolio";
import { useRoles } from "../lib/usePortfolio";
import { useWallet } from "../lib/wallet";
import { CreditControls } from "./CreditControls";
import { AttestcoinTag, CreditcoinTag, OriginTag, Step, type StepState } from "./Step";

function TxLink({ chainId, hash }: { chainId: number; hash: string }) {
  return (
    <a className="mono" href={explorerTx(chainId, hash)} target="_blank" rel="noreferrer">
      {shortHash(hash)}
    </a>
  );
}

export function PortfolioView({
  portfolioId, state, status,
}: {
  portfolioId: string;
  state: PortfolioState;
  status: AttestationStatus;
}) {
  const { address, chainId, clientFor, switchTo } = useWallet();
  const roles = useRoles(address);
  const { portfolio, line, stage, lockTx, lockBlock, lockedAt } = state;

  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [valuation, setValuationInput] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewNote, setPreviewNote] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [openTx, setOpenTx] = useState<string | null>(null);

  const id = BigInt(portfolioId);
  const isOwner = !!address && !!portfolio?.exists &&
    portfolio.owner.toLowerCase() === address.toLowerCase();

  useEffect(() => {
    setPreview(null);
    setPreviewNote(null);
    setOpenTx(null);
    setErr(null);
  }, [portfolioId]);

  useEffect(() => {
    if (!address) return setBalance(null);
    stablecoinBalance(address).then(setBalance).catch(() => setBalance(null));
  }, [address, line?.drawn]);

  const run = useCallback(
    async (label: string, chain: number, fn: (w: ReturnType<typeof clientFor>, a: Address) => Promise<unknown>) => {
      if (!address) return;
      setBusy(label);
      setErr(null);
      try {
        if (chainId !== chain) await switchTo(chain);
        await fn(clientFor(chain), address);
        await state.refresh();
      } catch (e) {
        const m = (e as Error).message ?? String(e);
        setErr(/user rejected|denied/i.test(m) ? "Transaction rejected in wallet." : m);
      } finally {
        setBusy(null);
      }
    },
    [address, chainId, clientFor, switchTo, state],
  );

  // ── Attestation ──────────────────────────────────────────────────────────
  const attested = status.attested;
  const heightReady = lockBlock !== undefined && attested !== null && attested >= lockBlock;
  const remaining = lockBlock !== undefined && attested !== null ? lockBlock - attested : null;
  const eta = lockBlock !== undefined ? etaFor(lockBlock, status) : null;

  const progress = useMemo(() => {
    if (lockBlock === undefined || attested === null) return 0;
    if (attested >= lockBlock) return 1;
    // Baseline is where attestation stood when the lock landed. Estimate it from the
    // measured lag when we have no recorded baseline (a lock recovered from its event).
    const baseline = lockBlock - Math.max(status.behind ?? 1, 1);
    const span = lockBlock - baseline;
    return span > 0 ? Math.min(Math.max((attested - baseline) / span, 0), 0.99) : 0;
  }, [lockBlock, attested, status.behind]);

  const doPreview = useCallback(async () => {
    if (!lockTx || !portfolio) return;
    setBusy("preview");
    setErr(null);
    setPreviewNote(null);
    try {
      const p = await previewOpen(
        id, lockTx, portfolio.owner, portfolio.dollarValue, portfolio.valuationRound,
      );
      setPreview(p);
      if (!p.ok) {
        const x = explainReason(p.reason);
        setPreviewNote(`${x.title} — ${x.detail}`);
      }
    } catch (e) {
      if (e instanceof ProverError && e.transient) {
        setPreviewNote(
          "The prover does not have this proof yet. The height is attested, so it should " +
          "appear shortly — try again in a moment.",
        );
      } else {
        setErr((e as Error).message);
      }
    } finally {
      setBusy(null);
    }
  }, [id, lockTx, portfolio]);

  // ── Step states ──────────────────────────────────────────────────────────
  const s = {
    register: portfolio?.exists ? "done" : "active",
    value: !portfolio?.exists ? "idle" : portfolio.dollarValue > 0n ? "done" : "active",
    lock: portfolio?.isLocked ? "done" : portfolio?.dollarValue ? "active" : "idle",
    attest: !portfolio?.isLocked ? "idle" : heightReady || line?.open ? "done" : "active",
    // A repaid line is finished, not in progress: "closed" is a done state, not an active one.
    credit: line?.open || stage === "closed" ? "done" : heightReady ? "active" : "idle",
  } as Record<string, StepState>;

  return (
    <div className="stack">
      <div className="between">
        <div>
          <div className="section-label">Portfolio</div>
          <h1 className="num" style={{ margin: "2px 0 0", fontSize: 26, letterSpacing: "-0.02em" }}>
            #{portfolioId}
          </h1>
        </div>
        <button className="ghost" onClick={() => void state.refresh()} disabled={state.loading}>
          {state.loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {state.error && (
        <div className="notice error">
          <div className="notice-title">Could not read chain state</div>
          <span className="small">{state.error}</span>
        </div>
      )}

      {/* Position summary — the numbers a credit officer actually watches. */}
      <div className="card">
        <div className="figures">
          <div className="figure">
            <div className="figure-label">Attested value</div>
            <div className="figure-value num">
              {usd(line?.open ? line.attestedValue : portfolio?.dollarValue)}
            </div>
            <div className="figure-note">
              {portfolio?.valuationRound !== undefined ? `Round ${portfolio.valuationRound}` : "Unvalued"}
            </div>
          </div>
          <div className="figure">
            <div className="figure-label">Credit limit</div>
            <div className="figure-value num">{line?.creditLimit ? usd(line.creditLimit) : "—"}</div>
            <div className="figure-note">80% LTV cap</div>
          </div>
          <div className="figure">
            <div className="figure-label">Drawn</div>
            <div className="figure-value num">{line ? usd(line.drawn) : "—"}</div>
            <div className="figure-note">
              {line?.open ? `${usd(line.creditLimit - line.drawn)} available` : "No open line"}
            </div>
          </div>
          <div className="figure">
            <div className="figure-label">Status</div>
            <div className="figure-value" style={{ fontSize: 17, textTransform: "capitalize" }}>
              {stage}
            </div>
            <div className="figure-note">
              {lockedAt ? `Locked ${duration((Date.now() - lockedAt) / 1000)} ago` : " "}
            </div>
          </div>
        </div>
      </div>

      {err && (
        <div className="notice error">
          <div className="notice-title">Something went wrong</div>
          <span className="small">{err}</span>
        </div>
      )}

      {/* Lifecycle */}
      <div className="card">
        <div className="card-head">
          <span className="card-title">Cross-chain lifecycle</span>
          <span className="dim small">
            The portfolio never leaves Sepolia. Only a proof about it travels.
          </span>
        </div>
        <div className="card-body">
          <div className="pipeline">
            <Step
              index={1} state={s.register} title="Portfolio registered" tag={<OriginTag />}
              detail={
                portfolio?.exists
                  ? `Owned by ${portfolio.owner}`
                  : "Register the tokenised loan portfolio in the origin vault."
              }
            >
              {!portfolio?.exists && (
                <>
                  <button
                    className="primary"
                    disabled={!address || !roles.originator || busy !== null}
                    onClick={() => run("register", origin.id, (w, a) => registerPortfolio(w, a, id))}
                  >
                    {busy === "register" ? "Registering…" : "Register portfolio"}
                  </button>
                  {address && roles.loaded && !roles.originator && (
                    <div className="notice warn" style={{ marginTop: 10 }}>
                      This wallet is not an approved originator. The vault admin grants the role
                      with <span className="mono">setOriginator</span>.
                    </div>
                  )}
                </>
              )}
            </Step>

            <Step
              index={2} state={s.value} title="Independent valuation" tag={<OriginTag />}
              detail={
                portfolio?.dollarValue
                  ? `${usd(portfolio.dollarValue)} published by a valuer, round ${portfolio.valuationRound}`
                  : "A valuer — never the borrower — publishes the portfolio's value."
              }
            >
              {portfolio?.exists && !portfolio.isLocked && (
                <div className="stack">
                  <div className="field-row">
                    <input
                      value={valuation}
                      onChange={(e) => setValuationInput(e.target.value)}
                      placeholder="Valuation in USD"
                      inputMode="decimal"
                      aria-label="Valuation in USD"
                    />
                    <button
                      className="primary"
                      disabled={!address || !roles.valuer || !valuation.trim() || busy !== null}
                      onClick={() =>
                        run("value", origin.id, (w, a) => setValuation(w, a, id, valuation))
                      }
                    >
                      {busy === "value" ? "Publishing…" : "Publish valuation"}
                    </button>
                  </div>
                  {address && roles.loaded && !roles.valuer && (
                    <div className="notice warn">
                      <div className="notice-title">This wallet cannot price this collateral</div>
                      <span className="small">
                        {isOwner
                          ? "You own this portfolio, so you are not permitted to value it. That separation is what makes the attestation worth anything — otherwise the proof would faithfully certify a number you chose yourself. Connect the valuer key to continue."
                          : "This wallet is not an approved valuer. The vault admin grants the role with setValuer."}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </Step>

            <Step
              index={3} state={s.lock} title="Portfolio escrowed" tag={<OriginTag />}
              detail={
                portfolio?.isLocked ? (
                  lockTx ? (
                    <>Locked in block {lockBlock?.toLocaleString()} · <TxLink chainId={origin.id} hash={lockTx} /></>
                  ) : (
                    "Locked on chain. Searching for the lock transaction…"
                  )
                ) : (
                  "Locking freezes the valuation and emits the event Attestcoin proves."
                )
              }
            >
              {portfolio?.exists && !portfolio.isLocked && portfolio.dollarValue > 0n && (
                <>
                  <button
                    className="primary"
                    disabled={!address || !isOwner || busy !== null}
                    onClick={() =>
                      run("lock", origin.id, async (w, a) => {
                        const r = await lockPortfolio(w, a, id);
                        watch(portfolioId, { attestedAtLock: status.attested ?? undefined });
                        return r;
                      })
                    }
                  >
                    {busy === "lock" ? "Locking…" : "Lock portfolio"}
                  </button>
                  {address && !isOwner && (
                    <div className="notice warn" style={{ marginTop: 10 }}>
                      Only the portfolio owner can lock it.
                    </div>
                  )}
                </>
              )}
            </Step>

            <Step
              index={4} state={s.attest} title="Proof attested" tag={<AttestcoinTag />}
              detail={
                !portfolio?.isLocked ? (
                  "Attestcoin validators attest the source block containing the lock."
                ) : heightReady || line?.open ? (
                  <>Block {lockBlock?.toLocaleString()} is attested on Creditcoin.</>
                ) : (
                  <>
                    Waiting for Attestcoin to reach block {lockBlock?.toLocaleString()}. This runs
                    8–20 minutes behind the source chain and is not tunable.
                  </>
                )
              }
            >
              {portfolio?.isLocked && !heightReady && !line?.open && lockBlock !== undefined && (
                <div>
                  <div className="attest-bar">
                    <div className="attest-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
                  </div>
                  <div className="between small">
                    <span className="num muted">
                      {attested !== null ? `attested #${attested.toLocaleString()}` : "reading…"}
                      {remaining !== null && remaining > 0 && ` · ${remaining.toLocaleString()} blocks to go`}
                    </span>
                    <span className="dim num">
                      {eta !== null ? `~${duration(eta)} remaining` : "measuring rate…"}
                    </span>
                  </div>
                  <div className="dim small" style={{ marginTop: 8 }}>
                    Measured live from the ChainInfo precompile. Safe to close this tab — the
                    position is recovered from chain on return.
                  </div>
                </div>
              )}
            </Step>

            <Step
              index={5} state={s.credit} title="Credit line" tag={<CreditcoinTag />}
              detail={
                line?.open ? (
                  <>{usd(line.creditLimit)} open against {usd(line.attestedValue)} attested</>
                ) : stage === "closed" ? (
                  "This line was opened and fully repaid."
                ) : (
                  "Creditcoin verifies the proof on-chain and releases the line at up to 80% LTV."
                )
              }
            >
              {heightReady && !line?.open && stage !== "closed" && lockTx && (
                <div className="stack">
                  {!preview?.ok && (
                    <div className="row">
                      <button className="ghost" onClick={doPreview} disabled={busy !== null}>
                        {busy === "preview" ? "Checking proof…" : "Verify proof"}
                      </button>
                      <span className="dim small">
                        Dry-runs the proof against the engine for free before any gas is spent.
                      </span>
                    </div>
                  )}

                  {previewNote && <div className="notice warn small">{previewNote}</div>}

                  {preview?.ok && (
                    <>
                      <div className="notice ok">
                        <div className="notice-title">Proof verified against the engine</div>
                        <span className="small">
                          Source height {preview.proof.height.toLocaleString()}, transaction index{" "}
                          {preview.proof.txIndex}, {preview.proof.merkleProof.siblings.length} Merkle
                          siblings, {preview.proof.continuityProof.roots.length} continuity roots.
                        </span>
                      </div>
                      <div className="row">
                        <button
                          className="warm"
                          disabled={busy !== null}
                          onClick={() =>
                            run("open", creditcoin.id, async (w, a) => {
                              const h = await submitOpen(w, a, preview);
                              setOpenTx(h);
                              return h;
                            })
                          }
                        >
                          {busy === "open" ? "Opening line…" : "Open credit line"}
                        </button>
                        <span className="dim small">
                          Consumes this receipt permanently — one line per lock.
                        </span>
                      </div>
                    </>
                  )}

                  {openTx && (
                    <div className="notice ok small">
                      Line opened · <TxLink chainId={creditcoin.id} hash={openTx} />
                    </div>
                  )}
                </div>
              )}

              {line?.open && (
                <CreditControls
                  line={line}
                  portfolioId={id}
                  balance={balance}
                  onDone={() => void state.refresh()}
                />
              )}
            </Step>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <span className="card-title">Contracts</span>
        </div>
        <div className="card-body">
          <dl className="kv small">
            <dt>Origin vault</dt>
            <dd className="mono">
              <a href={`https://sepolia.etherscan.io/address/${config.originVault}`} target="_blank" rel="noreferrer">
                {config.originVault}
              </a>{" "}
              <span className="dim">Sepolia</span>
            </dd>
            <dt>Pool engine</dt>
            <dd className="mono">
              <a href={`${creditcoin.blockExplorers.default.url}/address/${config.poolEngine}`} target="_blank" rel="noreferrer">
                {config.poolEngine}
              </a>{" "}
              <span className="dim">Creditcoin CC3</span>
            </dd>
            <dt>Settlement asset</dt>
            <dd className="mono">
              {config.stablecoin} <span className="dim">TestUSDC</span>
            </dd>
            <dt>Wallet balance</dt>
            <dd className="num">{balance === null ? "—" : usd(balance)}</dd>
          </dl>
        </div>
      </div>
    </div>
  );
}
