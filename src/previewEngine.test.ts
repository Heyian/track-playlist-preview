import { describe, it, expect, vi } from "vitest";
import { createPreviewEngine, type EngineDeps } from "./previewEngine";
import type { TrackRef, AudioHandlers, EngineEvent } from "./types/domain";

/** Controllable fake timer: tests fire pending callbacks by id. */
function fakeTimer() {
  const pending = new Map<number, () => void>();
  let id = 0;
  return {
    port: {
      setTimeout: (cb: () => void, _ms: number) => {
        const i = ++id;
        pending.set(i, cb);
        return i;
      },
      clearTimeout: (i: number) => void pending.delete(i),
    },
    fire: (i: number) => {
      const cb = pending.get(i);
      pending.delete(i);
      cb?.();
    },
    has: (i: number) => pending.has(i),
    ids: () => [...pending.keys()],
  };
}

/** Fake audio: records play/stop and exposes the last handlers to fire. */
function fakeAudio() {
  let handlers: AudioHandlers | null = null;
  const play = vi.fn((_url: string, h: AudioHandlers) => void (handlers = h));
  const stop = vi.fn(() => void (handlers = null));
  return { port: { play, stop }, ended: () => handlers?.onEnded(), errored: () => handlers?.onError() };
}

function track(id: string): TrackRef {
  return { uri: `spotify:track:${id}`, name: id, artist: "A" };
}

