import { formatUnits } from "viem";
import { config } from "./config";

export function usd(v: bigint | undefined): string {
  if (v === undefined) return "—";
  const n = Number(formatUnits(v, config.decimals));
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function shortAddress(a?: string | null): string {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—";
}

export function shortHash(h?: string | null): string {
  return h ? `${h.slice(0, 10)}…${h.slice(-6)}` : "—";
}

/** "8 min", "1 hr 4 min" — coarse on purpose; false precision reads as a fake progress bar. */
export function duration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 90) return `${Math.round(seconds)} sec`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  return `${hrs} hr ${mins % 60} min`;
}

export function ago(ts: number): string {
  return duration((Date.now() - ts) / 1000);
}
