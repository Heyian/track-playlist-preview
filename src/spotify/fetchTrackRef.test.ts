import { describe, it, expect, beforeEach, vi } from "vitest";
import { parseGetTrack, fetchTrackRef } from "./fetchTrackRef";

describe("AC69: Single-track metadata via getTrack", () => {
  describe("parseGetTrack", () => {
    it("AC69: parses name, joined artists and artwork", () => {
      const res = {
        data: {
          trackUnion: {
            name: "Song",
            firstArtist: { items: [{ profile: { name: "A" } }] },
            otherArtists: { items: [{ profile: { name: "B" } }] },
            albumOfTrack: {
              coverArt: {
                sources: [{ url: "https://i.scdn.co/image/x", width: 300, height: 300 }],
              },
            },
          },
        },
      };
      expect(parseGetTrack("spotify:track:1", res)).toEqual({
        uri: "spotify:track:1",
        name: "Song",
        artist: "A, B",
        artworkUrl: "https://i.scdn.co/image/x",
      });
    });

    it("AC69: no name → null", () => {
      expect(parseGetTrack("spotify:track:1", { data: {} })).toBeNull();
    });
  });

  describe("fetchTrackRef", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("AC69: a failed lookup falls back to the URI label, empty artist, no artwork", async () => {
      (globalThis as any).Spicetify = {
        GraphQL: {
          Definitions: { getTrack: {} },
          Request: vi.fn(async () => {
            throw new Error("x");
          }),
        },
      };
      const ref = await fetchTrackRef("spotify:track:abc");
      expect(ref).toEqual({ uri: "spotify:track:abc", name: "abc", artist: "" });
      expect(ref.artworkUrl).toBeUndefined();
    });
  });
});
