// Injects and maintains a single preview toggle in the collection action bar.
import type { CollectionType } from "../types/domain";

export interface ActionBarDeps {
  /** The current page's collection type if enabled in settings, else null. */
  isEnabledForCurrentPage(): CollectionType | null;
  /** True when a session is active for the given collection URI. */
  isActiveSession(uri: string): boolean;
  /** Start (or, if active on this URI, stop) a session for the URI. */
  onToggle(uri: string): void;
  /** The current page's collection URI, or null off a collection page. */
  currentUri(): string | null;
}

const BUTTON_ID = "tpp-action-bar-button";
const ROW = ".main-actionBar-ActionBarRow";
const TERTIARY = '[data-encore-id="buttonTertiary"]';

export function createActionBarButton(deps: ActionBarDeps) {
  function label(active: boolean): string {
    return active ? "Stop preview" : "Preview all";
  }

  function inject(): void {
    const type = deps.isEnabledForCurrentPage();
    const uri = deps.currentUri();
    const existing = document.getElementById(BUTTON_ID);

    // AC30: disabled type or off a collection page → ensure no button.
    if (!type || !uri) {
      existing?.remove();
      return;
    }
    // AC31: never duplicate — one button per row. Only write when the label
    // actually changes: an unconditional textContent assignment replaces the
    // child text node every call, and the body-wide observer below would see
    // that mutation and re-fire inject() in an infinite loop, freezing the tab.
    if (existing) {
      const desired = label(deps.isActiveSession(uri));
      if (existing.textContent !== desired) existing.textContent = desired;
      return;
    }

    const row = document.querySelector(ROW);
    const sibling = row?.querySelector(TERTIARY);
    // AC32: no row or no tertiary sibling → skip silently, retry next nav.
    if (!row || !sibling) return;

    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.className = sibling.className; // AC32: cloned, no encore string in source
    button.type = "button";
    button.textContent = label(deps.isActiveSession(uri));
    button.addEventListener("click", () => {
      const u = deps.currentUri();
      if (u) deps.onToggle(u); // AC34: toggles the active session
    });
    row.appendChild(button);
  }

  let started = false;
  let scheduled = false;

  // Coalesce a burst of DOM mutations into a single inject() on the next frame,
  // instead of running inject() synchronously on every mutation. This yields to
  // the renderer between passes and prevents a mutation storm on busy pages.
  function schedule(): void {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      inject();
    });
  }

  return {
    start(): void {
      if (started) return;
      started = true;
      inject();
      // Re-inject on SPA navigation and on late-rendering action bars.
      Spicetify.Platform.History.listen(schedule);
      const observer = new MutationObserver(schedule);
      observer.observe(document.body, { childList: true, subtree: true });
    },
    refresh(): void {
      inject();
    },
  };
}
