import {
  decodeAbiParameters, encodeAbiParameters, keccak256, parseAbiParameters, toEventSelector,
  type Address, type Hex,
} from "viem";
import { BLOCK_PROVER_ABI } from "./abis";
import { creditcoinClient } from "./clients";
import { BLOCK_PROVER_PRECOMPILE, config } from "./config";
import type { AttestcoinProof } from "./prover";

/**
 * Client-side mirror of what Creditcoin does with an Attestcoin proof.
 *
 * Nothing here is trusted by the protocol — the engine repeats all of it on-chain. It
 * exists so anyone can watch the check happen: decode the attested receipt the same way
 * `AttestedTx.sol` does, then ask the BlockProver precompile directly whether the proof
 * holds. That turns "backed by a proof" from a claim on a website into a call the
 * reader makes themselves.
 */

const OUTER = parseAbiParameters("uint8, bytes[]");
const RECEIPT = parseAbiParameters("uint8, uint64, (address, bytes32[], bytes)[], bytes");
const LOCK_DATA = parseAbiParameters("uint256, uint64");

export const LOCK_TOPIC = toEventSelector(
  "PortfolioLocked(address,uint256,uint256,uint64)",
);

export interface DecodedLock {
  owner: Address;
  portfolioId: bigint;
  dollarValue: bigint;
  valuationRound: bigint;
}

export interface DecodedReceipt {
  txType: number;
  chunks: number;
  status: number;
  gasUsed: bigint;
  logs: { emitter: Address; topics: readonly Hex[]; data: Hex }[];
  /** The PortfolioLocked log from the configured vault, if the receipt carries one. */
  lock: DecodedLock | null;
  /** keccak256 of the payload — the engine's receiptId, what makes a receipt single-use. */
  receiptId: Hex;
}

/**
 * Decode `abi.encode(uint8 txType, bytes[] chunks)` and read the receipt from the last
 * chunk. Same layout, same "last chunk" rule and same emitter check as the Solidity
 * decoder, so what this shows is what the engine sees.
 */
export function decodeAttestedTx(encodedTx: Hex): DecodedReceipt {
  const [txType, chunks] = decodeAbiParameters(OUTER, encodedTx);
  const [status, gasUsed, rawLogs] = decodeAbiParameters(RECEIPT, chunks[chunks.length - 1]);
  const logs = rawLogs.map(([emitter, topics, data]) => ({ emitter, topics, data }));

  const hit = logs.find(
    (l) =>
      l.emitter.toLowerCase() === config.originVault.toLowerCase() &&
      l.topics[0]?.toLowerCase() === LOCK_TOPIC.toLowerCase(),
  );
  let lock: DecodedLock | null = null;
  if (hit && hit.topics.length >= 3) {
    const [dollarValue, valuationRound] = decodeAbiParameters(LOCK_DATA, hit.data);
    lock = {
      owner: `0x${hit.topics[1].slice(26)}` as Address,
      portfolioId: BigInt(hit.topics[2]),
      dollarValue,
      valuationRound,
    };
  }

  return {
    txType, chunks: chunks.length, status, gasUsed, logs, lock,
    receiptId: keccak256(encodedTx),
  };
}

/**
 * Re-encode the payload with the lock's dollar value replaced — a forged receipt that
 * claims the portfolio is worth more than it is. Everything else is byte-identical, so a
 * rejection can only be the proof catching the changed value.
 */
export function forgeValue(encodedTx: Hex, newValue: bigint): Hex {
  const [txType, chunks] = decodeAbiParameters(OUTER, encodedTx);
  const last = chunks.length - 1;
  const [status, gasUsed, logs, bloom] = decodeAbiParameters(RECEIPT, chunks[last]);

  const forgedLogs = logs.map(([emitter, topics, data]) => {
    const isLock =
      emitter.toLowerCase() === config.originVault.toLowerCase() &&
      topics[0]?.toLowerCase() === LOCK_TOPIC.toLowerCase();
    if (!isLock) return [emitter, topics, data] as const;
    const [, round] = decodeAbiParameters(LOCK_DATA, data);
    return [emitter, topics, encodeAbiParameters(LOCK_DATA, [newValue, round])] as const;
  });

  const forgedReceipt = encodeAbiParameters(RECEIPT, [status, gasUsed, forgedLogs, bloom]);
  const forgedChunks = chunks.map((c, i) => (i === last ? forgedReceipt : c));
  return encodeAbiParameters(OUTER, [txType, forgedChunks]);
}

export interface VerifyResult {
  ok: boolean;
  /** The precompile's own revert reason, when it refuses. */
  reason: string | null;
  ms: number;
}

/** Ask Creditcoin's BlockProver precompile, read-only, whether this proof holds. */
export async function verifyOnCreditcoin(
  proof: AttestcoinProof, encodedTx: Hex = proof.encodedTx,
): Promise<VerifyResult> {
  const t0 = performance.now();
  try {
    const ok = (await creditcoinClient.readContract({
      address: BLOCK_PROVER_PRECOMPILE,
      abi: BLOCK_PROVER_ABI,
      functionName: "verify",
      args: [
        BigInt(proof.chainKey), BigInt(proof.height), encodedTx,
        proof.merkleProof, proof.continuityProof,
      ],
    })) as boolean;
    return { ok, reason: ok ? null : "verify() returned false", ms: performance.now() - t0 };
  } catch (e) {
    const err = e as { shortMessage?: string; message?: string; details?: string };
    const text = `${err.shortMessage ?? ""}\n${err.details ?? ""}\n${err.message ?? ""}`;
    const m = /reason:\s*\n?\s*([^\n]+)/i.exec(text) ?? /reverted[^:]*:\s*([^\n]+)/i.exec(text);
    return { ok: false, reason: (m?.[1] ?? err.shortMessage ?? "call reverted").trim(), ms: performance.now() - t0 };
  }
}
