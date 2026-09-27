// src/spotify/ports.ts
// Thin bindings from injected ports to live Spicetify/DOM globals. No logic —
// the logic lives in the pure modules these feed.
import type { AudioPort, AudioHandlers, TimerPort, TimerId, PlaylistMetadataPort, RemovePort } from "../types/domain";
import type { TrackPreviewRequest } from "../previewSource";
import type { PlayerPort } from "../playerCoordinator";
import type { StoragePort } from "../settings";
import type { CollectionDeps, UriMatcher } from "../collections";
import type { ArtistOverviewApi } from "../collections/artist";

/** A single reused <Audio> element fed clip URLs. */
export function createAudioPort(): AudioPort {
  const el = new Audio();
  el.preload = "auto";
  let handlers: AudioHandlers | null = null;
  el.addEventListener("ended", () => handlers?.onEnded());
  el.addEventListener("error", () => handlers?.onError());
  return {
    play(url: string, h: AudioHandlers): void {
      handlers = h;
      el.src = url;
      void el.play().catch(() => h.onError()); // AC21: play() rejection is a clip error
    },
    stop(): void {
      handlers = null;
      el.pause();
      el.removeAttribute("src");
      el.load();
    },
  };
}

export const realTimer: TimerPort = {
  setTimeout: (cb, ms): TimerId => window.setTimeout(cb, ms),
  clearTimeout: (id): void => window.clearTimeout(id),
};

/** AC28: pause/resume only. resume() maps to Player.play(). */
export function createPlayerPort(): PlayerPort {
  return {
    isPlaying: () => Spicetify.Player.isPlaying(),
    pause: () => Spicetify.Player.pause(),
    resume: () => Spicetify.Player.play(),
  };
}

export const localStorageAdapter: StoragePort = {
  get: (key) => Spicetify.LocalStorage.get(key),
  set: (key, value) => Spicetify.LocalStorage.set(key, value),
};

/**
 * Resolves URIs to clip URLs via the trackPreview GraphQL operation. The
 * operation is read from Definitions at call time so a rotated sha256Hash
 * self-heals (ADR 0001). Response shape:
 *   data.lookup[i].data.previews.audioPreviewsV2.items[0].url
 * lookup is order-aligned with the input `uris`.
 */
export const trackPreviewRequest: TrackPreviewRequest = async (uris) => {
  const res = await Spicetify.GraphQL.Request(Spicetify.GraphQL.Definitions.trackPreview, { uris });
  const map = new Map<string, string | null>();
  const lookup: any[] = res?.data?.lookup ?? [];
  uris.forEach((uri, i) => {
    const url: string | null = lookup[i]?.data?.previews?.audioPreviewsV2?.items?.[0]?.url ?? null;
    map.set(uri, url);
  });
  return map;
};

/** Playlist and album metadata (name, canRemove) both come from PlaylistAPI.getMetadata (spike p4). */
export const playlistMetadata: PlaylistMetadataPort = (uri) =>
  Spicetify.Platform.PlaylistAPI.getMetadata(uri);

/** R9/spike r1: the URI form (empty uid) removes every copy of the track in one call. */
export const playlistRemove: RemovePort = (playlistUri, trackUri) =>
  Spicetify.Platform.PlaylistAPI.remove(playlistUri, [{ uri: trackUri, uid: "" }]);

export const artistOverviewRequest: ArtistOverviewApi = (uri) =>
  Spicetify.GraphQL.Request(Spicetify.GraphQL.Definitions.queryArtistOverview, {
    uri,
    locale: "",
    includePrerelease: true,
  });

export const spicetifyUriMatcher: UriMatcher = {
  isPlaylistV1OrV2: (uri) => Spicetify.URI.isPlaylistV1OrV2(uri),
  isAlbum: (uri) => Spicetify.URI.isAlbum(uri),
  isArtist: (uri) => Spicetify.URI.isArtist(uri),
};

export function createCollectionDeps(): CollectionDeps {
  return {
    playlistApi: Spicetify.Platform.PlaylistAPI,
    libraryApi: Spicetify.Platform.LibraryAPI,
    artistOverview: artistOverviewRequest,
  };
}
