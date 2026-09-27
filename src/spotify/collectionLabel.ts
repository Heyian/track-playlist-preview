// src/spotify/collectionLabel.ts
// Resolves a collection URI to a display label for the panel's "From: <label>"
// line (AC48, AC64). Liked Songs is a constant, never looked up. Playlist and
// album names both come from PlaylistAPI.getMetadata (spike p4); artist comes
// from queryArtistOverview. Never rejects: any lookup failure, or a missing /
// empty / non-string name, falls back to the generic type label.
import type { CollectionType, PlaylistMetadataPort } from "../types/domain";
import type { ArtistOverviewApi } from "../collections/artist";

export const GENERIC_LABEL: Record<CollectionType, string> = {
  playlist: "Playlist",
  album: "Album",
  artist: "Artist",
  likedSongs: "Liked Songs",
};

interface CollectionLabelApis {
  playlistMetadata: PlaylistMetadataPort;
  artistOverview: ArtistOverviewApi;
}

export function createCollectionLabel(
  apis: CollectionLabelApis,
): (uri: string, type: CollectionType) => Promise<string> {
  return async (uri: string, type: CollectionType): Promise<string> => {
    if (type === "likedSongs") return GENERIC_LABEL.likedSongs;

    try {
      if (type === "artist") {
        const res = (await apis.artistOverview(uri)) as any;
        const name = res?.data?.artistUnion?.profile?.name;
        if (typeof name === "string" && name.length > 0) return name;
        return GENERIC_LABEL.artist;
      }

      // playlist and album both use PlaylistAPI.getMetadata (spike p4).
      const metadata = await apis.playlistMetadata(uri);
      const name = metadata?.name;
      if (typeof name === "string" && name.length > 0) return name;
      return GENERIC_LABEL[type];
    } catch {
      return GENERIC_LABEL[type];
    }
  };
}
