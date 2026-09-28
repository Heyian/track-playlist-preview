// src/spotify/ports.ts
// Thin bindings from injected ports to live Spicetify/DOM globals. No logic —
// the logic lives in the pure modules these feed.
import type {
  AudioPort,
  AudioHandlers,
  TimerPort,
  TimerId,
  PlaylistMetadataPort,
  RemovePort,
  ProgressSource,
} from "../types/domain";
import type { TrackPreviewRequest } from "../previewSource";
import type { PlayerPort } from "../playerCoordinator";
import type { StoragePort } from "../settings";
import type { CollectionDeps, UriMatcher } from "../collections";
import type { ArtistOverviewApi } from "../collections/artist";

/**
 * A single reused <Audio> element fed clip URLs. Also exposes progress
 * (elapsed/duration) via `sample()`, which the engine never sees — only the
 * panel controller reads it (spec purity note).
 */
export function createAudioPort(): AudioPort & ProgressSource {
  const el = new Audio();
  el.preload = "auto";
  let handlers: AudioHandlers | null = null;
  el.addEventListener("ended", () => handlers?.onEnded());
  el.addEventListener("error", () => handlers?.onError());
  return {
    play(url: string, h: AudioHandlers): void {
      handlers = h;
      el.src = url;
      // AC21: play() rejection is a clip error — but only for the clip still
      // loaded. stop() → load() rejects the old play() with an AbortError; that
      // must not skip whatever is playing now.
      void el.play().catch(() => {
        if (handlers === h) h.onError();
      });
    },
    stop(): void {
      handlers = null;
      el.pause();
      el.removeAttribute("src");
      el.load();
    },
    sample() {
      if (handlers === null) return null;
      return { elapsedMs: el.currentTime * 1000, clipDurationMs: el.duration * 1000 };
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

/** Liked Songs' internal list-platform playlist URI (V10), or null when absent or unexpected (V11). */
export function likedSongsPlaylistUri(): string | null {
  const uri: unknown = Spicetify.Platform.LibraryAPI?._likedSongsUri;
  return typeof uri === "string" && uri.startsWith("spotify:playlist:") ? uri : null;
}

/** The saved-sort map `{ [uri]: { field, order } }`. A throw propagates; viewOrder handles it (V4). */
export function readSortedState(): unknown {
  return Spicetify.Platform.LocalStorageAPI.getItem("sortedState");
}

/** The open page's "Search in playlist" text. Scoped to the main view so the sidebar's library search never counts (V8a). */
export function readFilterText(): string | null {
  return document.querySelector<HTMLInputElement>(".main-view-container input.x-filterBox-filterInput")?.value ?? null;
}

export function createCollectionDeps(): CollectionDeps {
  return {
    playlistApi: Spicetify.Platform.PlaylistAPI,
    libraryApi: Spicetify.Platform.LibraryAPI,
    artistOverview: artistOverviewRequest,
    likedSongsPlaylistUri,
  };
}
