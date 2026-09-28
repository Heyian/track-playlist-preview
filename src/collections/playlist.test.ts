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

  it("AC59: artworkUrl comes from album.images", async () => {
    const all = [track("a", { album: { images: [{ url: "spotify:image:std", label: "standard" }] } })];
    expect((await enumeratePlaylistContents("spotify:playlist:p", pagedApi(all, 100)))[0]!.artworkUrl).toBe("spotify:image:std");
  });

  it("AC59: no album images → artworkUrl undefined", async () => {
    expect((await enumeratePlaylistContents("spotify:playlist:p", pagedApi([track("a")], 100)))[0]!.artworkUrl).toBeUndefined();
  });

  function recordingApi(all: RawTrackItem[]) {
    const calls: Record<string, unknown>[] = [];
    const api: PlaylistContentsApi = {
      async getContents(_uri, options) {
        calls.push({ ...options });
        return { items: all.slice(options.offset, options.offset + options.limit), totalLength: all.length };
      },
    };
    return { api, calls };
  }

  it("V1/V19: sends the same sort on every page and keeps every entry, duplicates included", async () => {
    const all = Array.from({ length: 250 }, (_, i) => track(`t${i % 200}`)); // t0..t49 appear twice
    const { api, calls } = recordingApi(all);
    const refs = await enumeratePlaylistContents("spotify:playlist:p", api, { sort: { field: "TITLE", order: "ASC" } });
    expect(refs).toHaveLength(250);
    expect(calls).toHaveLength(3);
    for (const c of calls) expect(c.sort).toEqual({ field: "TITLE", order: "ASC" });
  });

  it("V6: sends the filter on every page", async () => {
    const { api, calls } = recordingApi(Array.from({ length: 150 }, (_, i) => track(`t${i}`)));
    await enumeratePlaylistContents("spotify:playlist:p", api, { filter: "live" });
    expect(calls.map((c) => c.filter)).toEqual(["live", "live"]);
  });

  it("V2: omits sort and filter keys when no view is given or the view is empty", async () => {
    for (const view of [undefined, {}]) {
      const { api, calls } = recordingApi([track("a")]);
      await enumeratePlaylistContents("spotify:playlist:p", api, view);
      expect(Object.keys(calls[0]!).sort()).toEqual(["limit", "offset"]);
    }
  });

  it("V9: sorted results drop ineligible leading entries and keep order", async () => {
    const all = [track("gone", { isPlayable: false, name: "" }), track("b"), track("a")];
    const { api } = recordingApi(all);
    const refs = await enumeratePlaylistContents("spotify:playlist:p", api, { sort: { field: "TITLE" } });
    expect(refs.map((r) => r.uri)).toEqual(["spotify:track:b", "spotify:track:a"]);
  });
});
