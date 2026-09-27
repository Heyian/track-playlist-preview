// src/previewController.ts
// Orchestrates the pure engine with the live coordinator and UI. Owns the
// session-teardown policy, including the AC27 replacement rule, and drives
// the preview panel (AC46–AC61) and playlist removals (R1–R6, R13).
import type {
  TrackRef,
  EngineEvent,
  CollectionType,
  PanelPort,
  PanelView,
  PlaylistMetadataPort,
} from "./types/domain";
import type { PreviewEngine } from "./previewEngine";
import type { PlayerCoordinator } from "./playerCoordinator";
import type { PendingRemovals } from "./pendingRemovals";
import { GENERIC_LABEL } from "./spotify/collectionLabel";
import { toPanelView, type SessionContext } from "./ui/previewPanel.view";

export interface ControllerDeps {
  engine: PreviewEngine;
  coordinator: PlayerCoordinator;
  enumerate(uri: string): Promise<TrackRef[]>;
  fetchTrackRef(uri: string): Promise<TrackRef>;
  collectionTypeForUri(uri: string): CollectionType | null;
  notify: { info(m: string): void; error(m: string): void };
  highlight: { set(uri: string): void; clear(): void };
  /** The URI whose collection is currently being previewed, for AC34/AC40. */
  onActiveCollection(uri: string | null): void;
  panel: PanelPort;
  collectionLabel(uri: string, type: CollectionType): Promise<string>;
  playlistMetadata: PlaylistMetadataPort;
  pendingRemovals: Pick<PendingRemovals, "schedule" | "marker" | "isExcluded">;
}

interface Session extends SessionContext {
  /** null = single-track session. */
  collectionUri: string | null;
  type: CollectionType | null;
  /** pendingRemovals.marker() at session start (R13b). */
  marker: number;
  /** Queue length, for the i/N counter between engine events. */
  total: number;
}

