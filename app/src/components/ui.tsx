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

const SIDE_NAME: Record<Side, string> = {
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

export function Spinner({ light }: { light?: boolean }) {
  return <span className={`spinner${light ? " light" : ""}`} aria-label="Loading" />;
}

export function Stat({ label, value, note, big }: { label: string; value: React.ReactNode; note?: React.ReactNode; big?: boolean }) {
  return (
    <div className={`stat${big ? " stat-big" : ""}`}>
      <div className="stat-label">{label}</div>
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

/** The Bifrost mark: a single arc spanning two shores — the bridge nothing crosses but proof. */
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="bf-arc" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#4F5BD5" />
          <stop offset="0.5" stopColor="#8A4FE0" />
          <stop offset="1" stopColor="#E0951A" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="#0D0F14" />
      <path d="M7 22a9 9 0 0 1 18 0" fill="none" stroke="url(#bf-arc)" strokeWidth="3.2" strokeLinecap="round" />
      <circle cx="7" cy="22" r="1.9" fill="#4F5BD5" />
      <circle cx="25" cy="22" r="1.9" fill="#E0951A" />
    </svg>
  );
}
