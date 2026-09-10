import { origin } from "../lib/chains";
import { config } from "../lib/config";
import { useSupportedChains } from "../lib/useAttestation";

/**
 * The attested source chains, read live from the ChainInfo precompile.
 *
 * This is the measurement the whole architecture rests on. The pitch would prefer to
 * name Base and Plume — that is where RWA issuers actually are — but they are not in
 * this list, so the protocol targets Sepolia instead. Rendering the raw answer keeps
 * that honest: if Gluwa adds a chain, this card says so without a code change.
 */
export function SupportedChains() {
  const { chains, error } = useSupportedChains();

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">Attestcoin source chains</span>
        <span className="dim small">
          Live from <span className="mono">get_supported_chains()</span>
        </span>
      </div>
      <div className="card-body stack">
        {error ? (
          <div className="notice error small">
            <div className="notice-title">Could not reach the ChainInfo precompile</div>
            {error}
          </div>
        ) : chains.length === 0 ? (
          <div className="dim small">Reading…</div>
        ) : (
          <dl className="kv small">
            {chains.map((c) => (
              <div key={c.chainKey} style={{ display: "contents" }}>
                <dt>{c.chainName}</dt>
                <dd className="num">
                  chainKey <span className="mono">{c.chainKey}</span> · chain id{" "}
                  <span className="mono">{c.chainId}</span>
                  {c.chainId === origin.id && c.chainKey === config.chainKey && (
                    <span className="dim"> · this deployment</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
        <div className="dim small">
          Only these chains can be proven to Creditcoin. Base and Plume are absent — which
          is measured here on every load, not assumed.
        </div>
      </div>
    </div>
  );
}
