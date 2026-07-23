// src/previewController.ts
// Orchestrates the pure engine with the live coordinator and UI. Owns the
// session-teardown policy, including the AC27 replacement rule.
import type { TrackRef, EngineEvent, CollectionType } from "./types/domain";
import type { PreviewEngine } from "./previewEngine";
import type { PlayerCoordinator } from "./playerCoordinator";

export interface ControllerDeps {
  engine: PreviewEngine;
  coordinator: PlayerCoordinator;
  enumerate(uri: string): Promise<TrackRef[]>;
  fetchTrackRef(uri: string): Promise<TrackRef>;
  collectionTypeForUri(uri: string): CollectionType | null;
  notify: { info(m: string): void; error(m: string): void };
  playbar: { register(): void; deregister(): void };
  highlight: { set(uri: string): void; clear(): void };
  /** The URI whose collection is currently being previewed, for AC34/AC40. */
  onActiveCollection(uri: string | null): void;
}

export function createPreviewController(deps: ControllerDeps) {
  let activeCollectionUri: string | null = null;

  function onEvent(event: EngineEvent): void {
    switch (event.type) {
      case "trackStarted":
        deps.notify.info(`${event.track.name} — ${event.track.artist} (${event.index + 1}/${event.total})`); // AC38
        deps.highlight.set(event.track.uri); // AC39
        break;
      case "trackSkipped":
        break; // counted; summarised at session end (AC41)
      case "sessionEnded":
        if (event.reason === "replaced") return; // AC27: new session keeps pause + controls
        deps.playbar.deregister(); // AC33
        deps.highlight.clear(); // AC39
        deps.coordinator.release(); // AC25/AC26
        activeCollectionUri = null;
        deps.onActiveCollection(null);
        if (event.reason === "aborted") deps.notify.error("Preview unavailable — Spotify API error"); // AC13
        if (event.skipped > 0) deps.notify.info(`Skipped ${event.skipped} track${event.skipped === 1 ? "" : "s"} with no preview`); // AC41
        break;
    }
  }

  // The engine is created by index.ts with this listener; see wiring note.
  async function beginSession(queue: TrackRef[], startIndex: number, collectionUri: string | null): Promise<void> {
    if (queue.length === 0) {
      deps.notify.info("Nothing to preview"); // AC8: no pause, no audio, no controls
      return;
    }
    deps.coordinator.acquire(); // AC24 (no-op if a session is being replaced — AC27)
    deps.playbar.register(); // AC33 (idempotent)
    activeCollectionUri = collectionUri;
    deps.onActiveCollection(collectionUri);
    deps.engine.start(queue, startIndex);
  }

  return {
    onEvent,
    async startCollection(uri: string, startIndex = 0): Promise<void> {
      let queue: TrackRef[];
      try {
        queue = await deps.enumerate(uri);
      } catch {
        deps.notify.error("Preview unavailable — Spotify API error");
        return;
      }
      await beginSession(queue, startIndex, uri);
    },
    async startTrack(uri: string): Promise<void> {
      const ref = await deps.fetchTrackRef(uri); // AC36 single-track
      await beginSession([ref], 0, null);
    },
    async startFromHere(uri: string, contextUri?: string): Promise<void> {
      // AC36: within a collection, start at this track inside the full queue.
      // AC37: outside a collection context, fall back to a single-track preview.
      const type = contextUri ? deps.collectionTypeForUri(contextUri) : null;
      if (!contextUri || type === null) {
        await this.startTrack(uri);
        return;
      }
      let queue: TrackRef[];
      try {
        queue = await deps.enumerate(contextUri);
      } catch {
        deps.notify.error("Preview unavailable — Spotify API error");
        return;
      }
      const index = queue.findIndex((t) => t.uri === uri);
      if (index < 0) {
        await this.startTrack(uri);
        return;
      }
      await beginSession(queue, index, contextUri);
    },
    toggleCollection(uri: string): void {
      // AC34: clicking the action-bar button during this collection's session stops it.
      if (activeCollectionUri === uri && deps.engine.isActive()) {
        deps.engine.stop();
      } else {
        void this.startCollection(uri, 0);
      }
    },
    stop(): void {
      deps.engine.stop();
    },
    isActiveFor(uri: string): boolean {
      return activeCollectionUri === uri && deps.engine.isActive();
    },
  };
}

export type PreviewController = ReturnType<typeof createPreviewController>;
