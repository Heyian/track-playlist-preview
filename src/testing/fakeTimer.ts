// Shared controllable fake TimerPort for tests (previewEngine, pendingRemovals).
// Not part of the shipped bundle — test-only helper.
import type { TimerId } from "../types/domain";

export function fakeTimer() {
  const pending = new Map<TimerId, () => void>();
  const delays = new Map<TimerId, number>();
  let id = 0;
  return {
    port: {
      setTimeout: (cb: () => void, ms: number): TimerId => {
        const i = ++id;
        pending.set(i, cb);
        delays.set(i, ms);
        return i;
      },
      clearTimeout: (i: TimerId): void => {
        pending.delete(i);
        delays.delete(i);
      },
    },
    fire: (i: TimerId): void => {
      const cb = pending.get(i);
      pending.delete(i);
      delays.delete(i);
      cb?.();
    },
    has: (i: TimerId): boolean => pending.has(i),
    ids: (): TimerId[] => [...pending.keys()],
    /** The delay (ms) the pending timer with id `i` was scheduled with. */
    msOf: (i: TimerId): number | undefined => delays.get(i),
  };
}
