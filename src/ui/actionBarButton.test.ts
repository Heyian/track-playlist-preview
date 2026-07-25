// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createActionBarButton, type ActionBarDeps } from "./actionBarButton";

// Minimal Spicetify stub: only History.listen is touched by start().
beforeEach(() => {
  document.body.innerHTML = "";
  (globalThis as unknown as { Spicetify: unknown }).Spicetify = {
    Platform: { History: { listen: vi.fn() } },
  };
});

/** Build a collection page DOM with an action bar and a tertiary sibling. */
function renderActionBar(): void {
  const row = document.createElement("div");
  row.className = "main-actionBar-ActionBarRow";
  const tertiary = document.createElement("button");
  tertiary.setAttribute("data-encore-id", "buttonTertiary");
  tertiary.className = "encore-tertiary-cls";
  row.appendChild(tertiary);
  document.body.appendChild(row);
}

function deps(overrides: Partial<ActionBarDeps> = {}): ActionBarDeps {
  return {
    isEnabledForCurrentPage: () => "playlist",
    isActiveSession: () => false,
    onToggle: vi.fn(),
    currentUri: () => "spotify:playlist:x",
    ...overrides,
  };
}

/** Flush microtasks and any queued animation frames a bounded number of times. */
async function settle(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
}

describe("actionBarButton", () => {
  it("injects exactly one button on a collection page", () => {
    renderActionBar();
    const bar = createActionBarButton(deps());
    bar.refresh();
    expect(document.querySelectorAll("#tpp-action-bar-button")).toHaveLength(1);
    expect(document.getElementById("tpp-action-bar-button")!.className).toBe("encore-tertiary-cls");
  });

  it("re-injecting when nothing changed produces NO DOM mutation (no observer feedback loop)", async () => {
    renderActionBar();
    const bar = createActionBarButton(deps());
    bar.refresh(); // button now present and correct

    const records: MutationRecord[] = [];
    const spy = new MutationObserver((rs) => records.push(...rs));
    spy.observe(document.body, { childList: true, subtree: true, characterData: true });

    bar.refresh(); // redundant: state unchanged → must not touch the DOM
    await Promise.resolve();
    spy.disconnect();

    // The bug: `existing.textContent = label` replaces the text node every call,
    // which the real body-wide observer would see and re-fire on → infinite loop.
    expect(records).toHaveLength(0);
  });

  it("the live observer does not run away when the page mutates (bounded injects)", async () => {
    renderActionBar();
    let injects = 0;
    const bar = createActionBarButton(
      deps({
        // Count how often inject reads the current URI (once per inject()).
        currentUri: () => {
          injects++;
          return "spotify:playlist:x";
        },
      }),
    );
    bar.start(); // installs the body-wide observer
    injects = 0; // ignore the initial inject from start()

    // A single unrelated page mutation.
    document.body.appendChild(document.createElement("div"));
    await settle();

    // With the feedback loop, injecting the button mutates the DOM, which
    // re-fires the observer unboundedly. A correct implementation coalesces
    // and stays idempotent, so injects stay small.
    expect(injects).toBeLessThan(10);
  });
});
