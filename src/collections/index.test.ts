import { describe, it, expect, vi, type Mock } from "vitest";
import { collectionTypeForUri, enumerate, type UriMatcher, type CollectionDeps } from "./index";

const matcher: UriMatcher = {
  isPlaylistV1OrV2: (u) => u.startsWith("spotify:playlist:") || u.startsWith("spotify:user:"),
  isAlbum: (u) => u.startsWith("spotify:album:"),
  isArtist: (u) => u.startsWith("spotify:artist:"),
};

describe("collectionTypeForUri", () => {
  it("AC35: classifies a playlist URI (which parses as playlist-v2) as playlist", () => {
    expect(collectionTypeForUri("spotify:playlist:abc", matcher)).toBe("playlist");
  });
  it("classifies Liked Songs, album and artist URIs", () => {
    expect(collectionTypeForUri("spotify:collection:tracks", matcher)).toBe("likedSongs");
    expect(collectionTypeForUri("spotify:album:abc", matcher)).toBe("album");
    expect(collectionTypeForUri("spotify:artist:abc", matcher)).toBe("artist");
  });
  it("returns null for an unrelated URI", () => {
    expect(collectionTypeForUri("spotify:track:abc", matcher)).toBeNull();
  });
});

describe("enumerate", () => {
  function deps(): CollectionDeps {
    return {
      playlistApi: { getContents: vi.fn(async () => ({ items: [{ uri: "spotify:track:p", type: "track", name: "P", isPlayable: true, artists: [{ name: "A" }] }], totalLength: 1 })) },
      libraryApi: { getTracks: vi.fn(async () => ({ items: [{ uri: "spotify:track:l", type: "track", name: "L", isPlayable: true, artists: [{ name: "A" }] }], totalLength: 1 })) },
      artistOverview: vi.fn(async () => ({ data: { artistUnion: { discography: { topTracks: { items: [{ track: { uri: "spotify:track:a", name: "AA", artists: { items: [{ profile: { name: "A" } }] }, playability: { playable: true } } }] } } } } })),
      likedSongsPlaylistUri: vi.fn(() => null as string | null),
    };
  }

  it("routes playlist URIs to PlaylistAPI", async () => {
    const d = deps();
    const refs = await enumerate("spotify:playlist:p", d, (u) => collectionTypeForUri(u, matcher));
    expect(refs.map((r) => r.uri)).toEqual(["spotify:track:p"]);
    expect(d.playlistApi.getContents).toHaveBeenCalled();
  });
  it("routes album URIs to PlaylistAPI", async () => {
    const d = deps();
    await enumerate("spotify:album:x", d, (u) => collectionTypeForUri(u, matcher));
    expect(d.playlistApi.getContents).toHaveBeenCalled();
  });
  it("routes Liked Songs to LibraryAPI", async () => {
    const d = deps();
    const refs = await enumerate("spotify:collection:tracks", d, (u) => collectionTypeForUri(u, matcher));
    expect(refs.map((r) => r.uri)).toEqual(["spotify:track:l"]);
    expect(d.libraryApi.getTracks).toHaveBeenCalled();
  });
  it("routes artist URIs to the overview request", async () => {
    const d = deps();
    const refs = await enumerate("spotify:artist:x", d, (u) => collectionTypeForUri(u, matcher));
    expect(refs.map((r) => r.uri)).toEqual(["spotify:track:a"]);
    expect(d.artistOverview).toHaveBeenCalled();
  });
  it("returns [] for a non-collection URI", async () => {
    const d = deps();
    expect(await enumerate("spotify:track:x", d, (u) => collectionTypeForUri(u, matcher))).toEqual([]);
  });

  const VIEW = { sort: { field: "ADDED_AT", order: "DESC" as const }, filter: "live" };
  const classify = (u: string) => collectionTypeForUri(u, matcher);

  it("V1/V6: passes the view to getContents for a playlist", async () => {
    const d = deps();
    await enumerate("spotify:playlist:p", d, classify, VIEW);
    expect(d.playlistApi.getContents).toHaveBeenCalledWith("spotify:playlist:p", expect.objectContaining(VIEW));
  });

  it("V10: Liked Songs enumerates the internal playlist URI with the view and never calls LibraryAPI", async () => {
    const d = deps();
    (d.likedSongsPlaylistUri as Mock).mockReturnValue("spotify:playlist:liked");
    const refs = await enumerate("spotify:collection:tracks", d, classify, VIEW);
    expect(d.playlistApi.getContents).toHaveBeenCalledWith("spotify:playlist:liked", expect.objectContaining(VIEW));
    expect(d.libraryApi.getTracks).not.toHaveBeenCalled();
    expect(refs.map((r) => r.uri)).toEqual(["spotify:track:p"]);
  });

  it("V11: without an internal URI, Liked Songs uses LibraryAPI and ignores the view", async () => {
    const d = deps();
    await enumerate("spotify:collection:tracks", d, classify, VIEW);
    expect(d.libraryApi.getTracks).toHaveBeenCalledWith({ limit: 100, offset: 0 });
    expect(d.playlistApi.getContents).not.toHaveBeenCalled();
  });

  it("V13: album and artist requests ignore any view", async () => {
    const d = deps();
    await enumerate("spotify:album:x", d, classify, VIEW);
    expect(Object.keys((d.playlistApi.getContents as Mock).mock.calls[0]![1]).sort()).toEqual(["limit", "offset"]);
    await enumerate("spotify:artist:x", d, classify, VIEW);
    expect(d.artistOverview).toHaveBeenCalledWith("spotify:artist:x");
  });
});
