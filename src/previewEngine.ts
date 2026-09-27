// Pure session state machine: idle → previewing(queue, index) → idle.
// No Spicetify, window, or document — audio, timers, resolution and config
// arrive as injected ports. See docs/specs/…-design.md and ADR 0001.
import type {
  TrackRef,
  AudioPort,
  TimerPort,
  TimerId,
  ResolvePort,
  EngineConfigPort,
  EngineListener,
  EndReason,
} from "./types/domain";

export interface EngineDeps {
  audio: AudioPort;
  timer: TimerPort;
  resolve: ResolvePort;
  config: EngineConfigPort;
  emit: EngineListener;
  /** True when a track must be passed over without resolution, audio or events (R13). */
  isExcluded?: (uri: string) => boolean;
}

export function createPreviewEngine(deps: EngineDeps) {
  let state: "idle" | "previewing" = "idle";
  let queue: TrackRef[] = [];
  let index = 0;
  let skipped = 0;
  let durationTimer: TimerId | null = null;
  let gapTimer: TimerId | null = null;
  let generation = 0; // bumped on every start/stop; stale callbacks no-op

  function clearTimers(): void {
    if (durationTimer !== null) {
      deps.timer.clearTimeout(durationTimer);
      durationTimer = null;
    }
    if (gapTimer !== null) {
      deps.timer.clearTimeout(gapTimer);
      gapTimer = null;
    }
  }

  function endSession(reason: EndReason): void {
    clearTimers();
    deps.audio.stop();
    state = "idle";
    deps.emit({ type: "sessionEnded", skipped, reason });
  }

  function advanceImmediately(gen: number): void {
    index += 1;
    void playCurrent(gen);
  }

  async function playCurrent(gen: number): Promise<void> {
    if (gen !== generation || state !== "previewing") return;
    // R13: pass over excluded entries with no resolution, audio or events.
    // A loop, not recursion, so a long excluded run can't grow the stack.
    while (index < queue.length && deps.isExcluded?.(queue[index]!.uri)) index += 1;
    if (index >= queue.length) {
      endSession("completed");
      return;
    }
    const track = queue[index]!;

    let url: string | null;
    try {
      url = await deps.resolve(track.uri);
    } catch {
      // A rejection from a session that was since stopped/replaced must not
      // terminate the current live session.
      if (gen !== generation || state !== "previewing") return;
      endSession("aborted"); // AC13: any trackPreview failure aborts the session
      return;
    }
    if (gen !== generation || state !== "previewing") return;

    if (url === null) {
      // AC20: missing clip — count, skip, advance immediately (no gap).
      skipped += 1;
      deps.emit({ type: "trackSkipped", index, total: queue.length, track, reason: "missing" });
      advanceImmediately(gen);
      return;
    }

    deps.emit({ type: "trackStarted", index, total: queue.length, track });
    deps.audio.play(url, {
      onEnded: () => onNormalComplete(gen),
      onError: () => onClipError(gen),
    });
    durationTimer = deps.timer.setTimeout(() => onNormalComplete(gen), deps.config.getDurationMs());
  }

  function onNormalComplete(gen: number): void {
    if (gen !== generation || state !== "previewing") return;
    clearTimers();
    deps.audio.stop();
    // AC53: report normal completion (duration expiry or natural end) once the
    // clip is stopped, before the gap is scheduled.
    deps.emit({ type: "trackCompleted", index, total: queue.length, track: queue[index]! });
    // AC23: apply the inter-track gap only after normal completion.
    const gap = deps.config.getGapMs();
    if (gap > 0) {
      gapTimer = deps.timer.setTimeout(() => advanceImmediately(gen), gap);
    } else {
      advanceImmediately(gen);
    }
  }

  function onClipError(gen: number): void {
    if (gen !== generation || state !== "previewing") return;
    clearTimers();
    deps.audio.stop();
    const track = queue[index]!;
    // AC21: clip error — count, skip, advance immediately (no gap).
    skipped += 1;
    deps.emit({ type: "trackSkipped", index, total: queue.length, track, reason: "error" });
    advanceImmediately(gen);
  }

  return {
    start(previewQueue: TrackRef[], startIndex = 0): void {
      // AC22: an out-of-range index starts nothing and leaves state untouched.
      if (startIndex < 0 || startIndex >= previewQueue.length) return;
      const wasActive = state === "previewing";
      clearTimers();
      deps.audio.stop();
      if (wasActive) {
        // AC19/AC27: replacement terminates the prior session.
        state = "idle";
        deps.emit({ type: "sessionEnded", skipped, reason: "replaced" });
      }
      generation += 1;
      queue = previewQueue;
      index = startIndex;
      skipped = 0;
      state = "previewing";
      void playCurrent(generation);
    },
    skip(): void {
      // AC16: immediate advance, no gap, not counted as a skip.
      if (state !== "previewing") return;
      clearTimers();
      deps.audio.stop();
      generation += 1; // invalidate any in-flight resolve for the skipped track
      advanceImmediately(generation);
    },
    stop(): void {
      if (state !== "previewing") return;
      generation += 1;
      endSession("stopped");
    },
    isActive: (): boolean => state === "previewing",
    currentIndex: (): number => index,
    // R6: the entry while resolving, playing or during the gap; null when idle.
    currentTrack: (): TrackRef | null => (state === "previewing" ? queue[index] ?? null : null),
  };
}

export type PreviewEngine = ReturnType<typeof createPreviewEngine>;
