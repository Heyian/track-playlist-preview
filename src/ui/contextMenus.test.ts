import { describe, it, expect, vi, beforeEach } from "vitest";
import { createContextMenus, type ContextMenuDeps } from "./contextMenus";

type OnClick = (uris: string[], uids: string[] | undefined, contextUri: string | null | undefined) => void;

// Captures every ContextMenu.Item built by register(), keyed by its label.
let items: Map<string, OnClick>;

beforeEach(() => {
  items = new Map();
  class Item {
    constructor(name: string, onClick: OnClick) {
      items.set(name, onClick);
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
