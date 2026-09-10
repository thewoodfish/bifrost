import type { Hex } from "viem";
import { config } from "./config";

export interface AttestcoinProof {
  chainKey: number;
  height: number;
  txIndex: number;
  encodedTx: Hex;
  merkleProof: { root: Hex; siblings: { hash: Hex; isLeft: boolean }[] };
  continuityProof: { lowerEndpointDigest: Hex; roots: Hex[] };
}

/**
 * True for prover errors meaning "not yet" rather than "never".
 *
 * The one that matters is 422 straight after attestation lands: the height reads as
 * attested on-chain while the prover has yet to materialise the proof. Mirrors the same
 * classification in sdk/src/attest.ts, which was derived from a real failure.
 */
export function isTransientProverError(message: string): boolean {
  return (
    /\b(422|404|429|5\d\d)\b/.test(message) ||
    /timeout|failed to fetch|networkerror|load failed/i.test(message)
  );
}

export class ProverError extends Error {
  constructor(message: string, readonly transient: boolean) {
    super(message);
    this.name = "ProverError";
  }
}

/**
 * Fetch the Merkle + continuity proof for a source transaction.
 *
 * The prover serves CORS `*`, so the browser calls it directly — there is no backend in
 * this application, which is also why there is nothing to keep running for a deployment.
 *
 * `encodedTx` is the attested payload: abi.encode(uint8 txType, bytes[] chunks) with the
 * receipt as the final chunk. It passes through untouched; the engine decodes the lock
 * event out of it on-chain.
 */
export async function fetchProof(txHash: string): Promise<AttestcoinProof> {
  const url = `${config.proverUrl}/api/v1/proof-by-tx/${config.chainKey}/${txHash}`;

  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    // A network-level failure is always worth retrying.
    throw new ProverError(`Could not reach the prover: ${(e as Error).message}`, true);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const msg = `Prover returned ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`;
    throw new ProverError(msg, isTransientProverError(String(res.status)));
  }

  const d = (await res.json()) as {
    chainKey: number;
    headerNumber: number;
    txIndex: number;
    txBytes: Hex;
    merkleProof: { root: Hex; siblings: { hash: Hex; isLeft: boolean }[] };
    continuityProof: { lowerEndpointDigest: Hex; roots: Hex[] };
  };

  return {
    chainKey: d.chainKey,
    height: d.headerNumber,
    txIndex: d.txIndex,
    encodedTx: d.txBytes,
    merkleProof: {
      root: d.merkleProof.root,
      siblings: d.merkleProof.siblings.map((s) => ({ hash: s.hash, isLeft: s.isLeft })),
    },
    continuityProof: {
      lowerEndpointDigest: d.continuityProof.lowerEndpointDigest,
      roots: d.continuityProof.roots,
    },
  };
}

/**
 * Translate `previewIngest`'s reason strings into something a credit officer can act on.
 *
 * These are the documented failure modes from the deployment runbook. Passing the raw
 * string through would be honest but useless; every one of them has a specific cause.
 */
export function explainReason(reason: string): { title: string; detail: string } {
  const r = reason.toLowerCase();
  if (r.includes("precompile rejected")) {
    return {
      title: "Attestcoin rejected the proof",
      detail:
        "The proof is malformed, or the source height is not attested yet. If the lock is recent, waiting is the fix.",
    };
  }
  if (r.includes("lock log not found")) {
    return {
      title: "No lock event in that receipt",
      detail:
        "The transaction carries no PortfolioLocked event from the configured vault. Either the wrong transaction, or the portal points at a different vault deployment.",
    };
  }
  if (r.includes("value mismatch")) {
    return {
      title: "Claimed value disagrees with the proof",
      detail:
        "The engine compared the claim against the value proven by the receipt and they differ. This is the value-binding guard doing its job.",
    };
  }
  if (r.includes("receipt already used")) {
    return {
      title: "That receipt has already been used",
      detail: "Each lock receipt can open exactly one credit line. Lock again to borrow more.",
    };
  }
  if (r.includes("line already open")) {
    return {
      title: "This portfolio already has an open line",
      detail: "Repay and close the existing line before opening another against the same portfolio.",
    };
  }
  return { title: "Proof rejected", detail: reason };
}
