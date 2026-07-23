import { describe, it, expect } from "vitest";
import { enumeratePlaylistContents, type PlaylistContentsApi } from "./playlist";
import type { RawTrackItem } from "./eligibility";

function track(id: string, extra: Partial<RawTrackItem> = {}): RawTrackItem {
  return { uri: `spotify:track:${id}`, type: "track", name: id, isLocal: false, isPlayable: true, artists: [{ name: "A" }], ...extra };
}

/** Serves `all` in pages of `pageSize`, reporting totalLength. */
function pagedApi(all: RawTrackItem[], pageSize: number): PlaylistContentsApi {
  return {
    async getContents(_uri, { limit, offset }) {
      const items = all.slice(offset, offset + Math.min(limit, pageSize));
      return { items, totalLength: all.length };
    },
  };
}

describe("enumeratePlaylistContents", () => {
  it("AC1: preserves stored order and returns one ref per eligible track", async () => {
    const all = [track("a"), track("b"), track("c")];
    const refs = await enumeratePlaylistContents("spotify:playlist:p", pagedApi(all, 100));
    expect(refs.map((r) => r.uri)).toEqual(all.map((t) => t.uri));
    expect(refs[0]).toEqual({ uri: "spotify:track:a", name: "a", artist: "A" });
  });

  it("AC2: paginates a >100-track collection and returns every eligible track", async () => {
    const all = Array.from({ length: 397 }, (_, i) => track(`t${i}`));
    const refs = await enumeratePlaylistContents("spotify:playlist:big", pagedApi(all, 100));
    expect(refs).toHaveLength(397);
    expect(refs.map((r) => r.uri)).toEqual(all.map((t) => t.uri));
  });

  it("AC6: excludes episodes, local files, and unplayable entries", async () => {
    const all = [
      track("ok"),
      { uri: "spotify:episode:e", type: "episode", name: "pod" } as RawTrackItem,
      track("local", { isLocal: true }),
      track("gone", { isPlayable: false }),
    ];
    const refs = await enumeratePlaylistContents("spotify:playlist:mixed", pagedApi(all, 100));
    expect(refs.map((r) => r.uri)).toEqual(["spotify:track:ok"]);
  });

  it("AC4: returns album tracks in the API's returned (disc/track) order", async () => {
    const all = [track("d1t1"), track("d1t2"), track("d2t1")];
    const refs = await enumeratePlaylistContents("spotify:album:al", pagedApi(all, 100));
    expect(refs.map((r) => r.uri)).toEqual(all.map((t) => t.uri));
  });

  it("stops cleanly on a short final page", async () => {
    const all = Array.from({ length: 150 }, (_, i) => track(`t${i}`));
    const refs = await enumeratePlaylistContents("spotify:playlist:p", pagedApi(all, 100));
    expect(refs).toHaveLength(150);
  });
});
