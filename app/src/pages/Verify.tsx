import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits, type Hex } from "viem";
import { ENGINE_ABI } from "../lib/abis";
import { creditcoinClient } from "../lib/clients";
import { BLOCK_PROVER_PRECOMPILE, config } from "../lib/config";
import { ago, shortAddress, usd } from "../lib/format";
import type { LockedEvent } from "../lib/indexer";
import { decodeAttestedTx, forgeValue, verifyOnCreditcoin, type DecodedReceipt, type VerifyResult } from "../lib/proof";
import { fetchProof, ProverError, type AttestcoinProof } from "../lib/prover";
import { useProtocol } from "../lib/protocol";
import { Link } from "../lib/router";
import { AddressLink, ChainTag, Check, Cross, Notice, Spinner, TxLink } from "../components/ui";

type Status = "idle" | "run" | "ok" | "fail" | "wait";

function Step({
  n, status, title, side, children,
}: { n: number; status: Status; title: string; side: "origin" | "attest" | "creditcoin"; children?: React.ReactNode }) {
  return (
    <div className={`vstep is-${status}`}>
      <div className="vstep-rail">
        <span className="vstep-icon">
          {status === "ok" ? <Check /> : status === "fail" ? <Cross /> : status === "run" || status === "wait" ? <Spinner /> : n}
        </span>
      </div>
      <div className="vstep-body">
        <div className="vstep-head">
          <span className="vstep-title">{title}</span>
          <ChainTag side={side} />
        </div>
        {children && <div className="vstep-content">{children}</div>}
      </div>
    </div>
  );
}

function Field({ k, v, good }: { k: string; v: React.ReactNode; good?: boolean }) {
  return (
    <div className="kv-row">
      <span className="kv-k">{k}</span>
      <span className="kv-v">{v}{good && <span className="kv-good"><Check size={12} /></span>}</span>
    </div>
  );
}

