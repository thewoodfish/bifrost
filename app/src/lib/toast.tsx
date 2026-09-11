import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

/**
 * Transaction feedback that outlives the component that sent it. A borrower who clicks
 * "Claim" and navigates away should still hear that the line opened.
 */

export type ToastTone = "loading" | "success" | "error" | "info";

export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  body?: string;
  href?: string;
  hrefLabel?: string;
}

interface ToastApi {
  push: (t: Omit<Toast, "id">) => number;
  update: (id: number, t: Partial<Omit<Toast, "id">>) => void;
  dismiss: (id: number) => void;
}

const Ctx = createContext<(ToastApi & { toasts: Toast[] }) | null>(null);

const LINGER_MS = 7000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((ts) => ts.filter((t) => t.id !== id));
  }, []);

  // Pending toasts stay until the chain answers; settled ones clear themselves.
  const schedule = useCallback((id: number, tone: ToastTone) => {
    clearTimeout(timers.current.get(id));
    if (tone !== "loading") timers.current.set(id, setTimeout(() => dismiss(id), LINGER_MS));
  }, [dismiss]);

  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = ++seq.current;
    setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
    schedule(id, t.tone);
    return id;
  }, [schedule]);

  const update = useCallback((id: number, patch: Partial<Omit<Toast, "id">>) => {
    setToasts((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    if (patch.tone) schedule(id, patch.tone);
  }, [schedule]);

  const value = useMemo(() => ({ toasts, push, update, dismiss }), [toasts, push, update, dismiss]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useToasts() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useToasts must be used inside ToastProvider");
  return v;
}
