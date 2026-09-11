import { useEffect, useMemo, useRef, useState } from "react";
import { usd } from "../lib/format";
import { phaseOf } from "../lib/phase";
import { useProtocol } from "../lib/protocol";
import { go } from "../lib/router";
import { Icon, PhaseChip } from "./ui";

type Item = { key: string; label: React.ReactNode; hint?: React.ReactNode; icon: React.ReactNode; to: string; text: string };

const PAGES: Item[] = [
  { key: "home", label: "Home", icon: <Icon.Home size={15} />, to: "/", text: "home landing site" },
  { key: "app", label: "Dashboard", icon: <Icon.Grid size={15} />, to: "/app", text: "dashboard borrow credit console" },
  { key: "ledger", label: "Proof ledger", icon: <Icon.Ledger size={15} />, to: "/ledger", text: "ledger proofs positions locks lines" },
  { key: "valuer", label: "Valuation desk", icon: <Icon.Scale size={15} />, to: "/valuer", text: "valuation desk valuer price" },
];

/** ⌘K: jump to any page or portfolio without knowing where it lives. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { portfolios, attestation, params } = useProtocol();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase().replace(/^#/, "");
    const books: Item[] = Object.values(portfolios)
      .sort((a, b) => Number(b.id) - Number(a.id))
      .map((p) => ({
        key: `p${p.id}`,
        label: <>Portfolio <span className="num">#{p.id}</span></>,
        hint: <><span className="num dim">{p.value > 0n ? usd(p.lastLock?.value ?? p.value) : "Unvalued"}</span><PhaseChip phase={phaseOf(p, attestation, params).phase} /></>,
        icon: <Icon.Layers size={15} />,
        to: `/p/${p.id}`,
        text: `portfolio ${p.id} ${p.owner}`.toLowerCase(),
      }));
    const all = [...PAGES, ...books];
    const hits = needle ? all.filter((i) => i.text.includes(needle)) : all;
    if (/^\d+$/.test(needle) && !portfolios[needle]) {
      // Known portfolios that match rank first; the raw id is the fallback.
      hits.push({ key: "goto", label: <>Open portfolio <span className="num">#{needle}</span></>, icon: <Icon.ArrowRight size={15} />, to: `/p/${needle}`, text: needle });
    }
    return hits.slice(0, 9);
  }, [q, portfolios, attestation, params]);

  if (!open) return null;

  const pick = (i: Item | undefined) => {
    if (!i) return;
    go(i.to);
    onClose();
  };

  return (
    <div className="palette-scrim" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Search">
        <div className="palette-input">
          <Icon.Search size={16} />
          <input
            ref={input}
            value={q}
            placeholder="Search pages or portfolio #…"
            onChange={(e) => { setQ(e.target.value); setSel(0); }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              else if (e.key === "Enter") pick(items[sel]);
            }}
          />
          <kbd>esc</kbd>
        </div>
        <div className="palette-list">
          {items.length === 0 && <div className="palette-empty">No matches.</div>}
          {items.map((i, n) => (
            <button
              key={i.key}
              className={`palette-item${n === sel ? " on" : ""}`}
              onMouseEnter={() => setSel(n)}
              onClick={() => pick(i)}
            >
              <span className="palette-icon">{i.icon}</span>
              <span className="palette-label">{i.label}</span>
              {i.hint && <span className="palette-hint">{i.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
