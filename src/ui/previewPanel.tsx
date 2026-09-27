// src/ui/previewPanel.tsx
// The preview panel (AC46–AC53, AC61, AC66, AC68, AC70) and the pending-removals
// stack, rendered into one body-level React root. A pure consumer of controller
// calls: it renders a PanelView and calls back through PreviewPanelDeps. No
// Spicetify.Player, no PopupModal (spec: Layering, spike p1).
import React from "react";
import type { PanelPort, PanelView, ProgressMode } from "../types/domain";
import type { PendingRemovalEntry } from "../pendingRemovals";
import { panelKeyAction, panelPlacement, PANEL_KEYS, type PanelPlacement } from "./previewPanel.view";
import { PendingRemovalsStack, tertiaryClass } from "./pendingRemovalsStack";
import "./previewPanel.css";

export interface PreviewPanelDeps {
  onStop(): void;
  onClose(): void;
  onNext(): void;
  onRemove(): void;
  /** Live fraction 0..1, polled per animation frame while view.progress === "live". */
  progress(): number;
  removals: {
    list(): PendingRemovalEntry[];
    subscribe(l: () => void): () => void;
    undo(handle: number): boolean;
  };
}

const ROOT_ID = "tpp-preview-root";
const PLAYBAR = ".Root__now-playing-bar";
const GLOBAL_NAV = ".Root__globalNav";

/** Measures the Playbar and global nav, then applies the placement rule (spec: Layering → Placement). */
function measurePlacement(): PanelPlacement {
  const bar = document.querySelector(PLAYBAR)?.getBoundingClientRect() ?? null;
  const nav = document.querySelector(GLOBAL_NAV)?.getBoundingClientRect() ?? null;
  return panelPlacement({ bar, nav, innerWidth: window.innerWidth, innerHeight: window.innerHeight });
}

function Icon(props: { name: Spicetify.Icon }): React.ReactElement {
  // A missing key renders an empty svg rather than throwing.
  const markup = (Spicetify.SVGIcons as Partial<Record<string, string>>)[props.name] ?? "";
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="currentColor"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}

// SVGIcons has no `stop` icon (spec: Icons), so Stop is a hand-written square.
function StopIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
      <rect x="3" y="3" width="10" height="10" />
    </svg>
  );
}

function Artwork(props: { url: string | null }): React.ReactElement {
  const [failed, setFailed] = React.useState(false);
  if (props.url === null || failed) {
    return <div className="tpp-panel-artwork tpp-panel-artwork-placeholder" aria-hidden="true" />;
  }
  return <img className="tpp-panel-artwork" src={props.url} alt="" onError={() => setFailed(true)} />;
}

function toPercent(fraction: number): string {
  const clamped = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  return `${clamped * 100}%`;
}

