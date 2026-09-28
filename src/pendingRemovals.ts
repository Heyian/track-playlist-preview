// Pure module: delayed playlist-removal commit with an undo window (R9-R15).
// Removals outlive preview sessions — this module is not reset per session,
// and is deliberately kept out of previewEngine. No Spicetify global; the
// timer and commit call arrive as injected ports (see spotify/ports.ts for
// the live TimerPort/RemovePort bindings), same pattern as previewEngine.
import type { TrackRef, TimerPort, TimerId, RemovePort } from "./types/domain";

export const UNDO_WINDOW_MS = 5000;

export interface PendingRemovalEntry {
  handle: number;
  trackTitle: string;
  playlistName: string;
}

/** Exact copy for the error notice (R15). */
export function removalFailedMessage(trackTitle: string, playlistName: string): string {
  return `Couldn't remove ${trackTitle} from ${playlistName}`;
}

type Status = "pending" | "inFlight" | "succeeded" | "undone" | "failed";

interface Entry {
  handle: number;
  playlistUri: string;
  trackUri: string;
  trackTitle: string;
  playlistName: string;
  status: Status;
  timerId: TimerId | null;
  /** marker() value recorded when the commit succeeded; null until then. */
  succeededAt: number | null;
}

export interface PendingRemovalsDeps {
  timer: TimerPort;
  remove: RemovePort;
  onError(trackTitle: string, playlistName: string): void;
}

export function createPendingRemovals(deps: PendingRemovalsDeps) {
  const entries = new Map<number, Entry>();
  const listeners = new Set<() => void>();
  let nextHandle = 0;
  let marker = 0;

  function notify(): void {
    for (const listener of listeners) listener();
  }

  function commit(entry: Entry): void {
    // AC67: issuance drops the entry from list() immediately, before the
    // remove() call settles either way.
    entry.status = "inFlight";
    entry.timerId = null;
    notify();
    // Promise.resolve().then(...) defers the call so a synchronous throw from
    // deps.remove (e.g. the live binding when PlaylistAPI/.remove is missing)
    // still lands in .catch() below instead of escaping the timer callback
    // and leaving the entry stuck inFlight forever.
    Promise.resolve()
      .then(() => deps.remove(entry.playlistUri, entry.trackUri))
      .then(() => {
        marker += 1; // R13: state changed — a marker taken now no longer excludes T
        entry.status = "succeeded";
        entry.succeededAt = marker;
      })
      .catch(() => {
        marker += 1; // state changed, even though nothing is excluded any more (R14)
        entry.status = "failed";
        deps.onError(entry.trackTitle, entry.playlistName); // R15: no retry
      });
    // Listeners do not fire again on settle (success or failure) — only on
    // schedule, undo and issuance.
  }

  return {
    schedule(playlistUri: string, playlistName: string, track: TrackRef): number {
      const handle = ++nextHandle;
      const entry: Entry = {
        handle,
        playlistUri,
        trackUri: track.uri,
        trackTitle: track.name,
        playlistName,
        status: "pending",
        timerId: null,
        succeededAt: null,
      };
      entry.timerId = deps.timer.setTimeout(() => commit(entry), UNDO_WINDOW_MS);
      entries.set(handle, entry);
      marker += 1; // R13: state changed — a marker taken now sees this pending removal
      notify();
      return handle;
    },
    undo(handle: number): boolean {
      const entry = entries.get(handle);
      if (!entry || entry.status !== "pending") return false; // R11: false once issued
      if (entry.timerId !== null) deps.timer.clearTimeout(entry.timerId);
      entry.status = "undone";
      entry.timerId = null;
      notify();
      return true;
    },
    marker(): number {
      return marker;
    },
    isExcluded(playlistUri: string, trackUri: string, sessionMarker: number): boolean {
      for (const entry of entries.values()) {
        if (entry.playlistUri !== playlistUri || entry.trackUri !== trackUri) continue;
        if (entry.status === "pending" || entry.status === "inFlight") return true; // R13(a)
        if (entry.status === "succeeded" && entry.succeededAt !== null && sessionMarker < entry.succeededAt) {
          return true; // R13(b): only sessions that started before the commit succeeded
        }
      }
      return false; // undone/failed exclude nothing (R14)
    },
    list(): PendingRemovalEntry[] {
      // AC67: pending only, oldest first (Map preserves insertion order).
      return [...entries.values()]
        .filter((entry) => entry.status === "pending")
        .map(({ handle, trackTitle, playlistName }) => ({ handle, trackTitle, playlistName }));
    },
    /** Commits every pending removal now instead of when its Undo window ends (U6–U9). */
    flush(): void {
      for (const entry of entries.values()) {
        if (entry.status !== "pending") continue;
        if (entry.timerId !== null) deps.timer.clearTimeout(entry.timerId);
        commit(entry);
      }
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export type PendingRemovals = ReturnType<typeof createPendingRemovals>;
