import { useState } from "react";
import type { Watched } from "../lib/store";

const STAGE_DOT: Record<string, string> = {
  open: "ok", locked: "pending", closed: "idle",
};

export function Sidebar({
  watched, selected, stages, onSelect, onAdd, onRemove,
}: {
  watched: Watched[];
  selected: string | null;
  stages: Record<string, string>;
  onSelect: (id: string) => void;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [draft, setDraft] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const id = draft.trim();
    if (!/^\d+$/.test(id)) return;
    onAdd(id);
    setDraft("");
  }

  return (
    <aside className="sidebar">
      <div className="side-head">
        <div className="section-label">Portfolios</div>
      </div>

      <div className="side-list">
        {watched.length === 0 ? (
          <div className="empty">
            No portfolios tracked.
            <br />
            Add one by id below.
          </div>
        ) : (
          watched.map((w) => {
            const stage = stages[w.portfolioId];
            return (
              <button
                key={w.portfolioId}
                className={`side-item ${selected === w.portfolioId ? "selected" : ""}`}
                onClick={() => onSelect(w.portfolioId)}
                onAuxClick={(e) => {
                  if (e.button === 1) onRemove(w.portfolioId);
                }}
              >
                <div className="side-item-id num">#{w.portfolioId}</div>
                <div className="side-item-sub">
                  <span className={`dot ${STAGE_DOT[stage ?? ""] ?? "idle"}`} />
                  {stage ?? "loading…"}
                </div>
              </button>
            );
          })
        )}
      </div>

      <div className="side-foot">
        <form onSubmit={submit} className="field-row">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Portfolio id"
            inputMode="numeric"
            aria-label="Portfolio id to track"
          />
          <button type="submit" disabled={!/^\d+$/.test(draft.trim())}>
            Track
          </button>
        </form>
      </div>
    </aside>
  );
}