export function createPreviewController(deps: ControllerDeps) {
  let session: Session | null = null;
  let lastView: PanelView | null = null;
  // Bumped at the top of every start and by stop(). A start whose seq has moved
  // on after any await returns, so the latest start or stop wins (Review focus 1).
  let startSeq = 0;

  function show(view: PanelView): void {
    lastView = view;
    deps.panel.update(view);
  }

  function onEvent(event: EngineEvent): void {
    switch (event.type) {
      case "trackStarted":
        // AC49: update in place. AC56: no per-track notice while the panel is open.
        if (session) {
          show(toPanelView({ state: "playing", track: event.track, index: event.index, total: event.total, session, progress: "live" }));
        }
        deps.highlight.set(event.track.uri); // AC39
        break;
      case "trackSkipped":
        // AC61; counted by the engine and summarised at session end (AC41).
        if (session) {
          show(toPanelView({ state: "skipping", track: event.track, index: event.index, total: event.total, session, progress: "empty" }));
        }
        break;
      case "trackCompleted":
        // AC53: hold the bar full through the gap. Never skip/stop from here —
        // the engine emits this before it schedules the gap.
        if (lastView) show({ ...lastView, progress: "full" });
        break;
      case "sessionEnded":
        if (event.reason === "replaced") return; // AC27/AC55: new session keeps pause + panel
        deps.panel.close(); // AC55
        deps.highlight.clear(); // AC39
        deps.coordinator.release(); // AC25/AC26
        session = null;
        lastView = null;
        deps.onActiveCollection(null);
        if (event.reason === "aborted") deps.notify.error("Preview unavailable — Spotify API error"); // AC13
        if (event.skipped > 0) deps.notify.info(`Skipped ${event.skipped} track${event.skipped === 1 ? "" : "s"} with no preview`); // AC41
        break;
    }
  }

  async function isRemovable(uri: string): Promise<boolean> {
    try {
      return (await deps.playlistMetadata(uri)).canRemove === true; // R1/R2: literal true only
    } catch {
      return false; // R3
    }
  }

  async function resolveLabel(uri: string, type: CollectionType): Promise<string> {
    try {
      return await deps.collectionLabel(uri, type);
    } catch {
      return GENERIC_LABEL[type];
    }
  }

  const isStale = (seq: number): boolean => seq !== startSeq;

  async function beginSession(
    seq: number,
    queue: TrackRef[],
    startIndex: number,
    collectionUri: string | null,
  ): Promise<void> {
    if (isStale(seq)) return;
    if (queue.length === 0) {
      deps.notify.info("Nothing to preview"); // AC8/AC46: no pause, no audio, no panel
      return;
    }
    const type = collectionUri === null ? null : deps.collectionTypeForUri(collectionUri);
    const [label, removable] = await Promise.all([
      collectionUri !== null && type !== null ? resolveLabel(collectionUri, type) : Promise.resolve(null),
      collectionUri !== null && type === "playlist" ? isRemovable(collectionUri) : Promise.resolve(false),
    ]);
    if (isStale(seq)) return; // a later start or stop superseded this one

    // Bound before engine.start: the engine consults isExcluded synchronously (R13).
    session = { collectionUri, type, label, removable, marker: deps.pendingRemovals.marker(), total: queue.length };
    deps.coordinator.acquire(); // AC24 (no-op if a session is being replaced — AC27)
    deps.onActiveCollection(collectionUri);
    lastView = toPanelView({
      state: "playing",
      track: queue[startIndex]!,
      index: startIndex,
      total: queue.length,
      session,
      progress: "empty",
    });
    deps.panel.open(lastView); // AC46/AC55: opens, or re-focuses on replacement
    deps.engine.start(queue, startIndex);
  }

  function advance(): void {
    deps.engine.skip();
    // Show the new current entry at once rather than waiting for its
    // trackStarted, so the heading and Remove never name the entry just left
    // (R6). AC53: bar empty, no full-bar hold. Past the last entry the session
    // has already ended and closed the panel.
    const track = deps.engine.currentTrack();
    if (session && deps.engine.isActive() && track !== null) {
      show(toPanelView({ state: "playing", track, index: deps.engine.currentIndex(), total: session.total, session, progress: "empty" }));
    }
  }

  function stop(): void {
    startSeq += 1; // cancels any pending start
    deps.engine.stop();
  }

  async function startTrack(uri: string): Promise<void> {
    const seq = ++startSeq;
    const ref = await deps.fetchTrackRef(uri); // AC36 single-track
    await beginSession(seq, [ref], 0, null);
  }

  async function startCollection(uri: string, startIndex = 0): Promise<void> {
    const seq = ++startSeq;
    let queue: TrackRef[];
    try {
      queue = await deps.enumerate(uri);
    } catch {
      if (!isStale(seq)) deps.notify.error("Preview unavailable — Spotify API error");
      return;
    }
    await beginSession(seq, queue, startIndex, uri);
  }

  return {
    onEvent,
    startCollection,
    startTrack,
    async startFromHere(uri: string, contextUri?: string): Promise<void> {
      // AC36: within a collection, start at this track inside the full queue.
      // AC37: outside a collection context, fall back to a single-track preview.
      const type = contextUri ? deps.collectionTypeForUri(contextUri) : null;
      if (!contextUri || type === null) {
        await startTrack(uri);
        return;
      }
      const seq = ++startSeq;
      let queue: TrackRef[];
      try {
        queue = await deps.enumerate(contextUri);
      } catch {
        if (!isStale(seq)) deps.notify.error("Preview unavailable — Spotify API error");
        return;
      }
      if (isStale(seq)) return;
      const index = queue.findIndex((t) => t.uri === uri);
      if (index < 0) {
        await startTrack(uri); // takes a fresh seq; this start is still the latest
        return;
      }
      await beginSession(seq, queue, index, contextUri); // R4: contextUri is the source playlist
    },
    toggleCollection(uri: string): void {
      // AC34: clicking the action-bar button during this collection's session stops it.
      if (session?.collectionUri === uri && deps.engine.isActive()) {
        stop();
      } else {
        void startCollection(uri, 0);
      }
    },
    stop,
    /** AC52: advance immediately; no-op when idle. */
    next(): void {
      if (!deps.engine.isActive()) return;
      advance();
    },
    /** R5/R6: schedule removal of the current entry, then advance as Next does. */
    removeCurrent(): void {
      if (!session?.removable || session.collectionUri === null || !deps.engine.isActive()) return;
      const track = deps.engine.currentTrack();
      if (track === null) return;
      deps.pendingRemovals.schedule(session.collectionUri, session.label ?? GENERIC_LABEL.playlist, track);
      advance();
    },
    /** R13: exclusion is scoped to the session's source playlist and its start marker. */
    isExcluded(trackUri: string): boolean {
      if (session?.type !== "playlist" || session.collectionUri === null) return false;
      return deps.pendingRemovals.isExcluded(session.collectionUri, trackUri, session.marker);
    },
    isActiveFor(uri: string): boolean {
      return session?.collectionUri === uri && deps.engine.isActive();
    },
  };
}

export type PreviewController = ReturnType<typeof createPreviewController>;
