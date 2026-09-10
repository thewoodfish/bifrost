import { useEffect, useRef, useState } from "react";
import { creditcoin, origin } from "../lib/chains";
import { SEPOLIA_BLOCK_SECONDS } from "../lib/config";
import { duration, shortAddress } from "../lib/format";
import { useProtocol } from "../lib/protocol";
import { Link } from "../lib/router";
import { useRoles } from "../lib/usePortfolio";
import { useWallet } from "../lib/wallet";
import { Logo } from "./ui";

const CHAIN_NAMES: Record<number, string> = {
  [origin.id]: "Sepolia",
  [creditcoin.id]: "Creditcoin",
};

/**
 * Attestation lag, in plain words. The 8-20 minute wait is the product's defining
 * constraint; showing it everywhere means a pending line reads as normal, not as a hang.
 */
function LiveIndicator() {
  const { attestation: a } = useProtocol();
  if (a.error) {
    return <span className="live live-down" title={a.error}><span className="live-dot" />Attestcoin unreachable</span>;
  }
  if (a.attested === null) return <span className="live"><span className="live-dot idle" />Connecting…</span>;
  const lag = a.behind === null ? null : a.behind / (a.rate && a.rate > 0 ? a.rate : 1 / SEPOLIA_BLOCK_SECONDS);
  return (
    <span
      className="live"
      title={`Sepolia head #${a.originHead?.toLocaleString()} · attested to #${a.attested.toLocaleString()} · ${a.behind} blocks behind`}
    >
      <span className="live-dot" />
      Attestcoin live{lag !== null && <span className="live-dim"> · {duration(lag)} behind</span>}
    </span>
  );
}

function WalletButton() {
  const { address, chainId, connect, disconnect, connecting, available } = useWallet();
  const roles = useRoles(address);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!address) {
    return (
      <button className="btn btn-primary btn-sm" onClick={connect} disabled={connecting || !available}>
        {connecting ? "Connecting…" : available ? "Connect wallet" : "No wallet found"}
      </button>
    );
  }

  const role = roles.valuer ? "Valuer" : roles.originator ? "Originator" : null;

  return (
    <div className="wallet" ref={ref}>
      <button className="btn btn-secondary btn-sm wallet-btn" onClick={() => setOpen((o) => !o)}>
        <span className="avatar" style={{ background: `hsl(${parseInt(address.slice(2, 6), 16) % 360} 60% 55%)` }} />
        <span className="mono">{shortAddress(address)}</span>
        {role && <span className="role">{role}</span>}
      </button>
      {open && (
        <div className="menu">
          <div className="menu-row">
            <span className="dim">Network</span>
            <span>{chainId ? (CHAIN_NAMES[chainId] ?? `Chain ${chainId}`) : "—"}</span>
          </div>
          <div className="menu-row">
            <span className="dim">Roles</span>
            <span>
              {[roles.originator && "Originator", roles.valuer && "Valuer", roles.admin && "Admin"].filter(Boolean).join(", ") || "Borrower"}
            </span>
          </div>
          <div className="menu-note">Bifrost switches networks for you on each action.</div>
          <button className="btn btn-ghost btn-sm menu-btn" onClick={() => { disconnect(); setOpen(false); }}>
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

export function Nav({ route }: { route: string[] }) {
  const section = route[0] ?? "";
  const is = (s: string[]) => (s.includes(section) ? "nav-link active" : "nav-link");

  return (
    <header className="nav">
      <div className="shell nav-inner">
        <Link to="/" className="brand">
          <Logo />
          <span>Bifrost</span>
        </Link>
        <nav className="nav-links">
          <Link to="/app" className={is(["app", "p"])}>Borrow</Link>
          <Link to="/valuer" className={is(["valuer"])}>Valuation desk</Link>
          <Link to="/ledger" className={is(["ledger", "verify"])}>Proof ledger</Link>
        </nav>
        <div className="nav-right">
          <LiveIndicator />
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
