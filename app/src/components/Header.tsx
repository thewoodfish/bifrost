import { creditcoin, explorerAddress, origin } from "../lib/chains";
import { duration, shortAddress } from "../lib/format";
import type { AttestationStatus } from "../lib/useAttestation";
import { useWallet } from "../lib/wallet";

const CHAIN_NAMES: Record<number, string> = {
  [origin.id]: "Sepolia",
  [creditcoin.id]: "Creditcoin CC3",
};

/**
 * Live attestation lag, straight from the ChainInfo precompile.
 *
 * Deliberately always visible: the 8-20 minute lag is the defining constraint of the
 * protocol, and a user who understands it up front reads a pending line as normal rather
 * than as a hang.
 */
function AttestationPill({ status }: { status: AttestationStatus }) {
  if (status.error) {
    return (
      <span className="pill" title={status.error}>
        <span className="dot danger" /> Attestcoin unreachable
      </span>
    );
  }
  if (status.loading || status.attested === null) {
    return (
      <span className="pill">
        <span className="spin" /> Reading attestation height…
      </span>
    );
  }

  const behind = status.behind ?? 0;
  const lagSeconds = status.rate && status.rate > 0 ? behind / status.rate : null;

  return (
    <span
      className="pill num"
      title={`Sepolia head ${status.originHead}, latest attested ${status.attested}`}
    >
      <span className="dot ok" />
      Attested to #{status.attested.toLocaleString()}
      <span className="dim">
        · {behind.toLocaleString()} behind{lagSeconds ? ` · ~${duration(lagSeconds)}` : ""}
      </span>
    </span>
  );
}

export function Header({ status }: { status: AttestationStatus }) {
  const { address, chainId, connect, disconnect, connecting, available } = useWallet();

  return (
    <header className="header">
      <div className="brand">
        <div className="brand-mark" />
        Bifrost
        <small>private credit, cross-chain</small>
      </div>

      <div className="header-spacer" />

      <AttestationPill status={status} />

      {address ? (
        <>
          <span className="pill">
            <span className="dot ok" />
            {chainId ? (CHAIN_NAMES[chainId] ?? `Chain ${chainId}`) : "—"}
          </span>
          <a
            className="pill mono"
            href={explorerAddress(chainId ?? origin.id, address)}
            target="_blank"
            rel="noreferrer"
            style={{ color: "inherit" }}
          >
            {shortAddress(address)}
          </a>
          <button className="ghost" onClick={disconnect}>
            Disconnect
          </button>
        </>
      ) : (
        <button className="primary" onClick={connect} disabled={connecting || !available}>
          {connecting ? "Connecting…" : available ? "Connect wallet" : "No wallet found"}
        </button>
      )}
    </header>
  );
}
