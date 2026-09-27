import { describe, it, expect } from "vitest";
import { enumerateArtist, type ArtistOverviewApi } from "./artist";

function overview(
  tracks: {
    uri: string;
    name: string;
    artist: string;
    sources?: { url?: string }[];
  }[],
) {
  return {
    data: {
      artistUnion: {
        discography: {
          topTracks: {
            items: tracks.map((t) => ({
              track: {
                uri: t.uri,
                name: t.name,
                artists: { items: [{ profile: { name: t.artist } }] },
                playability: { playable: true },
                ...(t.sources && {
                  albumOfTrack: { coverArt: { sources: t.sources } },
                }),
              },
            })),
          },
        },
      },
    },
  };
}

describe("enumerateArtist", () => {
  it("AC5: returns each supplied top track once, in response order, no fixed count", async () => {
    const tracks = [
      { uri: "spotify:track:1", name: "One", artist: "Band" },
      { uri: "spotify:track:2", name: "Two", artist: "Band" },
    ];
    const request: ArtistOverviewApi = async () => overview(tracks);
    const refs = await enumerateArtist("spotify:artist:x", request);
    expect(refs).toEqual([
      { uri: "spotify:track:1", name: "One", artist: "Band" },
      { uri: "spotify:track:2", name: "Two", artist: "Band" },
    ]);
  });

  it("returns [] when the artist has no top tracks", async () => {
    const request: ArtistOverviewApi = async () => overview([]);
    expect(await enumerateArtist("spotify:artist:x", request)).toEqual([]);
  });

  it("AC6: drops entries flagged unplayable", async () => {
    const raw = overview([{ uri: "spotify:track:1", name: "One", artist: "Band" }]);
    raw.data.artistUnion.discography.topTracks.items[0]!.track.playability.playable = false;
    const request: ArtistOverviewApi = async () => raw;
    expect(await enumerateArtist("spotify:artist:x", request)).toEqual([]);
  });

  it("AC59: artworkUrl is the first coverArt source", async () => {
    const tracks = [
      { uri: "spotify:track:1", name: "One", artist: "Band", sources: [{ url: "https://i.scdn.co/image/a" }, { url: "https://i.scdn.co/image/b" }] },
    ];
    const request: ArtistOverviewApi = async () => overview(tracks);
    const refs = await enumerateArtist("spotify:artist:x", request);
    expect(refs[0]!.artworkUrl).toBe("https://i.scdn.co/image/a");
  });

  it("AC59: missing coverArt → artworkUrl undefined", async () => {
    const tracks = [{ uri: "spotify:track:1", name: "One", artist: "Band" }];
    const request: ArtistOverviewApi = async () => overview(tracks);
    const refs = await enumerateArtist("spotify:artist:x", request);
    expect(refs[0]!.artworkUrl).toBeUndefined();
  });
});