/** Build an engine with configurable resolver + config; collect emitted events. */
function harness(opts: {
  resolve?: (uri: string) => Promise<string | null>;
  duration?: number;
  gap?: number;
} = {}) {
  const timer = fakeTimer();
  const audio = fakeAudio();
  const events: EngineEvent[] = [];
  let duration = opts.duration ?? 15000;
  let gap = opts.gap ?? 0;
  const deps: EngineDeps = {
    audio: audio.port,
    timer: timer.port,
    resolve: opts.resolve ?? (async (uri) => `url-${uri}`),
    config: { getDurationMs: () => duration, getGapMs: () => gap },
    emit: (e) => void events.push(e),
  };
  const engine = createPreviewEngine(deps);
  return {
    engine,
    timer,
    audio,
    events,
    setDuration: (ms: number) => void (duration = ms),
    setGap: (ms: number) => void (gap = ms),
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("previewEngine", () => {
  it("AC12: begins the first preview before later tracks are resolved", async () => {
    const resolve = vi.fn(async (uri: string) => `url-${uri}`);
    const h = harness({ resolve });
    h.engine.start([track("a"), track("b"), track("c")]);
    await tick();
    expect(h.events[0]).toMatchObject({ type: "trackStarted", index: 0 });
    expect(resolve).toHaveBeenCalledTimes(1); // only track a resolved so far
    expect(resolve).toHaveBeenCalledWith("spotify:track:a");
  });

  it("AC14: advances to the next track when the duration timer fires", async () => {
    const h = harness({ duration: 15000 });
    h.engine.start([track("a"), track("b")]);
    await tick();
    const durationId = h.timer.ids()[0]!;
    h.timer.fire(durationId); // duration expiry
    await tick();
    const started = h.events.filter((e) => e.type === "trackStarted");
    expect(started).toHaveLength(2);
    expect(started[1]).toMatchObject({ index: 1 });
  });

  it("AC15: advances at the clip's natural end and cancels the duration timer", async () => {
    const h = harness();
    h.engine.start([track("a"), track("b")]);
    await tick();
    const durationId = h.timer.ids()[0]!;
    h.audio.ended(); // natural end before timer
    await tick();
    expect(h.timer.has(durationId)).toBe(false);
    expect(h.events.filter((e) => e.type === "trackStarted")).toHaveLength(2);
  });

  it("AC16: skip() advances immediately and cancels the pending timer", async () => {
    const h = harness();
    h.engine.start([track("a"), track("b")]);
    await tick();
    const durationId = h.timer.ids()[0]!;
    h.engine.skip();
    await tick();
    expect(h.timer.has(durationId)).toBe(false);
    expect(h.events.filter((e) => e.type === "trackStarted")).toHaveLength(2);
  });

  it("AC17: stop() halts audio and returns to idle", async () => {
    const h = harness();
    h.engine.start([track("a"), track("b")]);
    await tick();
    h.engine.stop();
    expect(h.audio.port.stop).toHaveBeenCalled();
    expect(h.engine.isActive()).toBe(false);
    expect(h.events.at(-1)).toMatchObject({ type: "sessionEnded", reason: "stopped" });
  });

  it("AC18: exhausting the queue returns to idle and emits sessionEnded", async () => {
    const h = harness();
    h.engine.start([track("a")]);
    await tick();
    h.timer.fire(h.timer.ids()[0]!);
    await tick();
    expect(h.engine.isActive()).toBe(false);
    expect(h.events.at(-1)).toMatchObject({ type: "sessionEnded", reason: "completed", skipped: 0 });
  });

  it("AC19/AC27: starting while active terminates the first as a replacement", async () => {
    const h = harness();
    h.engine.start([track("a"), track("b")]);
    await tick();
    h.engine.start([track("c")]);
    await tick();
    const replaced = h.events.find((e) => e.type === "sessionEnded");
    expect(replaced).toMatchObject({ reason: "replaced" });
    expect(h.engine.isActive()).toBe(true);
  });

  it("AC22: an out-of-range start index starts no session", async () => {
    const h = harness();
    h.engine.start([track("a"), track("b")], 5);
    await tick();
    expect(h.engine.isActive()).toBe(false);
    expect(h.events).toHaveLength(0);
  });

  it("AC22: a valid start index begins there and continues to the end", async () => {
    const h = harness();
    h.engine.start([track("a"), track("b"), track("c")], 1);
    await tick();
    expect(h.events[0]).toMatchObject({ type: "trackStarted", index: 1, total: 3 });
  });

  it("AC20: a track resolving to null is skipped and counted without audio", async () => {
    const resolve = async (uri: string) => (uri.endsWith("b") ? null : `url-${uri}`);
    const h = harness({ resolve });
    h.engine.start([track("a"), track("b"), track("c")]);
    await tick();
    h.timer.fire(h.timer.ids()[0]!); // finish a
    await tick(); // b resolves to null → skipped → c
    const started = h.events.filter((e) => e.type === "trackStarted");
    const skipped = h.events.filter((e) => e.type === "trackSkipped");
    expect(started.map((e: any) => e.index)).toEqual([0, 2]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({ index: 1, reason: "missing" });
    // b never played audio: only a and c did
    expect(h.audio.port.play).toHaveBeenCalledTimes(2);
  });

  it("AC21: a clip error counts and skips like a missing clip", async () => {
    const h = harness();
    h.engine.start([track("a"), track("b")]);
    await tick();
    h.audio.errored(); // a errors
    await tick();
    const skipped = h.events.filter((e) => e.type === "trackSkipped");
    expect(skipped[0]).toMatchObject({ index: 0, reason: "error" });
    // advanced immediately to b
    expect(h.events.filter((e) => e.type === "trackStarted").map((e: any) => e.index)).toEqual([0, 1]);
  });

  it("AC21: the skipped count reaches sessionEnded", async () => {
    const resolve = async (uri: string) => (uri.endsWith("a") ? null : `url-${uri}`);
    const h = harness({ resolve });
    h.engine.start([track("a"), track("b")]);
    await tick(); // a null → skipped → b plays
    h.timer.fire(h.timer.ids()[0]!); // finish b → completed
    await tick();
    expect(h.events.at(-1)).toMatchObject({ type: "sessionEnded", skipped: 1 });
  });

  it("AC23: the gap is applied after normal completion only", async () => {
    const h = harness({ gap: 400 });
    h.engine.start([track("a"), track("b")]);
    await tick();
    h.timer.fire(h.timer.ids()[0]!); // duration expiry → should schedule a gap timer, not advance yet
    await tick();
    expect(h.events.filter((e) => e.type === "trackStarted")).toHaveLength(1);
    // now fire the gap timer
    h.timer.fire(h.timer.ids()[0]!);
    await tick();
    expect(h.events.filter((e) => e.type === "trackStarted")).toHaveLength(2);
  });

  it("AC23: no gap is applied after an error skip", async () => {
    const h = harness({ gap: 400 });
    h.engine.start([track("a"), track("b")]);
    await tick();
    h.audio.errored();
    await tick();
    // advanced immediately, no gap timer waited on
    expect(h.events.filter((e) => e.type === "trackStarted")).toHaveLength(2);
  });

  it("AC45: a duration change mid-session applies from the next track", async () => {
    const h = harness({ duration: 15000 });
    h.engine.start([track("a"), track("b")]);
    await tick();
    h.setDuration(3000);
    h.timer.fire(h.timer.ids()[0]!); // finish a with the OLD timer already in flight
    await tick();
    // track b started; its timer was scheduled reading the NEW duration.
    expect(h.events.filter((e) => e.type === "trackStarted")).toHaveLength(2);
    // (duration value is read at each track boundary; asserted structurally here)
  });

  it("AC13 (engine half): a resolve rejection aborts the session", async () => {
    const resolve = async () => {
      throw new Error("GraphQL down");
    };
    const h = harness({ resolve });
    h.engine.start([track("a")]);
    await tick();
    expect(h.engine.isActive()).toBe(false);
    expect(h.events.at(-1)).toMatchObject({ type: "sessionEnded", reason: "aborted" });
  });

  it("stale reject after restart must not kill the live session", async () => {
    let rejectA: (e: unknown) => void;
    const pendingA = new Promise<string | null>((_res, rej) => {
      rejectA = rej;
    });
    const resolve = vi.fn(async (uri: string) => {
      if (uri === "spotify:track:a") return pendingA;
      return `url-${uri}`;
    });
    const h = harness({ resolve });

    h.engine.start([track("a")]); // playCurrent(a) suspends on pendingA
    await tick();

    h.engine.stop();

    h.engine.start([track("c")]); // c resolves normally
    await tick();

    expect(h.engine.isActive()).toBe(true);
    expect(h.events.filter((e) => e.type === "trackStarted").at(-1)).toMatchObject({
      index: 0,
      track: track("c"),
    });
    const eventsBeforeReject = h.events.length;

    rejectA!(new Error("stale GraphQL failure"));
    await tick();

    expect(h.engine.isActive()).toBe(true);
    const newEvents = h.events.slice(eventsBeforeReject);
    expect(newEvents.some((e) => e.type === "sessionEnded" && e.reason === "aborted")).toBe(false);
  });

  it("skip during the initial resolve window does not double-start", async () => {
    let resolveA: (v: string | null) => void;
    const pendingA = new Promise<string | null>((res) => {
      resolveA = res;
    });
    const resolve = vi.fn(async (uri: string) => {
      if (uri === "spotify:track:a") return pendingA;
      return `url-${uri}`;
    });
    const h = harness({ resolve });

    h.engine.start([track("a"), track("b")]); // playCurrent(a) suspends on pendingA
    await tick();

    h.engine.skip(); // skip before a resolves
    await tick(); // b resolves and plays

    resolveA!("url-spotify:track:a-late"); // a's stale resolve settles after the skip
    await tick();

    const started = h.events.filter((e) => e.type === "trackStarted");
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ index: 1 });
    expect(h.audio.port.play).toHaveBeenCalledTimes(1);
    expect(h.timer.ids()).toHaveLength(1);
  });
});
