import { describe, it, expect, vi } from "vitest";
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
  });
  it("returns [] for a non-collection URI", async () => {
    const d = deps();
    expect(await enumerate("spotify:track:x", d, (u) => collectionTypeForUri(u, matcher))).toEqual([]);
  });
});
