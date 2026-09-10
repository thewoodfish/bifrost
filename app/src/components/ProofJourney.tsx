import { duration } from "../lib/format";
import type { LockedEvent } from "../lib/indexer";
import type { PhaseInfo } from "../lib/phase";
import { useProtocol } from "../lib/protocol";
import { Check, TxLink } from "./ui";

type StationState = "done" | "active" | "waiting";

function Station({
  side, state, title, children,
}: { side: "origin" | "attest" | "creditcoin"; state: StationState; title: string; children: React.ReactNode }) {
  return (
    <div className={`station station-${side} is-${state}`}>
      <div className="station-node">
        {state === "done" ? <Check size={16} /> : state === "active" ? <span className="station-pulse" /> : null}
      </div>
      <div className="station-chain">{side === "origin" ? "Sepolia" : side === "attest" ? "Attestcoin" : "Creditcoin"}</div>
      <div className="station-title">{title}</div>
      <div className="station-detail">{children}</div>
    </div>
  );
}

/**
 * The lock travelling from Sepolia to Creditcoin, drawn from live chain reads.
 *
 * The 8-20 minute attestation wait is the moment a borrower is most likely to think the
 * product is broken. So it gets the most attention: where the proof is, what is happening
 * to it, and how long is left, all measured, none of it a timer.
 */
export function ProofJourney({
  lock, info, claimed,
}: { lock: LockedEvent; info: PhaseInfo; claimed: boolean }) {
  const { attestation: a } = useProtocol();

  const attested = info.phase !== "in-transit";
  let progress = 0.5;
  if (attested) progress = 1;
  else if (info.eta !== null && lock.ts !== undefined) {
    const elapsed = (Date.now() - lock.ts) / 1000;
    progress = 0.5 + 0.5 * Math.min(elapsed / (elapsed + info.eta), 0.97);
  }

  return (
    <div className={`journey${attested ? " arrived" : " moving"}`}>
      <div className="journey-track">
        <div className="journey-fill" style={{ width: `${progress * 100}%` }} />
        {!attested && <div className="journey-packet" style={{ left: `${progress * 100}%` }} />}
      </div>
      <div className="journey-stations">
        <Station side="origin" state="done" title="Collateral locked">
          Block {lock.block.toLocaleString()} · <TxLink side="origin" hash={lock.tx}>tx</TxLink>
        </Station>
        <Station side="attest" state={attested ? "done" : "active"} title={attested ? "Block attested" : "Attesting block"}>
          {attested ? (
            <>Proof available</>
          ) : info.blocksToGo !== null ? (
            <>
              {info.blocksToGo.toLocaleString()} block{info.blocksToGo === 1 ? "" : "s"} to go
              {info.eta !== null && <> · ~{duration(info.eta)}</>}
            </>
          ) : (
            <>Frontier at #{a.attested?.toLocaleString() ?? "…"}</>
          )}
        </Station>
        <Station
          side="creditcoin"
          state={claimed ? "done" : attested ? "active" : "waiting"}
          title={claimed ? "Line opened" : attested ? "Ready to claim" : "Waiting for proof"}
        >
          {claimed ? "Verified on-chain" : attested ? "BlockProver verifies on claim" : "Nothing to do yet"}
        </Station>
      </div>
    </div>
  );
}
