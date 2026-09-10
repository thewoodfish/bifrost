import { useState } from "react";
import { setValuation } from "../lib/actions";
import { origin } from "../lib/chains";
import { usd } from "../lib/format";
import { creditFor } from "../lib/phase";
import { useProtocol } from "../lib/protocol";
import { useTx } from "../lib/useTx";
import { parseUnits } from "viem";
import { config } from "../lib/config";
import { Notice, Spinner } from "./ui";

/** Publish a valuation. Only ever rendered for a wallet holding the valuer role. */
export function ValuationForm({
  portfolioId, current, onDone, compact,
}: { portfolioId: string; current?: bigint; onDone?: () => unknown; compact?: boolean }) {
  const { params } = useProtocol();
  const { busy, error, run } = useTx();
  const [value, setValue] = useState("");

  const clean = value.replace(/[,$\s]/g, "");
  let parsed: bigint | null = null;
  try {
    parsed = /^\d+(\.\d{0,6})?$/.test(clean) && Number(clean) > 0 ? parseUnits(clean, config.decimals) : null;
  } catch {
    parsed = null;
  }

  return (
    <div className={`valuation${compact ? " compact" : ""}`}>
      <form
        className="valuation-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!parsed) return;
          void run("value", origin.id, (w, a) => setValuation(w, a, BigInt(portfolioId), clean), onDone).then(
            (h) => h && setValue(""),
          );
        }}
      >
        <label className="field money-field">
          <span className="field-prefix">$</span>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={current && current > 0n ? usd(current).replace("$", "") : "Portfolio value"}
            inputMode="decimal"
            aria-label="Valuation in USD"
          />
        </label>
        <button className="btn btn-primary" disabled={!parsed || busy !== null}>
          {busy ? <><Spinner light /> Publishing…</> : current && current > 0n ? "Republish" : "Publish valuation"}
        </button>
      </form>
      {parsed !== null && !compact && (
        <div className="field-hint">
          Supports a credit line of up to <strong>{usd(creditFor(parsed, params))}</strong> at the current advance rate.
        </div>
      )}
      {error && <Notice tone="red">{error}</Notice>}
    </div>
  );
}