function ProgressBar(props: { mode: ProgressMode; progress: () => number }): React.ReactElement {
  const { mode, progress } = props;
  const fillRef = React.useRef<HTMLDivElement>(null);

  // The width is driven only through the ref, never a style prop: the "live"
  // loop writes the DOM directly, so a style prop would diff against a stale
  // committed value and leave the bar frozen on live → empty (AC53/AC61).
  // Layout effect, so the first paint already has the right width.
  React.useLayoutEffect(() => {
    const write = (fraction: number): void => {
      if (fillRef.current) fillRef.current.style.width = toPercent(fraction);
    };
    if (mode !== "live") {
      write(mode === "full" ? 1 : 0);
      return;
    }
    let frame = 0;
    const tick = (): void => {
      write(progress());
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [mode, progress]);

  return (
    <div className="tpp-panel-progress" aria-hidden="true">
      <div ref={fillRef} className="tpp-panel-progress-fill" />
    </div>
  );
}

function Panel(props: {
  view: PanelView;
  focusSeq: number;
  focusedSeq: React.MutableRefObject<number>;
  deps: PreviewPanelDeps;
}): React.ReactElement {
  const { view, focusSeq, focusedSeq, deps } = props;
  const sectionRef = React.useRef<HTMLElement>(null);

  // AC66: focus on every open() (focusSeq bumps), including a replacement;
  // update() leaves focusSeq alone, so it never moves focus.
  React.useEffect(() => {
    if (focusSeq === focusedSeq.current) return;
    focusedSeq.current = focusSeq;
    sectionRef.current?.focus({ preventScroll: true });
  }, [focusSeq, focusedSeq]);

  function onKeyDown(e: React.KeyboardEvent<HTMLElement>): void {
    if (!PANEL_KEYS.has(e.key)) return;
    // Consumed even when the action is a no-op, so it never reaches Spotify.
    e.preventDefault();
    e.stopPropagation();
    switch (panelKeyAction({ key: e.key, repeat: e.repeat }, view)) {
      case "next":
        deps.onNext();
        break;
      case "remove":
        deps.onRemove();
        break;
      case "close":
        deps.onClose();
        break;
      case null:
        break;
    }
  }

  const buttonClass = tertiaryClass();
  return (
    <section ref={sectionRef} className="tpp-panel" tabIndex={-1} aria-label="Preview" onKeyDown={onKeyDown}>
      <div className="tpp-panel-header">
        <button
          type="button"
          className={`${buttonClass} tpp-panel-close`}
          aria-label="Close preview"
          onClick={() => deps.onClose()}
        >
          <Icon name="x" />
        </button>
      </div>
      <Artwork key={view.artworkUrl ?? ""} url={view.artworkUrl} />
      <div className="tpp-panel-heading">{view.heading}</div>
      <div className="tpp-panel-source">{view.sourceText}</div>
      {view.indicator !== null && <div className="tpp-panel-indicator">{view.indicator}</div>}
      <ProgressBar mode={view.progress} progress={deps.progress} />
      <div className="tpp-panel-controls">
        <button type="button" className={`${buttonClass} tpp-panel-button`} onClick={() => deps.onStop()}>
          <StopIcon />
          <span>Stop</span>
        </button>
        <button
          type="button"
          className={`${buttonClass} tpp-panel-button`}
          disabled={view.nextDisabled}
          onClick={() => deps.onNext()}
        >
          <Icon name="skip-forward" />
          <span>Next</span>
        </button>
        {view.removeLabel !== null && (
          <button
            type="button"
            className={`${buttonClass} tpp-panel-button tpp-panel-remove`}
            aria-label={view.removeLabel}
            onClick={() => deps.onRemove()}
          >
            <Icon name="minus" />
            <span>Remove</span>
          </button>
        )}
      </div>
    </section>
  );
}

interface PanelState {
  view: PanelView | null;
  /** Bumped by every open(); Panel focuses itself when it changes. */
  focusSeq: number;
}

function createStore(initial: PanelState) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: (): PanelState => state,
    set(next: PanelState): void {
      state = next;
      for (const l of listeners) l();
    },
    subscribe(l: () => void): () => void {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
  };
}

type Store = ReturnType<typeof createStore>;

function PreviewRoot(props: { store: Store; deps: PreviewPanelDeps }): React.ReactElement {
  const { store, deps } = props;
  const [state, setState] = React.useState<PanelState>(() => store.get());
  // Survives Panel unmount, so a close → update() never counts as a focus request.
  const focusedSeq = React.useRef(0);

  React.useEffect(() => {
    setState(store.get()); // catch a set() between first render and subscribe
    return store.subscribe(() => setState(store.get()));
  }, [store]);

  return (
    <>
      <PendingRemovalsStack removals={deps.removals} />
      {state.view !== null && (
        <Panel view={state.view} focusSeq={state.focusSeq} focusedSeq={focusedSeq} deps={deps} />
      )}
    </>
  );
}

export function createPreviewPanel(deps: PreviewPanelDeps): PanelPort {
  let host = document.getElementById(ROOT_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = ROOT_ID;
    document.body.appendChild(host);
  }
  const rootEl = host;

  const store = createStore({ view: null, focusSeq: 0 });
  // Spike p1: createRoot is the render API (not ReactDOM.render).
  Spicetify.ReactDOM.createRoot(rootEl).render(<PreviewRoot store={store} deps={deps} />);

  return {
    open(view: PanelView): void {
      // Placement is measured per open(); the stack's anchor derives from it in CSS.
      const place = measurePlacement();
      rootEl.style.setProperty("--tpp-panel-right", `${place.rightPx}px`);
      rootEl.style.setProperty("--tpp-panel-bottom", `${place.bottomPx}px`);
      rootEl.style.setProperty("--tpp-top-clearance", `${place.topClearancePx}px`);
      const s = store.get();
      store.set({ view, focusSeq: s.focusSeq + 1 });
    },
    update(view: PanelView): void {
      store.set({ ...store.get(), view });
    },
    close(): void {
      // AC51: a controller-driven close never calls onClose / onStop.
      store.set({ ...store.get(), view: null });
    },
  };
}
