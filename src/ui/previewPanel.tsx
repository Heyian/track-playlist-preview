// src/ui/previewPanel.tsx
// The preview panel (AC46–AC53, AC61, AC66, AC68, AC70) and the pending-removals
// stack, rendered into one body-level React root, placed per Panel position
// (panel-position spec, P1–P20). A pure consumer of controller
// calls: it renders a PanelView and calls back through PreviewPanelDeps. No
// Spicetify.Player, no PopupModal (spec: Layering, spike p1). dispose() unmounts
// the root, removes the host and drops the placement subscription on unload
// (unload-teardown spec, U16/U17).
import React from "react";
import type { PanelPort, PanelPosition, PanelView, ProgressMode } from "../types/domain";
import type { PendingRemovalEntry } from "../pendingRemovals";
import { panelKeyAction, panelPlacement, placementStyle, PANEL_KEYS, type PanelPlacement } from "./previewPanel.view";
import { PendingRemovalsStack, tertiaryClass } from "./pendingRemovalsStack";
import { mountPanelHost } from "./panelHost";
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
  getPanelPosition(): PanelPosition;
  /** Subscribes to every settings change; returns an unsubscribe function. */
  onSettingsChange(listener: () => void): () => void;
}

const PLAYBAR = ".Root__now-playing-bar";
const GLOBAL_NAV = ".Root__globalNav";

/** Measures the Playbar and global nav now, then applies the position's placement rule (spec: Geometry). */
function measurePlacement(position: PanelPosition): PanelPlacement {
  const bar = document.querySelector(PLAYBAR)?.getBoundingClientRect() ?? null;
  const nav = document.querySelector(GLOBAL_NAV)?.getBoundingClientRect() ?? null;
  return panelPlacement({ position, bar, nav, innerWidth: window.innerWidth, innerHeight: window.innerHeight });
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

export type PreviewPanel = PanelPort & { dispose(): void };

/** Writes the measured placement to the host; never touches focus or the store (P12). */
function place(host: HTMLElement, position: PanelPosition): void {
  const style = placementStyle(measurePlacement(position));
  for (const [name, value] of Object.entries(style.vars)) host.style.setProperty(name, value);
  host.dataset.position = style.position;
  host.dataset.stack = style.stack;
}

export function createPreviewPanel(deps: PreviewPanelDeps): PreviewPanel {
  const store = createStore({ view: null, focusSeq: 0 });
  const { host, dispose } = mountPanelHost({
    mount(el) {
      // Spike p1: createRoot is the render API (not ReactDOM.render).
      const root = Spicetify.ReactDOM.createRoot(el);
      root.render(<PreviewRoot store={store} deps={deps} />);
      return root;
    },
    onSettingsChange: deps.onSettingsChange,
    place: (el) => place(el, deps.getPanelPosition()),
  });

  return {
    open(view: PanelView): void {
      // Placement is measured per open(); the stack's anchor derives from it in CSS.
      place(host, deps.getPanelPosition());
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
    dispose,
  };
}
