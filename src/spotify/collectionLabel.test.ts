import { describe, it, expect, vi } from "vitest";
import { createCollectionLabel } from "./collectionLabel";

describe("AC48/AC64: collection display label", () => {
  it("AC48: Liked Songs is the constant label, no lookup", async () => {
    const apis = { playlistMetadata: vi.fn(), artistOverview: vi.fn() };
    expect(await createCollectionLabel(apis)("spotify:collection:tracks", "likedSongs")).toBe(
      "Liked Songs",
    );
    expect(apis.playlistMetadata).not.toHaveBeenCalled();
    expect(apis.artistOverview).not.toHaveBeenCalled();
  });

  it("uses the playlist's metadata name", async () => {
    const apis = {
      playlistMetadata: vi.fn(async () => ({ name: "Chill Mix" })),
      artistOverview: vi.fn(),
    };
    expect(await createCollectionLabel(apis)("spotify:playlist:1", "playlist")).toBe("Chill Mix");
  });

  it("uses the playlist's metadata name for an album too", async () => {
    const apis = {
      playlistMetadata: vi.fn(async () => ({ name: "Papaoutai (Afro Soul)" })),
      artistOverview: vi.fn(),
    };
    expect(await createCollectionLabel(apis)("spotify:album:1", "album")).toBe(
      "Papaoutai (Afro Soul)",
    );
  });

  it("uses the artist profile name", async () => {
    const apis = {
      playlistMetadata: vi.fn(),
      artistOverview: vi.fn(async () => ({ data: { artistUnion: { profile: { name: "Band" } } } })),
    };
    expect(await createCollectionLabel(apis)("spotify:artist:1", "artist")).toBe("Band");
  });

  it("AC64: rejected / empty / non-string name → generic type label", async () => {
    const rejecting = {
      playlistMetadata: vi.fn(async () => {
        throw new Error("boom");
      }),
      artistOverview: vi.fn(),
    };
    expect(await createCollectionLabel(rejecting)("spotify:playlist:1", "playlist")).toBe(
      "Playlist",
    );

    const emptyName = {
      playlistMetadata: vi.fn(async () => ({ name: "" })),
      artistOverview: vi.fn(),
    };
    expect(await createCollectionLabel(emptyName)("spotify:playlist:1", "playlist")).toBe(
      "Playlist",
    );

    const nonStringName = {
      playlistMetadata: vi.fn(async () => ({ name: 42 })),
      artistOverview: vi.fn(),
    };
    expect(await createCollectionLabel(nonStringName)("spotify:playlist:1", "playlist")).toBe(
      "Playlist",
    );

    const albumRejecting = {
      playlistMetadata: vi.fn(async () => {
        throw new Error("boom");
      }),
      artistOverview: vi.fn(),
    };
    expect(await createCollectionLabel(albumRejecting)("spotify:album:1", "album")).toBe("Album");

    const artistRejecting = {
      playlistMetadata: vi.fn(),
      artistOverview: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    expect(await createCollectionLabel(artistRejecting)("spotify:artist:1", "artist")).toBe(
      "Artist",
    );
  });
});