function Forge({ proof, lock }: { proof: AttestcoinProof; lock: LockedEvent }) {
  const [value, setValue] = useState(formatUnits(lock.value * 10n, config.decimals));
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    let v: bigint;
    try {
      v = parseUnits(value.replace(/[,$\s]/g, ""), config.decimals);
    } catch {
      return;
    }
    setBusy(true);
    setResult(null);
    const forged = forgeValue(proof.encodedTx, v);
    setResult(await verifyOnCreditcoin(proof, forged as Hex));
    setBusy(false);
  };

  return (
    <div className="forge">
      <div className="forge-copy">
        <div className="eyebrow eyebrow-dark">Now try to lie</div>
        <h3 className="h3 h3-dark">Claim this portfolio is worth more.</h3>
        <p className="dark-copy small">
          Your browser rewrites the dollar value inside the attested receipt — every other byte
          untouched — and sends it to the same precompile with the same proof. No admin key,
          oracle or Bifrost server can make this pass.
        </p>
      </div>
      <div className="forge-controls">
        <label className="field money-field dark">
          <span className="field-prefix">$</span>
          <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" aria-label="Forged value" />
        </label>
        <button className="btn btn-light" onClick={submit} disabled={busy}>
          {busy ? <><Spinner /> Asking Creditcoin…</> : "Submit forged receipt"}
        </button>
        {result && (
          <div className={`forge-result ${result.ok ? "ok" : "bad"}`}>
            {result.ok ? (
              <><Check /> Accepted — the value you entered matches the genuine one.</>
            ) : (
              <>
                <Cross />
                <div>
                  <strong>Rejected by Creditcoin</strong> in {Math.round(result.ms)} ms
                  <div className="mono small">{result.reason}</div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Anyone can re-derive why a line exists, in their own browser, against live chains.
 *
 * This page is the product's answer to "why should an institution trust this?" — it
 * doesn't ask them to. Every step is a call the reader's browser makes itself.
 */
export function Verify({ id }: { id: string }) {
  const { portfolios, attestation, synced } = useProtocol();
  const rec = portfolios[id];
  const line = rec?.activeLine ?? rec?.lines[rec.lines.length - 1];
  const lock = line?.lock ?? rec?.lastLock;

  const [proofS, setProofS] = useState<{ status: Status; proof?: AttestcoinProof; ms?: number; err?: string }>({ status: "idle" });
  const [decoded, setDecoded] = useState<DecodedReceipt | null>(null);
  const [verifyS, setVerifyS] = useState<{ status: Status; r?: VerifyResult }>({ status: "idle" });
  const [spent, setSpent] = useState<boolean | null>(null);

  // Keyed on the hash, not the object: the index re-derives every poll, and re-running the
  // whole verification each time would wipe a result the reader is looking at.
  const lockTx = lock?.tx;
  const run = useCallback(async () => {
    if (!lockTx) return;
    setDecoded(null);
    setVerifyS({ status: "idle" });
    setSpent(null);
    setProofS({ status: "run" });
    const t0 = performance.now();
    let proof: AttestcoinProof;
    try {
      proof = await fetchProof(lockTx);
    } catch (e) {
      setProofS({
        status: e instanceof ProverError && e.transient ? "wait" : "fail",
        err: (e as Error).message,
      });
      return;
    }
    setProofS({ status: "ok", proof, ms: performance.now() - t0 });
    const d = decodeAttestedTx(proof.encodedTx);
    setDecoded(d);
    setVerifyS({ status: "run" });
    const r = await verifyOnCreditcoin(proof);
    setVerifyS({ status: r.ok ? "ok" : "fail", r });
    creditcoinClient
      .readContract({ address: config.poolEngine, abi: ENGINE_ABI, functionName: "usedReceipt", args: [d.receiptId] })
      .then((u) => setSpent(u as boolean))
      .catch(() => setSpent(null));
  }, [lockTx]);

  useEffect(() => {
    void run();
  }, [run]);

  const notYet = lock && attestation.attested !== null && attestation.attested < lock.block;
  const lockMatches = useMemo(() => {
    if (!decoded?.lock || !lock) return null;
    return (
      decoded.lock.portfolioId === BigInt(id) &&
      decoded.lock.dollarValue === lock.value &&
      decoded.lock.owner.toLowerCase() === lock.owner.toLowerCase()
    );
  }, [decoded, lock, id]);

  if (!rec || !lock) {
    return (
      <div className="shell page">
        <Link to="/ledger" className="crumb">← Proof ledger</Link>
        <div className="gate card">
          {!synced ? (
            <div className="loading"><Spinner /> Reading both chains…</div>
          ) : (
            <>
              <h1 className="h1">No lock to verify for #{id}.</h1>
              <p className="muted">A proof exists only once a portfolio has been locked on Sepolia.</p>
            </>
          )}
        </div>
      </div>
    );
  }

  const proof = proofS.proof;
  const receiptMatches = line && decoded ? line.receiptId.toLowerCase() === decoded.receiptId.toLowerCase() : null;

  return (
    <div className="shell page narrow">
      <Link to="/ledger" className="crumb">← Proof ledger</Link>
      <div className="verify-head">
        <div className="eyebrow">Independent verification</div>
        <h1 className="h1">Verify portfolio #{id} yourself.</h1>
        <p className="lede-sm">
          This page doesn't trust Bifrost. Your browser fetches the Attestcoin proof for the Sepolia
          lock, decodes it, and asks Creditcoin's BlockProver precompile whether it holds — the same
          check the pool ran before lending a dollar.
        </p>
        <button className="btn btn-secondary btn-sm" onClick={() => void run()} disabled={proofS.status === "run" || verifyS.status === "run"}>
          Run again
        </button>
      </div>

      <div className="vsteps card">
        <Step n={1} status="ok" title="Collateral locked on the origin chain" side="origin">
          <Field k="Transaction" v={<TxLink side="origin" hash={lock.tx} />} />
          <Field k="Block" v={<span className="num">{lock.block.toLocaleString()}{lock.ts && <span className="dim"> · {ago(lock.ts)}</span>}</span>} />
          <Field k="Vault" v={<AddressLink side="origin" address={config.originVault} />} />
        </Step>

        <Step
          n={2}
          status={notYet ? "wait" : proofS.status}
          title={notYet ? "Waiting for Attestcoin to attest this block" : "Proof fetched from the Attestcoin prover"}
          side="attest"
        >
          {notYet ? (
            <div className="muted small">
              Attested to #{attestation.attested?.toLocaleString()} — {(lock.block - attestation.attested!).toLocaleString()} blocks to go.
              The proof exists once validators sign the block.
            </div>
          ) : proofS.status === "wait" ? (
            <div className="muted small">The prover hasn't materialized this proof yet. Try again in a moment.</div>
          ) : proofS.status === "fail" ? (
            <div className="err small">{proofS.err}</div>
          ) : proof ? (
            <>
              <Field k="Attested height" v={<span className="num">{proof.height.toLocaleString()}</span>} />
              <Field k="Transaction index" v={<span className="num">{proof.txIndex}</span>} />
              <Field k="Merkle path" v={<span className="num">{proof.merkleProof.siblings.length} siblings to root <span className="mono dim">{proof.merkleProof.root.slice(0, 12)}…</span></span>} />
              <Field k="Continuity proof" v={<span className="num">{proof.continuityProof.roots.length} block roots chained to the attested checkpoint</span>} />
              <Field k="Fetched in" v={<span className="num">{Math.round(proofS.ms!)} ms</span>} />
            </>
          ) : null}
        </Step>

        <Step n={3} status={decoded ? (decoded.status === 1 && decoded.lock ? "ok" : "fail") : "idle"} title="Receipt decoded in your browser" side="attest">
          {decoded && (
            <>
              <Field k="Payload" v={<span className="num">type {decoded.txType} · {decoded.chunks} chunks · receipt is the last</span>} />
              <Field k="Source tx status" v={decoded.status === 1 ? "Succeeded" : "Reverted"} good={decoded.status === 1} />
              <Field k="Emitter" v={decoded.lock ? <>Bifrost vault <span className="mono dim">{shortAddress(config.originVault)}</span></> : "No lock event from the vault"} good={!!decoded.lock} />
              {decoded.lock && (
                <>
                  <Field k="Event" v={<span className="mono">PortfolioLocked</span>} />
                  <Field k="Owner" v={<span className="mono">{shortAddress(decoded.lock.owner)}</span>} good={lockMatches ?? undefined} />
                  <Field k="Portfolio" v={<span className="num">#{decoded.lock.portfolioId.toString()}</span>} good={decoded.lock.portfolioId === BigInt(id)} />
                  <Field k="Attested value" v={<strong className="num">{usd(decoded.lock.dollarValue)}</strong>} good={decoded.lock.dollarValue === lock.value} />
                  <Field k="Valuation round" v={<span className="num">{decoded.lock.valuationRound.toString()}</span>} />
                </>
              )}
            </>
          )}
        </Step>

        <Step
          n={4}
          status={verifyS.status}
          title="Checked by Creditcoin's BlockProver precompile"
          side="creditcoin"
        >
          {verifyS.r && (
            <>
              <Field k="Call" v={<span className="mono">{shortAddress(BLOCK_PROVER_PRECOMPILE)}.verify(chainKey={config.chainKey}, height, payload, merkle, continuity)</span>} />
              <Field
                k="Result"
                v={verifyS.r.ok ? <strong>true</strong> : <span className="err">{verifyS.r.reason}</span>}
                good={verifyS.r.ok}
              />
              <Field k="Answered in" v={<span className="num">{Math.round(verifyS.r.ms)} ms</span>} />
            </>
          )}
        </Step>

        <Step
          n={5}
          status={!decoded ? "idle" : line ? (receiptMatches ? "ok" : "fail") : spent === false ? "ok" : spent ? "fail" : "run"}
          title={line ? "Bound to the credit line it opened" : "Unspent — can open exactly one line"}
          side="creditcoin"
        >
          {decoded && (
            <>
              <Field k="keccak256(payload)" v={<span className="mono small">{decoded.receiptId.slice(0, 18)}…{decoded.receiptId.slice(-6)}</span>} />
              {line ? (
                <>
                  <Field k="Line receiptId" v={<span className="mono small">{line.receiptId.slice(0, 18)}…{line.receiptId.slice(-6)}</span>} good={receiptMatches ?? undefined} />
                  <Field k="Line" v={<>{usd(line.creditLimit)} opened · <TxLink side="creditcoin" hash={line.opened.tx} /></>} />
                  <Field k="Reusable?" v={spent ? "No — receipt marked used on-chain" : "…"} good={spent ?? undefined} />
                </>
              ) : (
                <Field k="usedReceipt" v={spent === null ? "…" : spent ? "true" : "false — ready to be claimed once"} />
              )}
            </>
          )}
        </Step>
      </div>

      {proof && verifyS.status === "ok" && <Forge proof={proof} lock={lock} />}

      {proof && (
        <details className="raw card">
          <summary>Raw proof data</summary>
          <div className="raw-body">
            <div className="raw-label">Merkle siblings (leaf → root)</div>
            <ol className="raw-list mono small">
              {proof.merkleProof.siblings.map((s, i) => (
                <li key={i}><span className="dim">{s.isLeft ? "L" : "R"}</span> {s.hash}</li>
              ))}
            </ol>
            <div className="raw-label">Continuity</div>
            <div className="mono small">lowerEndpointDigest {proof.continuityProof.lowerEndpointDigest}</div>
            <div className="mono small dim">{proof.continuityProof.roots.length} roots · first {proof.continuityProof.roots[0]?.slice(0, 18)}… · last {proof.continuityProof.roots[proof.continuityProof.roots.length - 1]?.slice(0, 18)}…</div>
            <div className="raw-label">Encoded payload ({(proof.encodedTx.length - 2) / 2} bytes)</div>
            <div className="raw-hex mono small">{proof.encodedTx}</div>
          </div>
        </details>
      )}

      {verifyS.status === "fail" && (
        <Notice tone="red" title="The precompile rejected this proof">
          {verifyS.r?.reason} — if the lock is very recent, the prover may be ahead of the attestation. Run again in a minute.
        </Notice>
      )}
    </div>
  );
}
