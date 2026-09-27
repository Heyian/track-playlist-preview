// src/ui/pendingRemovalsStack.tsx
// Pending-removals stack (AC67): one row per pending removal, oldest first so
// the newest sits at the bottom, nearest the panel. Renders nothing when empty.
// Positioned by previewPanel.css; always mounted, whether the panel is open or not.
import React from "react";
import type { PendingRemovalEntry } from "../pendingRemovals";
import type { PreviewPanelDeps } from "./previewPanel";

/** Button classes come from a live encore sibling — never a hardcoded e-NNNNN class. */
export function tertiaryClass(): string {
  return document.querySelector('[data-encore-id="buttonTertiary"]')?.className ?? "";
}

export function PendingRemovalsStack(props: { removals: PreviewPanelDeps["removals"] }): React.ReactElement | null {
  const { removals } = props;
  const [entries, setEntries] = React.useState<PendingRemovalEntry[]>(() => removals.list());

  React.useEffect(() => {
    // Re-read once on subscribe: an entry may have been added between the
    // initial render and this effect running.
    setEntries(removals.list());
    return removals.subscribe(() => setEntries(removals.list()));
  }, [removals]);

  // AC67: when a row is added and the stack overflows, keep the newest row
  // (the bottom one, nearest the panel) in view. Only on growth, so an Undo
  // doesn't jump the user's scroll position.
  const stackRef = React.useRef<HTMLDivElement>(null);
  const prevCount = React.useRef(0);
  React.useLayoutEffect(() => {
    const grew = entries.length > prevCount.current;
    prevCount.current = entries.length;
    const el = stackRef.current;
    if (grew && el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  if (entries.length === 0) return null;

  const buttonClass = tertiaryClass();
  return (
    <div ref={stackRef} className="tpp-removals-stack" role="status">
      {entries.map((e) => (
        <div key={e.handle} className="tpp-removals-row">
          <span className="tpp-removals-text">
            Removed {e.trackTitle} from {e.playlistName}
          </span>
          <button type="button" className={buttonClass} onClick={() => removals.undo(e.handle)}>
            Undo
          </button>
        </div>
      ))}
    </div>
  );
}
