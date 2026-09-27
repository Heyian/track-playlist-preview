import { describe, it, expect } from "vitest";
import { enumerateLikedSongs, type LibraryApi } from "./likedSongs";
import type { RawTrackItem } from "./eligibility";

function track(id: string, extra: Partial<RawTrackItem> = {}): RawTrackItem {
  return { uri: `spotify:track:${id}`, type: "track", name: id, isLocal: false, isPlayable: true, artists: [{ name: "A" }], ...extra };
}

function pagedLibrary(all: RawTrackItem[], pageSize: number): LibraryApi {
  return {
    async getTracks({ limit, offset }) {
      return { items: all.slice(offset, offset + Math.min(limit, pageSize)), totalLength: all.length };
    },
  };
}

describe("enumerateLikedSongs", () => {
  it("AC3: returns every eligible track URI in the API's response order", async () => {
    const all = Array.from({ length: 220 }, (_, i) => track(`t${i}`));
    const refs = await enumerateLikedSongs(pagedLibrary(all, 100));
    expect(refs).toHaveLength(220);
    expect(refs.map((r) => r.uri)).toEqual(all.map((t) => t.uri));
  });

  it("AC6: excludes local and unplayable entries from Liked Songs", async () => {
    const all = [track("ok"), track("local", { isLocal: true }), track("gone", { isPlayable: false })];
    const refs = await enumerateLikedSongs(pagedLibrary(all, 100));
    expect(refs.map((r) => r.uri)).toEqual(["spotify:track:ok"]);
  });

  it("AC59: artworkUrl comes from album.images", async () => {
    const all = [track("a", { album: { images: [{ url: "spotify:image:std", label: "standard" }] } })];
    expect((await enumerateLikedSongs(pagedLibrary(all, 100)))[0]!.artworkUrl).toBe("spotify:image:std");
  });

  it("AC59: no album images → artworkUrl undefined", async () => {
    expect((await enumerateLikedSongs(pagedLibrary([track("a")], 100)))[0]!.artworkUrl).toBeUndefined();
  });
});
