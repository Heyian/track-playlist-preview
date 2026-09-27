import { describe, it, expect, vi, beforeEach } from "vitest";
import { createContextMenus, type ContextMenuDeps } from "./contextMenus";

type OnClick = (uris: string[], uids: string[] | undefined, contextUri: string | null | undefined) => void;

// Captures every ContextMenu.Item built by register(), keyed by its label.
let items: Map<string, OnClick>;
// Every Item instance in construction order; `name` is mutable like the real setter.
let built: { name: string }[];

beforeEach(() => {
  items = new Map();
  built = [];
  class Item {
    name: string;
    constructor(name: string, onClick: OnClick) {
      this.name = name;
      items.set(name, onClick);
      built.push(this);
    }
    register(): void {}
  }
  (globalThis as unknown as { Spicetify: unknown }).Spicetify = {
    ContextMenu: { Item },
    URI: { isTrack: (u: string) => u.startsWith("spotify:track:") },
  };
});

function deps(overrides: Partial<ContextMenuDeps> = {}): ContextMenuDeps {
  return {
    collectionTypeForUri: () => "playlist",
    isEnabled: () => true,
    onPreviewCollection: vi.fn(),
    onPreviewTrack: vi.fn(),
    onPreviewFromHere: vi.fn(),
    getDurationMs: () => 15000,
    currentCollectionUri: () => null,
    onSettingsChange: () => () => {},
    ...overrides,
  };
}

describe("Preview from here", () => {
  it("AC36/R4: passes the menu's contextUri when the client supplies one", () => {
    const d = deps({ currentCollectionUri: () => "spotify:playlist:page" });
    createContextMenus(d).register();
    items.get("Preview from here")!(["spotify:track:t"], undefined, "spotify:playlist:ctx");
    expect(d.onPreviewFromHere).toHaveBeenCalledWith("spotify:track:t", "spotify:playlist:ctx");
  });

  it("AC36/R4: falls back to the current page's collection when contextUri is null (live track rows)", () => {
    const d = deps({ currentCollectionUri: () => "spotify:playlist:page" });
    createContextMenus(d).register();
    items.get("Preview from here")!(["spotify:track:t"], ["uid"], null);
    expect(d.onPreviewFromHere).toHaveBeenCalledWith("spotify:track:t", "spotify:playlist:page");
  });

  it("AC37: off a collection page with no contextUri, passes no context", () => {
    const d = deps();
    createContextMenus(d).register();
    items.get("Preview from here")!(["spotify:track:t"], undefined, null);
    expect(d.onPreviewFromHere).toHaveBeenCalledWith("spotify:track:t", undefined);
  });
});

describe("Preview track label (S13)", () => {
  function setup() {
    let duration = 15000;
    let listener: () => void = () => {};
    const d = deps({
      getDurationMs: () => duration,
      onSettingsChange: (l) => {
        listener = l;
        return () => {};
      },
    });
    createContextMenus(d).register();
    const [, previewTrack, previewFromHere] = built;
    return {
      previewTrack: previewTrack!,
      previewFromHere: previewFromHere!,
      change: (ms: number) => {
        duration = ms;
        listener();
      },
      notify: () => listener(),
    };
  }

  it("follows the duration setting without re-registering", () => {
    const m = setup();
    expect(m.previewTrack.name).toBe("Preview track (15s)");
    m.change(10000);
    expect(m.previewTrack.name).toBe("Preview track (10s)");
    m.change(10500);
    expect(m.previewTrack.name).toBe("Preview track (11s)");
    expect(m.previewFromHere.name).toBe("Preview from here");
  });

  it("stays put when a change leaves the duration alone", () => {
    const m = setup();
    m.notify();
    expect(m.previewTrack.name).toBe("Preview track (15s)");
  });
});
