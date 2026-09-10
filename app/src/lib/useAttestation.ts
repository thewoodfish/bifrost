import { useEffect, useRef, useState } from "react";
import { CHAIN_INFO_ABI } from "./abis";
import { CHAIN_INFO_PRECOMPILE, config } from "./config";
import { creditcoinClient, originClient } from "./clients";

export interface AttestationStatus {
  originHead: number | null;
  attested: number | null;
  behind: number | null;
  /** Blocks per second, measured from observed movement. Null until two samples differ. */
  rate: number | null;
  loading: boolean;
  error: string | null;
}

const POLL_MS = 15_000;

/**
 * Live attestation lag, read from the ChainInfo precompile on Creditcoin.
 *
 * This is the number the protocol actually runs on, and showing it is the honest
 * alternative to a progress bar that advances on a timer. Attestation runs 8-20 minutes
 * behind the source head; that is a property of Attestcoin, not something to hide.
 */
export function useAttestationStatus(): AttestationStatus {
  const [s, setS] = useState<AttestationStatus>({
    originHead: null, attested: null, behind: null, rate: null, loading: true, error: null,
  });
  // Samples of (wall clock, attested height) used to measure the real rate.
  const samples = useRef<{ t: number; h: number }[]>([]);

  useEffect(() => {
    let alive = true;

    async function poll() {
      try {
        const [head, latest] = await Promise.all([
          originClient.getBlockNumber(),
          creditcoinClient.readContract({
            address: CHAIN_INFO_PRECOMPILE,
            abi: CHAIN_INFO_ABI,
            functionName: "get_latest_attestation_height_and_hash",
            args: [BigInt(config.chainKey)],
          }),
        ]);
        if (!alive) return;

        const attested = Number((latest as readonly [bigint, string, boolean, boolean])[0]);
        const originHead = Number(head);

        const now = Date.now();
        const prev = samples.current[samples.current.length - 1];
        if (!prev || prev.h !== attested) samples.current.push({ t: now, h: attested });
        if (samples.current.length > 12) samples.current.shift();

        let rate: number | null = null;
        const first = samples.current[0];
        const last = samples.current[samples.current.length - 1];
        if (first && last && last.h > first.h && last.t > first.t) {
          rate = (last.h - first.h) / ((last.t - first.t) / 1000);
        }

        setS({
          originHead, attested, behind: originHead - attested, rate,
          loading: false, error: null,
        });
      } catch (e) {
        if (alive) {
          setS((p) => ({ ...p, loading: false, error: (e as Error).message }));
        }
      }
    }

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return s;
}

/** Seconds until `height` is attested, from the measured rate. Null when not yet knowable. */
export function etaFor(height: number, status: AttestationStatus): number | null {
  if (status.attested === null || status.rate === null || status.rate <= 0) return null;
  if (status.attested >= height) return 0;
  return (height - status.attested) / status.rate;
}

/** Whether a specific source height is attested — the authoritative on-chain answer. */
export async function isHeightAttested(height: number): Promise<boolean> {
  return (await creditcoinClient.readContract({
    address: CHAIN_INFO_PRECOMPILE,
    abi: CHAIN_INFO_ABI,
    functionName: "is_height_attested",
    args: [BigInt(config.chainKey), BigInt(height)],
  })) as boolean;
}
