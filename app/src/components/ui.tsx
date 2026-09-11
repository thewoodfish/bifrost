import { creditcoin, explorerAddress, explorerTx, origin } from "../lib/chains";
import { shortAddress, shortHash } from "../lib/format";
import { PHASE_META, type Phase, type Tone } from "../lib/phase";

export function Chip({ tone = "neutral", pulse, children }: { tone?: Tone; pulse?: boolean; children: React.ReactNode }) {
  return (
    <span className={`chip chip-${tone}`}>
      <span className={`chip-dot${pulse ? " pulse" : ""}`} />
      {children}
    </span>
  );
}

export function PhaseChip({ phase }: { phase: Phase }) {
  const m = PHASE_META[phase];
  return <Chip tone={m.tone} pulse={phase === "in-transit"}>{m.label}</Chip>;
}

export type Side = "origin" | "attest" | "creditcoin";

export const SIDE_NAME: Record<Side, string> = {
  origin: "Sepolia",
  attest: "Attestcoin",
  creditcoin: "Creditcoin",
};

export function ChainTag({ side }: { side: Side }) {
  return (
    <span className={`chain chain-${side}`}>
      <span className="chain-dot" />
      {SIDE_NAME[side]}
    </span>
  );
}

export function TxLink({ side, hash, children }: { side: "origin" | "creditcoin"; hash: string; children?: React.ReactNode }) {
  return (
    <a
      className="mono link"
      href={explorerTx(side === "creditcoin" ? creditcoin.id : origin.id, hash)}
      target="_blank"
      rel="noreferrer"
    >
      {children ?? shortHash(hash)}
      <Arrow />
    </a>
  );
}

export function AddressLink({ side, address }: { side: "origin" | "creditcoin"; address: string }) {
  return (
    <a
      className="mono link"
      href={explorerAddress(side === "creditcoin" ? creditcoin.id : origin.id, address)}
      target="_blank"
      rel="noreferrer"
      title={address}
    >
      {shortAddress(address)}
    </a>
  );
}

/** Deterministic gradient avatar, so an address is recognisable at a glance. */
export function Avatar({ address, size = 18 }: { address: string; size?: number }) {
  const h = parseInt(address.slice(2, 8), 16);
  const a = h % 360;
  const b = (a + 70 + ((h >> 8) % 90)) % 360;
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, background: `linear-gradient(135deg, hsl(${a} 80% 62%), hsl(${b} 75% 52%))` }}
    />
  );
}

export function Spinner({ light }: { light?: boolean }) {
  return <span className={`spinner${light ? " light" : ""}`} aria-label="Loading" />;
}

export function Skeleton({ w = "100%", h = 14, r = 6 }: { w?: number | string; h?: number; r?: number }) {
  return <span className="skel" style={{ width: w, height: h, borderRadius: r }} />;
}

export function Stat({ label, value, note, big, icon }: { label: string; value: React.ReactNode; note?: React.ReactNode; big?: boolean; icon?: React.ReactNode }) {
  return (
    <div className={`stat${big ? " stat-big" : ""}`}>
      <div className="stat-label">{icon}{label}</div>
      <div className="stat-value num">{value}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  );
}

export function Notice({ tone = "neutral", title, children }: { tone?: Tone; title?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className={`notice notice-${tone}`}>
      {title && <div className="notice-title">{title}</div>}
      {children && <div className="notice-body">{children}</div>}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: React.ReactNode; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <div className="empty-title">{title}</div>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

/**
 * The Bifrost mark: three concentric arcs — the rainbow bridge — one per chain the proof
 * touches. Sepolia outermost, Creditcoin innermost, where the credit lands.
 */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="logo">
      <rect width="32" height="32" rx="9" fill="#10121A" />
      <rect x="0.5" y="0.5" width="31" height="31" rx="8.5" fill="none" stroke="rgba(255,255,255,0.1)" />
      <path d="M6.5 22.5a9.5 9.5 0 0 1 19 0" fill="none" stroke="#7382FF" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M10.5 22.5a5.5 5.5 0 0 1 11 0" fill="none" stroke="#B48CFF" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M14.4 22.5a1.6 1.6 0 0 1 3.2 0" fill="none" stroke="#FFB547" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

// ── Icons ────────────────────────────────────────────────────────────────────
// One stroke weight, one grid, drawn inline so nothing loads at runtime.

type IconProps = { size?: number; className?: string };

function Svg({ size = 16, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}
    >
      {children}
    </svg>
  );
}

export function Arrow() {
  return (
    <svg className="ext" width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <path d="M3 1.5h5.5V7M8.5 1.5 1.5 8.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

export function Check({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Cross({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export const Icon = {
  Home: (p: IconProps) => <Svg {...p}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9v11h14V9" /><path d="M10 20v-6h4v6" /></Svg>,
  Grid: (p: IconProps) => <Svg {...p}><rect x="3" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" /></Svg>,
  Ledger: (p: IconProps) => <Svg {...p}><path d="M4 5h16M4 12h16M4 19h10" /></Svg>,
  Scale: (p: IconProps) => <Svg {...p}><path d="M12 3v18M7 21h10M5 7h14" /><path d="m5 7-3 7a3.5 3.5 0 0 0 6 0L5 7ZM19 7l-3 7a3.5 3.5 0 0 0 6 0l-3-7Z" /></Svg>,
  Shield: (p: IconProps) => <Svg {...p}><path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z" /><path d="m8.5 12 2.5 2.5 4.5-5" /></Svg>,
  Search: (p: IconProps) => <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Svg>,
  ArrowRight: (p: IconProps) => <Svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>,
  ArrowLeft: (p: IconProps) => <Svg {...p}><path d="M19 12H5M11 6l-6 6 6 6" /></Svg>,
  Plus: (p: IconProps) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>,
  Menu: (p: IconProps) => <Svg {...p}><path d="M4 7h16M4 12h16M4 17h16" /></Svg>,
  Close: (p: IconProps) => <Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>,
  Lock: (p: IconProps) => <Svg {...p}><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></Svg>,
  Bolt: (p: IconProps) => <Svg {...p}><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" /></Svg>,
  Clock: (p: IconProps) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>,
  Wallet: (p: IconProps) => <Svg {...p}><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18v3" /><path d="M3 7.5v10A2.5 2.5 0 0 0 5.5 20H20V8H5.5A2.5 2.5 0 0 1 3 5.5" /><circle cx="16" cy="14" r="1.2" fill="currentColor" /></Svg>,
  Coins: (p: IconProps) => <Svg {...p}><ellipse cx="9" cy="7" rx="6" ry="3" /><path d="M3 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7" /><path d="M9 15v2c0 1.7 2.7 3 6 3s6-1.3 6-3v-5c0-1.7-2.7-3-6-3" /></Svg>,
  Layers: (p: IconProps) => <Svg {...p}><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></Svg>,
  Eye: (p: IconProps) => <Svg {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></Svg>,
  Refresh: (p: IconProps) => <Svg {...p}><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" /><path d="M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" /><path d="M20 20v-4h-4" /></Svg>,
  Copy: (p: IconProps) => <Svg {...p}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></Svg>,
  Logout: (p: IconProps) => <Svg {...p}><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 17l-5-5 5-5M5 12h11" /></Svg>,
  Pulse: (p: IconProps) => <Svg {...p}><path d="M3 12h4l2.5-6 5 12 2.5-6h4" /></Svg>,
  Doc: (p: IconProps) => <Svg {...p}><path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8l-5-5Z" /><path d="M14 3v5h5M8.5 13h7M8.5 17h5" /></Svg>,
};
