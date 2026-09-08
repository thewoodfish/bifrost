import { proofProvider } from "@gluwa/usc-sdk";
import { config } from "./config.js";
import { chainInfo, creditcoin } from "./chain.js";

/** Proof arguments in the exact shape CreditcoinPoolEngine expects. */
export interface AttestcoinProof {
  chainKey: number;
  height: number;
  encodedTx: string;
  merkleProof: { root: string; siblings: { hash: string; isLeft: boolean }[] };
  continuityProof: { lowerEndpointDigest: string; roots: string[] };
}

export type Stage =
  | { phase: "waiting_attestation"; height: number; attested: number; behind: number }
  | { phase: "attested"; height: number }
  | { phase: "building_proof"; height: number }
  | { phase: "proof_retry"; attempt: number; waited: number; reason: string }
  | { phase: "proof_ready"; height: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Block until the source height is attested on Creditcoin.
 *
 * Attestation runs 8-20 minutes behind the source chain head; this is a property of
 * the protocol, not a tunable. Polls `is_height_attested` on the ChainInfo precompile,
 * which is the authoritative on-chain answer.
 */
export async function waitUntilAttested(height: number, onStage?: (s: Stage) => void): Promise<void> {
  const info = chainInfo(creditcoin());
  const deadline = Date.now() + config.attestTimeoutMs;

  for (;;) {
    if (await info.is_height_attested(config.chainKey, height)) {
      onStage?.({ phase: "attested", height });
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Height ${height} was not attested within ${Math.round(config.attestTimeoutMs / 60000)} min. ` +
          `It may simply be slow — re-run rather than assuming failure.`,
      );
    }
    const latest = await info.get_latest_attestation_height_and_hash(config.chainKey);
    const attested = Number(latest[0]);
    onStage?.({ phase: "waiting_attestation", height, attested, behind: height - attested });
    await sleep(config.attestPollMs);
  }
}

/**
 * True for prover errors that mean "not yet", as opposed to "never".
 *
 * The one that matters is 422 immediately after attestation lands: `is_height_attested`
 * is already true on-chain while the prover has yet to materialise the proof. 404 behaves
 * the same way for a very fresh transaction, and 429/5xx/network errors are transient by
 * definition. Anything else — a malformed hash, a wrong chainKey — fails fast, because
 * retrying it just burns the window.
 */
function isTransientProofError(message: string): boolean {
  return /\b(422|404|429|5\d\d)\b/.test(message) || /timeout|ECONN|ENOTFOUND|EAI_AGAIN|socket hang up|network/i.test(message);
}

/**
 * Fetch the Merkle + continuity proof for a source transaction.
 *
 * `txBytes` is the attested payload: abi.encode(uint8 txType, bytes[] chunks), with the
 * receipt as the final chunk. It is passed straight through to the engine, which decodes
 * the lock event out of it — see src/lib/AttestedTx.sol.
 *
 * Retries transient prover failures. Reaching this function means the 8-20 min
 * attestation wait already completed, so surrendering to a 422 that clears in seconds
 * costs the caller the whole wait over again.
 */
export async function buildProof(txHash: string, onStage?: (s: Stage) => void): Promise<AttestcoinProof> {
  const builder = new proofProvider.service.ProofBuilder(config.chainKey, config.proverUrl);

  const started = Date.now();
  const deadline = started + config.proofRetryTimeoutMs;
  let attempt = 0;
  let result = await builder.getProof(txHash);

  while (!result.success || !result.data) {
    const reason = String(result.error ?? "unknown error");
    if (!isTransientProofError(reason)) {
      throw new Error(`Proof generation failed for ${txHash}: ${reason}`);
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Proof generation failed for ${txHash} after ${Math.round((Date.now() - started) / 1000)}s ` +
          `of retries: ${reason}. The height is attested, so the proof should appear — ` +
          `re-run \`open\` rather than re-locking.`,
      );
    }
    attempt += 1;
    onStage?.({ phase: "proof_retry", attempt, waited: Math.round((Date.now() - started) / 1000), reason });
    await sleep(config.proofRetryPollMs);
    result = await builder.getProof(txHash);
  }

  const d = result.data;
  onStage?.({ phase: "proof_ready", height: Number(d.headerNumber) });

  return {
    chainKey: Number(d.chainKey),
    height: Number(d.headerNumber),
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

/** Wait for attestation, then build the proof. */
export async function attestAndBuild(
  blockNumber: number,
  txHash: string,
  onStage?: (s: Stage) => void,
): Promise<AttestcoinProof> {
  await waitUntilAttested(blockNumber, onStage);
  onStage?.({ phase: "building_proof", height: blockNumber });
  return buildProof(txHash, onStage);
}
