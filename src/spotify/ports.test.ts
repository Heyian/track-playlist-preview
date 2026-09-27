// src/spotify/ports.test.ts
// createAudioPort against a stubbed Audio global — no Spicetify, no real media.
import { afterEach, describe, it, expect, vi } from "vitest";
import { createAudioPort } from "./ports";

class FakeAudio extends EventTarget {
  static last: FakeAudio;
  preload = "";
  src = "";
  currentTime = 0;
  duration = NaN;
  rejectPlay: (e: Error) => void = () => {};
  constructor() {
    super();
    FakeAudio.last = this;
  }
  play(): Promise<void> {
    return new Promise((_resolve, reject) => {
      this.rejectPlay = reject;
    });
  }
  pause(): void {}
  removeAttribute(): void {}
  load(): void {}
}

afterEach(() => vi.unstubAllGlobals());

describe("createAudioPort", () => {
  it("AC21: a play() rejection for the current clip is a clip error", async () => {
    vi.stubGlobal("Audio", FakeAudio);
    const port = createAudioPort();
    const onError = vi.fn();
    port.play("u1", { onEnded: vi.fn(), onError });
    FakeAudio.last.rejectPlay(new Error("NotAllowedError"));
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("a stale play() rejection after stop() (AbortError) is ignored", async () => {
    vi.stubGlobal("Audio", FakeAudio);
    const port = createAudioPort();
    const onError = vi.fn();
    port.play("u1", { onEnded: vi.fn(), onError });
    const rejectFirst = FakeAudio.last.rejectPlay;
    port.stop();
    rejectFirst(new Error("AbortError"));
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).not.toHaveBeenCalled();
  });

  it("a stale play() rejection after the next play() doesn't reach either clip's handlers", async () => {
    vi.stubGlobal("Audio", FakeAudio);
    const port = createAudioPort();
    const first = vi.fn();
    const second = vi.fn();
    port.play("u1", { onEnded: vi.fn(), onError: first });
    const rejectFirst = FakeAudio.last.rejectPlay;
    port.stop();
    port.play("u2", { onEnded: vi.fn(), onError: second });
    rejectFirst(new Error("AbortError"));
    await Promise.resolve();
    await Promise.resolve();
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });
});
