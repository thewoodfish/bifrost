import { useEffect, useRef, useState } from "react";
import { creditcoin, origin } from "../lib/chains";
import { SEPOLIA_BLOCK_SECONDS } from "../lib/config";
import { duration, shortAddress } from "../lib/format";
import { useProtocol } from "../lib/protocol";
import { Link } from "../lib/router";
import { useToasts } from "../lib/toast";
import { useRoles } from "../lib/usePortfolio";
import { useWallet } from "../lib/wallet";
import { CommandPalette } from "./CommandPalette";
import { Arrow, Avatar, Check, Cross, Icon, Logo, Notice, Spinner } from "./ui";

const CHAIN_NAMES: Record<number, string> = {
  [origin.id]: "Sepolia",
  [creditcoin.id]: "Creditcoin",
};

/** Seconds the attestation frontier trails the Sepolia head, from the measured rate. */
export function useLagSeconds(): number | null {
  const { attestation: a } = useProtocol();
  if (a.behind === null) return null;
  return a.behind / (a.rate && a.rate > 0 ? a.rate : 1 / SEPOLIA_BLOCK_SECONDS);
}

// ── Sidebar ──────────────────────────────────────────────────────────────────

const NAV = [
  { group: "Borrow", items: [{ to: "/app", label: "Dashboard", icon: Icon.Grid, match: ["app", "p"] }] },
  { group: "Lend", items: [{ to: "/lend", label: "Lend", icon: Icon.Coins, match: ["lend"] }] },
  {
    group: "Protocol",
    items: [
      { to: "/ledger", label: "Proof ledger", icon: Icon.Ledger, match: ["ledger", "verify"] },
      { to: "/valuer", label: "Valuation desk", icon: Icon.Scale, match: ["valuer"] },
    ],
  },
];

/**
 * Attestation lag, always in view. The 8-20 minute wait is the product's defining
 * constraint; showing it everywhere means a pending line reads as normal, not as a hang.
 */
function AttestationWidget() {
  const { attestation: a } = useProtocol();
  const lag = useLagSeconds();
  const state = a.error ? "down" : a.attested === null ? "idle" : "live";
  // 150 Sepolia blocks is ~30 minutes: the far end of normal attestation lag.
  const fill = a.behind !== null ? Math.min(a.behind / 150, 1) : 0;

  return (
    <div className="att">
      <div className="att-head">
        <span className={`dot dot-${state}`} />
        <span className="att-title">Attestcoin</span>
        <span className="att-state">{state === "down" ? "Unreachable" : state === "idle" ? "Connecting" : "Live"}</span>
      </div>
      <div className="att-row"><span>Lag</span><strong className="num">{lag !== null ? duration(lag) : "—"}</strong></div>
      <div className="att-bar"><span style={{ width: `${fill * 100}%` }} /></div>
      <div className="att-row"><span>Attested</span><span className="num mono">{a.attested ? `#${a.attested.toLocaleString()}` : "—"}</span></div>
      <div className="att-row"><span>Sepolia head</span><span className="num mono">{a.originHead ? `#${a.originHead.toLocaleString()}` : "—"}</span></div>
    </div>
  );
}

