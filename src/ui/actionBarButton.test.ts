// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createActionBarButton, type ActionBarDeps } from "./actionBarButton";

// Minimal Spicetify stub: only History.listen is touched by start().
let unlisten: ReturnType<typeof vi.fn>;
let historyListener: (() => void) | null;
beforeEach(() => {
  document.body.innerHTML = "";
  unlisten = vi.fn();
  historyListener = null;
  (globalThis as unknown as { Spicetify: unknown }).Spicetify = {
    Platform: {
      History: {
        listen: vi.fn((l: () => void) => {
          historyListener = l;
          return unlisten;
        }),
      },
    },
  };
});

// Every bar a test creates is stopped afterwards: a started bar's body-wide
// observer would otherwise outlive its test and inject into the next one.
const live: ReturnType<typeof createActionBarButton>[] = [];
function createBar(d: ActionBarDeps): ReturnType<typeof createActionBarButton> {
  const bar = createActionBarButton(d);
  live.push(bar);
  return bar;
}
afterEach(() => {
  for (const bar of live.splice(0)) bar.stop();
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
    const bar = createBar(deps());
    bar.refresh();
    expect(document.querySelectorAll("#tpp-action-bar-button")).toHaveLength(1);
    expect(document.getElementById("tpp-action-bar-button")!.className).toBe("encore-tertiary-cls");
  });

  it("re-injecting when nothing changed produces NO DOM mutation (no observer feedback loop)", async () => {
    renderActionBar();
    const bar = createBar(deps());
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
    const bar = createBar(
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

describe("stop (U10–U13)", () => {
  const buttons = () => document.querySelectorAll("#tpp-action-bar-button").length;

  it("U10: stop removes the button and calls the History unlisten", () => {
    renderActionBar();
    const bar = createBar(deps());
    bar.start();
    expect(buttons()).toBe(1);
    bar.stop();
    expect(buttons()).toBe(0);
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("U11: after stop, DOM mutations and navigations never re-add the button", async () => {
    renderActionBar();
    const bar = createBar(deps());
    bar.start();
    bar.stop();
    document.querySelector(".main-actionBar-ActionBarRow")!.remove();
    renderActionBar();
    historyListener?.();
    await settle();
    expect(buttons()).toBe(0);
  });

  it("U12: a frame queued before stop injects nothing", async () => {
    const bar = createBar(deps());
    bar.start(); // no action bar yet: nothing injected
    renderActionBar();
    historyListener!(); // a navigation queues inject() for the next frame
    bar.stop();
    await settle();
    expect(buttons()).toBe(0);
  });

  it("U13: stop then start works again", async () => {
    renderActionBar();
    const bar = createBar(deps());
    bar.start();
    bar.stop();
    bar.start();
    await settle();
    expect(buttons()).toBe(1);

    document.querySelector(".main-actionBar-ActionBarRow")!.remove();
    bar.stop();
    bar.start();
    renderActionBar(); // the row renders later
    await settle();
    expect(buttons()).toBe(1);
  });

  it("U30: stop disconnects the observer", () => {
    const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
    const bar = createBar(deps());
    bar.start();
    bar.stop();
    expect(disconnect).toHaveBeenCalled();
    disconnect.mockRestore();
  });

  it("Review Focus 3: stop before start does not throw", () => {
    const bar = createBar(deps());
    expect(() => bar.stop()).not.toThrow();
  });
});
