// src/playerCoordinator.test.ts
import { describe, it, expect, vi } from "vitest";
import { createPlayerCoordinator, type PlayerPort } from "./playerCoordinator";

function fakePlayer(playing: boolean): PlayerPort & { pause: ReturnType<typeof vi.fn>; resume: ReturnType<typeof vi.fn> } {
  return {
    isPlaying: () => playing,
    pause: vi.fn(),
    resume: vi.fn(),
  };
}

describe("playerCoordinator", () => {
  it("AC24: pauses exactly once when Spotify is playing at session start", () => {
    const p = fakePlayer(true);
    const c = createPlayerCoordinator(p);
    c.acquire();
    expect(p.pause).toHaveBeenCalledTimes(1);
  });

  it("AC25: resumes exactly once when the session terminates", () => {
    const p = fakePlayer(true);
    const c = createPlayerCoordinator(p);
    c.acquire();
    c.release();
    expect(p.resume).toHaveBeenCalledTimes(1);
  });

  it("AC26: never resumes when Spotify was paused at session start", () => {
    const p = fakePlayer(false);
    const c = createPlayerCoordinator(p);
    c.acquire();
    c.release();
    expect(p.pause).not.toHaveBeenCalled();
    expect(p.resume).not.toHaveBeenCalled();
  });

  it("AC27: a second acquire while active does not pause again", () => {
    const p = fakePlayer(true);
    const c = createPlayerCoordinator(p);
    c.acquire();
    c.acquire(); // replacement path: new session acquires while already held
    expect(p.pause).toHaveBeenCalledTimes(1);
  });

  it("AC27: only the terminating release resumes; ownership survives replacement", () => {
    const p = fakePlayer(true);
    const c = createPlayerCoordinator(p);
    c.acquire(); // session A
    c.acquire(); // session B replaces A — controller skips release on 'replaced'
    c.release(); // B terminates
    expect(p.resume).toHaveBeenCalledTimes(1);
  });

  it("release without acquire is a no-op", () => {
    const p = fakePlayer(true);
    const c = createPlayerCoordinator(p);
    c.release();
    expect(p.resume).not.toHaveBeenCalled();
  });
});
