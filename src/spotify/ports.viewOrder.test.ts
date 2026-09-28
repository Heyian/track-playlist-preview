// @vitest-environment happy-dom
// src/spotify/ports.viewOrder.test.ts
// The view-order readers against a stubbed Spicetify global and a happy-dom body.
import { afterEach, describe, it, expect, vi } from "vitest";
import { likedSongsPlaylistUri, readSortedState, readFilterText, createCollectionDeps } from "./ports";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function stubLibrary(libraryApi: unknown): void {
  vi.stubGlobal("Spicetify", { Platform: { LibraryAPI: libraryApi } });
}

describe("likedSongsPlaylistUri", () => {
  it("V10/V11: likedSongsPlaylistUri accepts only a spotify:playlist: string", () => {
    stubLibrary({ _likedSongsUri: "spotify:playlist:abc" });
    expect(likedSongsPlaylistUri()).toBe("spotify:playlist:abc");
    for (const value of [undefined, 42, "spotify:collection:tracks"]) {
      stubLibrary({ _likedSongsUri: value });
      expect(likedSongsPlaylistUri()).toBeNull();
    }
    stubLibrary(undefined);
    expect(likedSongsPlaylistUri()).toBeNull();
  });

  it("createCollectionDeps binds the live Liked Songs reader", () => {
    stubLibrary({ _likedSongsUri: "spotify:playlist:abc" });
    expect(createCollectionDeps().likedSongsPlaylistUri()).toBe("spotify:playlist:abc");
  });
});

describe("readSortedState", () => {
  it('readSortedState returns LocalStorageAPI.getItem("sortedState")', () => {
    const getItem = vi.fn(() => ({ a: 1 }));
    vi.stubGlobal("Spicetify", { Platform: { LocalStorageAPI: { getItem } } });
    expect(readSortedState()).toEqual({ a: 1 });
    expect(getItem).toHaveBeenCalledWith("sortedState");
  });
});

describe("readFilterText", () => {
  it("V6: reads the filter box inside the main view", () => {
    document.body.innerHTML = '<div class="main-view-container"><input class="x-filterBox-filterInput" value="live"></div>';
    expect(readFilterText()).toBe("live");
  });

  it("V8: no main-view filter box → null", () => {
    expect(readFilterText()).toBeNull();
  });

  it("V8a: ignores a filter box outside .main-view-container", () => {
    document.body.innerHTML = '<nav><input class="x-filterBox-filterInput" value="lib"></nav><div class="main-view-container"></div>';
    expect(readFilterText()).toBeNull();
  });
});