function Sidebar({ section, open, onClose }: { section: string; open: boolean; onClose: () => void }) {
  return (
    <>
      <div className={`scrim${open ? " on" : ""}`} onClick={onClose} />
      <aside className={`sidebar${open ? " open" : ""}`}>
        <div className="sb-top">
          <Link to="/" className="brand" onClick={onClose}>
            <Logo />
            <span>Bifrost</span>
          </Link>
          <span className="env">Testnet</span>
          <button className="icon-btn sb-close" onClick={onClose} aria-label="Close menu"><Icon.Close /></button>
        </div>

        <nav className="sb-nav">
          {NAV.map((g) => (
            <div key={g.group} className="sb-group">
              <div className="sb-label">{g.group}</div>
              {g.items.map((it) => (
                <Link
                  key={it.to}
                  to={it.to}
                  className={`sb-link${it.match.includes(section) ? " active" : ""}`}
                  onClick={onClose}
                >
                  <it.icon size={16} />
                  {it.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="sb-foot">
          <AttestationWidget />
          <Link to="/" className="sb-link sb-back" onClick={onClose}>
            <Icon.ArrowLeft size={15} /> Back to site
          </Link>
        </div>
      </aside>
    </>
  );
}

// ── Topbar ───────────────────────────────────────────────────────────────────

function WalletButton() {
  const { address, chainId, connect, disconnect, connecting, available } = useWallet();
  const roles = useRoles(address);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
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
    return available ? (
      <button className="btn btn-primary btn-sm" onClick={connect} disabled={connecting}>
        {connecting ? <><Spinner /> Connecting…</> : <><Icon.Wallet size={15} /> Connect wallet</>}
      </button>
    ) : (
      <a className="btn btn-secondary btn-sm" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
        <Icon.Wallet size={15} /> Get a wallet
      </a>
    );
  }

  const role = roles.valuer ? "Valuer" : roles.originator ? "Originator" : null;

  return (
    <div className="wallet" ref={ref}>
      <button className="wallet-btn" onClick={() => setOpen((o) => !o)}>
        <Avatar address={address} />
        <span className="mono">{shortAddress(address)}</span>
        {role && <span className="role">{role}</span>}
      </button>
      {open && (
        <div className="menu">
          <div className="menu-head">
            <Avatar address={address} size={32} />
            <div>
              <div className="mono">{shortAddress(address)}</div>
              <div className="dim small">
                {[roles.originator && "Originator", roles.valuer && "Valuer", roles.admin && "Admin"].filter(Boolean).join(" · ") || "Borrower"}
              </div>
            </div>
          </div>
          <div className="menu-row">
            <span className="dim">Network</span>
            <span>{chainId ? (CHAIN_NAMES[chainId] ?? `Chain ${chainId}`) : "—"}</span>
          </div>
          <div className="menu-note">Bifrost switches networks for you on each action.</div>
          <button
            className="menu-item"
            onClick={() => {
              void navigator.clipboard?.writeText(address);
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            }}
          >
            <Icon.Copy size={15} /> {copied ? "Copied" : "Copy address"}
          </button>
          <button className="menu-item" onClick={() => { disconnect(); setOpen(false); }}>
            <Icon.Logout size={15} /> Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

const TITLES: Record<string, string> = {
  app: "Dashboard",
  p: "Dashboard",
  ledger: "Proof ledger",
  verify: "Proof ledger",
  valuer: "Valuation desk",
  lend: "Lend",
};

function Crumbs({ route }: { route: string[] }) {
  const [section, arg] = route;
  const root = TITLES[section] ?? "Bifrost";
  const rootTo = section === "p" ? "/app" : section === "verify" ? "/ledger" : `/${section}`;
  const leaf = section === "p" ? `Portfolio #${arg}` : section === "verify" ? `Verify #${arg}` : null;
  return (
    <div className="crumbs">
      {leaf ? <Link to={rootTo} className="crumb-link">{root}</Link> : <span className="crumb-cur">{root}</span>}
      {leaf && <><span className="crumb-sep">/</span><span className="crumb-cur num">{leaf}</span></>}
    </div>
  );
}

// ── Toasts ───────────────────────────────────────────────────────────────────

function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="toaster" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          <span className="toast-icon">
            {t.tone === "loading" ? <Spinner /> : t.tone === "success" ? <Check /> : t.tone === "error" ? <Cross /> : <Icon.Bolt size={14} />}
          </span>
          <div className="toast-body">
            <div className="toast-title">{t.title}</div>
            {t.body && <div className="toast-text">{t.body}</div>}
            {t.href && <a className="toast-link" href={t.href} target="_blank" rel="noreferrer">{t.hrefLabel ?? "View"} <Arrow /></a>}
          </div>
          <button className="toast-x" onClick={() => dismiss(t.id)} aria-label="Dismiss"><Icon.Close size={13} /></button>
        </div>
      ))}
    </div>
  );
}

// ── Shell ────────────────────────────────────────────────────────────────────

export function AppShell({ route, children }: { route: string[]; children: React.ReactNode }) {
  const section = route[0] ?? "";
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  const { error } = useWallet();
  const { error: syncError, synced } = useProtocol();

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  return (
    <div className="app">
      <Sidebar section={section} open={drawer} onClose={() => setDrawer(false)} />
      <div className="main-col">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setDrawer(true)} aria-label="Open menu"><Icon.Menu /></button>
          <Link to="/" className="brand topbar-brand"><Logo size={24} /></Link>
          <Crumbs route={route} />
          <div className="topbar-right">
            <button className="search-btn" onClick={() => setPalette(true)}>
              <Icon.Search size={14} />
              <span className="search-label">Search portfolios…</span>
              <kbd>⌘K</kbd>
            </button>
            <WalletButton />
          </div>
        </header>
        {error && section !== "app" && (
          <div className="content banner"><Notice tone="red">{error}</Notice></div>
        )}
        {syncError && !synced && (
          <div className="content banner">
            <Notice tone="amber" title="Having trouble reaching the chains">{syncError}</Notice>
          </div>
        )}
        <main className="content">{children}</main>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
      <Toaster />
    </div>
  );
}
