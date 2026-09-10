/**
 * Local record of which portfolios this browser is watching, and the lock transaction
 * for each.
 *
 * Deliberately thin: everything that can be read from chain is read from chain. This
 * stores only what chain state cannot cheaply answer — which portfolio ids the user
 * cares about, and which transaction carried a given lock. Losing it degrades the portal
 * to "paste the lock hash again", never to wrong data.
 */

const KEY = "bifrost.watched.v1";

export interface Watched {
  portfolioId: string;
  lockTx?: string;
  lockBlock?: number;
  /** When the lock landed, so a wait can be described in wall-clock terms after reload. */
  lockedAt?: number;
  /** Attested height at the moment of locking — the baseline the progress bar measures from. */
  attestedAtLock?: number;
}

type Table = Record<string, Watched>;

function read(): Table {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Table) : {};
  } catch {
    return {};
  }
}

function write(t: Table) {
  try {
    localStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    // Private-mode or quota. The portal still works; it just forgets between reloads.
  }
}

export function listWatched(): Watched[] {
  return Object.values(read()).sort((a, b) => Number(a.portfolioId) - Number(b.portfolioId));
}

export function watch(portfolioId: string, patch: Partial<Watched> = {}): void {
  const t = read();
  t[portfolioId] = { ...(t[portfolioId] ?? { portfolioId }), ...patch, portfolioId };
  write(t);
}

export function unwatch(portfolioId: string): void {
  const t = read();
  delete t[portfolioId];
  write(t);
}

export function getWatched(portfolioId: string): Watched | undefined {
  return read()[portfolioId];
}
