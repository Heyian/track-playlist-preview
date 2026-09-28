import { describe, it, expect, vi } from "vitest";
import { createPendingRemovals, UNDO_WINDOW_MS, removalFailedMessage } from "./pendingRemovals";
import { fakeTimer } from "./testing/fakeTimer";
import type { TrackRef } from "./types/domain";

const P = "spotify:playlist:P";
const a: TrackRef = { uri: "spotify:track:a", name: "Title", artist: "X" };

const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(removeImpl?: (playlistUri: string, trackUri: string) => Promise<void>) {
  const timer = fakeTimer();
  const remove = vi.fn(removeImpl ?? (async () => {}));
  const onError = vi.fn();
  const pr = createPendingRemovals({ timer: timer.port, remove, onError });
  return { pr, timer, remove, onError };
}

describe("pendingRemovals", () => {
  it("R9: no call before the deadline; one URI-form call when it fires", async () => {
    const h = setup();
    h.pr.schedule(P, "Chill Mix", a);
    expect(h.remove).not.toHaveBeenCalled();
    const [id] = h.timer.ids();
    expect(h.timer.msOf(id!)).toBe(UNDO_WINDOW_MS);
    h.timer.fire(id!);
    await tick();
    expect(h.remove).toHaveBeenCalledExactlyOnceWith(P, "spotify:track:a");
  });

  it("R11: undo before issuance cancels; undo after issuance returns false", async () => {
    const h = setup();
    const handle = h.pr.schedule(P, "Chill Mix", a);
    expect(h.pr.undo(handle)).toBe(true);
    const [id] = h.timer.ids();
    expect(id).toBeUndefined(); // timer cleared
    expect(h.remove).not.toHaveBeenCalled();

    const handle2 = h.pr.schedule(P, "Chill Mix", a);
    const [id2] = h.timer.ids();
    h.timer.fire(id2!);
    expect(h.pr.undo(handle2)).toBe(false); // in flight
    await tick();
    expect(h.pr.undo(handle2)).toBe(false); // resolved
  });

  it("R12: two removals of the same URI are independent", async () => {
    const h = setup();
    const h1 = h.pr.schedule(P, "Chill Mix", a);
    const h2 = h.pr.schedule(P, "Chill Mix", a);
    expect(h2).not.toBe(h1);
    const [, id2] = h.timer.ids();
    expect(h.pr.undo(h1)).toBe(true);
    h.timer.fire(id2!);
    await tick();
    expect(h.remove).toHaveBeenCalledExactlyOnceWith(P, "spotify:track:a");
  });

  it("R13: a pending removal excludes T on P for sessions started before and after it, never on Q", () => {
    const h = setup();
    const m0 = h.pr.marker();
    h.pr.schedule(P, "Chill Mix", a);
    const m1 = h.pr.marker();
    expect(h.pr.isExcluded(P, a.uri, m0)).toBe(true);
    expect(h.pr.isExcluded(P, a.uri, m1)).toBe(true);
    expect(h.pr.isExcluded("spotify:playlist:Q", a.uri, m0)).toBe(false);
  });

  it("R13: in flight still excludes; after success only sessions started before it", async () => {
    const h = setup();
    const m0 = h.pr.marker();
    h.pr.schedule(P, "Chill Mix", a);
    const [id] = h.timer.ids();
    h.timer.fire(id!);
    expect(h.pr.isExcluded(P, a.uri, m0)).toBe(true); // in flight
    const mMid = h.pr.marker(); // captured while still in flight
    await tick();
    expect(h.pr.isExcluded(P, a.uri, mMid)).toBe(true); // in-flight-session marker, after success
    expect(h.pr.isExcluded(P, a.uri, m0)).toBe(true); // succeeded, session started before it
    const m2 = h.pr.marker();
    expect(h.pr.isExcluded(P, a.uri, m2)).toBe(false); // session started after success
  });

  it("R14: undone or failed removals exclude nothing", async () => {
    const h = setup(async () => {
      throw new Error("nope");
    });
    const m0 = h.pr.marker();
    const h1 = h.pr.schedule(P, "Chill Mix", a);
    expect(h.pr.undo(h1)).toBe(true);
    expect(h.pr.isExcluded(P, a.uri, m0)).toBe(false);

    const h2 = h.pr.schedule(P, "Chill Mix", a);
    const [id2] = h.timer.ids();
    h.timer.fire(id2!);
    await tick(); // rejects
    expect(h.pr.isExcluded(P, a.uri, m0)).toBe(false);
    expect(h.pr.undo(h2)).toBe(false); // already settled (failed)
  });

  it("a synchronous throw from deps.remove is routed to the failure path, not left in flight", async () => {
    const h = setup(() => {
      throw new Error("PlaylistAPI missing");
    });
    const m0 = h.pr.marker();
    h.pr.schedule(P, "Chill Mix", a);
    const [id] = h.timer.ids();
    h.timer.fire(id!);
    await tick();
    expect(h.onError).toHaveBeenCalledExactlyOnceWith("Title", "Chill Mix");
    expect(h.pr.isExcluded(P, a.uri, m0)).toBe(false);
  });

  it("R15: a rejected commit reports the captured title and playlist name, no retry", async () => {
    const h = setup(async () => {
      throw new Error("nope");
    });
    h.pr.schedule(P, "Chill Mix", a);
    const [id] = h.timer.ids();
    h.timer.fire(id!);
    await tick();
    expect(h.onError).toHaveBeenCalledExactlyOnceWith("Title", "Chill Mix");
    expect(h.remove).toHaveBeenCalledTimes(1);
    expect(removalFailedMessage("Title", "Chill Mix")).toBe("Couldn't remove Title from Chill Mix");
  });

  it("AC67: list is pending-only, oldest first; listeners fire on schedule, undo and issuance", async () => {
    const h = setup();
    const listener = vi.fn();
    const unsubscribe = h.pr.subscribe(listener);

    const ha = h.pr.schedule(P, "Chill Mix", a);
    const hb = h.pr.schedule(P, "Chill Mix", { ...a, uri: "spotify:track:b", name: "Other" });
    expect(h.pr.list()).toEqual([
      { handle: ha, trackTitle: "Title", playlistName: "Chill Mix" },
      { handle: hb, trackTitle: "Other", playlistName: "Chill Mix" },
    ]);

    h.pr.undo(ha);
    expect(h.pr.list()).toEqual([{ handle: hb, trackTitle: "Other", playlistName: "Chill Mix" }]);

    const [idb] = h.timer.ids();
    h.timer.fire(idb!);
    expect(h.pr.list()).toEqual([]); // gone before remove() settles

    expect(listener).toHaveBeenCalledTimes(4); // schedule a, schedule b, undo a, issue b
    await tick();
    expect(listener).toHaveBeenCalledTimes(4); // settle does not notify

    unsubscribe();
    h.pr.schedule(P, "Chill Mix", a);
    expect(listener).toHaveBeenCalledTimes(4); // unsubscribed
  });

  it("marker() is monotonic", async () => {
    const h = setup();
    const m0 = h.pr.marker();
    h.pr.schedule(P, "Chill Mix", a);
    const m1 = h.pr.marker();
    expect(m1).toBeGreaterThan(m0);

    const [id] = h.timer.ids();
    h.timer.fire(id!);
    await tick(); // settle (success)
    const m2 = h.pr.marker();
    expect(m2).toBeGreaterThan(m1);
  });
});

