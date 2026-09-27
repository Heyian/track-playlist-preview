// src/waitForClient.ts
// Capped wait for client readiness before load() touches Spicetify (Q7, S3, S4).
// Pure: the probe and the timer are injected; index.ts supplies the Spicetify probe.
import type { TimerId, TimerPort } from "./types/domain";

/** How long load() waits for client readiness before failing the module. */
export const READY_TIMEOUT_MS = 10_000;

export interface WaitForClientOptions {
  /** Names of the globals still absent, e.g. `"Spicetify.ContextMenu"`; empty when ready. */
  missing: () => string[];
  timer: TimerPort;
  timeoutMs: number;
  pollMs?: number;
}

export function waitForClient({ missing, timer, timeoutMs, pollMs = 50 }: WaitForClientOptions): Promise<void> {
  if (missing().length === 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let poll: TimerId;
    const deadline = timer.setTimeout(() => {
      timer.clearTimeout(poll);
      reject(new Error(`Client not ready after ${timeoutMs} ms; missing: ${missing().join(", ")}`));
    }, timeoutMs);

    const check = (): void => {
      if (missing().length === 0) {
        timer.clearTimeout(deadline);
        resolve();
        return;
      }
      poll = timer.setTimeout(check, pollMs);
    };
    poll = timer.setTimeout(check, pollMs);
  });
}
