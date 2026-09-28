// src/ui/panelHost.ts
// The preview panel's body-level host: element, React root and placement
// subscription, and their teardown on unload (U16, U17). React-free so it can
// be tested; previewPanel.tsx supplies the React mount.

export const ROOT_ID = "tpp-preview-root";

export interface PanelHostDeps {
  /** Creates the React root on `host` and renders into it. */
  mount(host: HTMLElement): { unmount(): void };
  onSettingsChange(listener: () => void): () => void;
  /** Writes placement to `host`; also called on every settings change. */
  place(host: HTMLElement): void;
}

export function mountPanelHost(deps: PanelHostDeps): { host: HTMLElement; dispose(): void } {
  let host = document.getElementById(ROOT_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = ROOT_ID;
    document.body.appendChild(host);
  }
  const el = host;
  const root = deps.mount(el);
  // Re-place on every settings change, open or closed (panel-position spec, D3).
  const unsubscribe = deps.onSettingsChange(() => deps.place(el));
  let disposed = false;

  return {
    host: el,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      root.unmount();
      el.remove();
    },
  };
}