describe("flush (U6–U9)", () => {
  const b: TrackRef = { uri: "spotify:track:b", name: "Other", artist: "Y" };

  it("U6: every pending removal is committed now; the timer adds nothing", async () => {
    const h = setup();
    h.pr.schedule(P, "Chill Mix", a);
    h.pr.schedule(P, "Chill Mix", b);
    const before = h.timer.ids();
    h.pr.flush();
    await tick();
    expect(h.remove.mock.calls).toEqual([
      [P, a.uri],
      [P, b.uri],
    ]);
    expect(h.timer.ids()).toEqual([]);
    for (const id of before) h.timer.fire(id);
    await tick();
    expect(h.remove).toHaveBeenCalledTimes(2);
  });

  it("U7: flushed handles cannot be undone and are not listed", () => {
    const h = setup();
    const h1 = h.pr.schedule(P, "Chill Mix", a);
    const h2 = h.pr.schedule(P, "Chill Mix", b);
    h.pr.flush();
    expect(h.pr.undo(h1)).toBe(false);
    expect(h.pr.undo(h2)).toBe(false);
    expect(h.pr.list()).toEqual([]);
  });

  it("U8: a flushed removal whose remove rejects reports once", async () => {
    const h = setup(async () => {
      throw new Error("nope");
    });
    h.pr.schedule(P, "Chill Mix", a);
    h.pr.flush();
    await tick();
    expect(h.onError).toHaveBeenCalledExactlyOnceWith("Title", "Chill Mix");
  });

  it("U9: undone, in-flight, succeeded and failed removals are left alone", async () => {
    const c: TrackRef = { uri: "spotify:track:c", name: "C", artist: "Z" };
    const d: TrackRef = { uri: "spotify:track:d", name: "D", artist: "W" };
    const h = setup((_p, trackUri) => {
      if (trackUri === b.uri) return new Promise<void>(() => {}); // never settles
      if (trackUri === d.uri) return Promise.reject(new Error("nope"));
      return Promise.resolve();
    });
    const undone = h.pr.schedule(P, "Chill Mix", a);
    h.pr.undo(undone);
    for (const track of [b, c, d]) {
      h.pr.schedule(P, "Chill Mix", track);
      const [id] = h.timer.ids();
      h.timer.fire(id!);
    }
    await tick();
    const calls = h.remove.mock.calls.length;
    h.pr.flush();
    await tick();
    expect(h.remove).toHaveBeenCalledTimes(calls);
  });
});
