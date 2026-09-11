import { useEffect, useState } from "react";
import { useWallet, type WalletOption } from "../lib/wallet";
import { Icon, Notice, Spinner } from "./ui";

/**
 * Choose which installed wallet to use. With several extensions installed, `window.ethereum`
 * belongs to whichever loaded last — so the choice has to be the user's, not the browser's.
 */
export function WalletPicker() {
  const { picking, closePicker, wallets, connectWith, connecting, error } = useWallet();
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (!picking) return;
    setPending(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closePicker();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picking, closePicker]);

  if (!picking) return null;

  const pick = (w: WalletOption) => {
    setPending(w.rdns);
    void connectWith(w);
  };

  return (
    <div className="palette-scrim" onMouseDown={closePicker}>
      <div className="picker" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Connect a wallet">
        <div className="picker-head">
          <div>
            <div className="picker-title">Connect a wallet</div>
            <div className="dim small">Pick the wallet holding the account you want to use.</div>
          </div>
          <button className="icon-btn" onClick={closePicker} aria-label="Close"><Icon.Close size={15} /></button>
        </div>
        <div className="picker-list">
          {wallets.map((w) => (
            <button key={w.rdns} className="picker-item" onClick={() => pick(w)} disabled={connecting}>
              {w.icon ? <img src={w.icon} alt="" className="picker-icon" /> : <span className="picker-icon picker-icon-blank"><Icon.Wallet size={16} /></span>}
              <span className="picker-name">{w.name}</span>
              {connecting && pending === w.rdns ? <Spinner /> : <Icon.ArrowRight size={15} className="picker-go" />}
            </button>
          ))}
        </div>
        {error && <Notice tone="red">{error}</Notice>}
        <div className="picker-foot dim small">
          Bifrost adds Creditcoin CC3 testnet to your wallet the first time you need it.
        </div>
      </div>
    </div>
  );
}
