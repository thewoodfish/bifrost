import { formatUnits } from "viem";
import { config } from "./config";

export function usd(v: bigint | undefined | null): string {
  if (v === undefined || v === null) return "—";
  const n = Number(formatUnits(v, config.decimals));
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

/** "$750k", "$1.2M" — for headlines and dense rows where the exact figure is a click away. */
export function usdShort(v: bigint | undefined | null): string {
  if (v === undefined || v === null) return "—";
  const n = Number(formatUnits(v, config.decimals));
  if (n >= 1e9) return `$${trim(n / 1e9)}B`;
  if (n >= 1e6) return `$${trim(n / 1e6)}M`;
  if (n >= 1e4) return `$${trim(n / 1e3)}k`;
  return usd(v);
}

function trim(n: number): string {
  return n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1).replace(/\.0$/, "") : n.toFixed(2).replace(/\.?0+$/, "");
}

export function toNumber(v: bigint): number {
  return Number(formatUnits(v, config.decimals));
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
  if (hrs < 48) return mins % 60 ? `${hrs} hr ${mins % 60} min` : `${hrs} hr`;
  return `${Math.round(hrs / 24)} days`;
}

export function ago(ts: number | undefined): string {
  if (ts === undefined) return "";
  const s = (Date.now() - ts) / 1000;
  return s < 45 ? "just now" : `${duration(s)} ago`;
}

export function dateTime(ts: number | undefined): string {
  if (ts === undefined) return "";
  return new Date(ts).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}
