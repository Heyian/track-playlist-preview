import type { TrackRef, CollectionType, ViewOptions } from "../types/domain";
import { enumeratePlaylistContents, type PlaylistContentsApi } from "./playlist";
import { enumerateLikedSongs, type LibraryApi } from "./likedSongs";
import { enumerateArtist, type ArtistOverviewApi } from "./artist";

export const LIKED_SONGS_URI = "spotify:collection:tracks";

/** The three URI predicates this module needs; injectable for testing. */
export interface UriMatcher {
  isPlaylistV1OrV2(uri: string): boolean;
  isAlbum(uri: string): boolean;
  isArtist(uri: string): boolean;
}

export interface CollectionDeps {
  playlistApi: PlaylistContentsApi;
  libraryApi: LibraryApi;
  artistOverview: ArtistOverviewApi;
  /** Liked Songs' internal `spotify:playlist:` URI, or null when unavailable (V10, V11). */
  likedSongsPlaylistUri(): string | null;
}

export function collectionTypeForUri(uri: string, matcher: UriMatcher): CollectionType | null {
  if (uri === LIKED_SONGS_URI) return "likedSongs";
  if (matcher.isPlaylistV1OrV2(uri)) return "playlist";
  if (matcher.isAlbum(uri)) return "album";
  if (matcher.isArtist(uri)) return "artist";
  return null;
}

export async function enumerate(
  uri: string,
  deps: CollectionDeps,
  classify: (uri: string) => CollectionType | null,
  view?: ViewOptions,
): Promise<TrackRef[]> {
  switch (classify(uri)) {
    case "playlist":
      return enumeratePlaylistContents(uri, deps.playlistApi, view);
    case "album":
      return enumeratePlaylistContents(uri, deps.playlistApi);
    case "likedSongs": {
      // LibraryAPI.getTracks cannot sort or filter, so the view needs the internal playlist URI.
      const internalUri = deps.likedSongsPlaylistUri();
      if (internalUri !== null) return enumeratePlaylistContents(internalUri, deps.playlistApi, view);
      return enumerateLikedSongs(deps.libraryApi);
    }
    case "artist":
      return enumerateArtist(uri, deps.artistOverview);
    default:
      return [];
  }
}
