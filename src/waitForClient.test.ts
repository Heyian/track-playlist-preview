import { describe, it, expect } from "vitest";
import { waitForClient, READY_TIMEOUT_MS } from "./waitForClient";
import { fakeTimer } from "./testing/fakeTimer";

type Timer = ReturnType<typeof fakeTimer>;

/** The pending timer scheduled with `ms`. */
function idOf(t: Timer, ms: number): number {
  const id = t.ids().find((i) => t.msOf(i) === ms);
  if (id === undefined) throw new Error(`no pending timer at ${ms} ms`);
  return id;
}

/** Let promise callbacks run. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("waitForClient", () => {
  it("S3: resolves without scheduling a timer when readiness already holds", async () => {
    const t = fakeTimer();
    await expect(waitForClient({ missing: () => [], timer: t.port, timeoutMs: READY_TIMEOUT_MS })).resolves.toBeUndefined();
    expect(t.ids()).toEqual([]);
  });

  it("S3: resolves once readiness holds on a later poll, clearing the deadline", async () => {
    const t = fakeTimer();
    const answers = [["Spicetify.React"], []];
    let settled = false;
    const p = waitForClient({ missing: () => answers.shift() ?? [], timer: t.port, timeoutMs: READY_TIMEOUT_MS }).then(
      () => (settled = true),
    );

    t.fire(idOf(t, 50));
    await p;

    expect(settled).toBe(true);
    expect(t.ids()).toEqual([]);
  });

  it("S4: rejects at the deadline naming each missing global", async () => {
    const t = fakeTimer();
    const p = waitForClient({
      missing: () => ["Spicetify.ContextMenu", "Spicetify.Platform"],
      timer: t.port,
      timeoutMs: READY_TIMEOUT_MS,
    });
    const caught = p.catch((e: unknown) => e);

    t.fire(idOf(t, READY_TIMEOUT_MS));
    const err = await caught;

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("Spicetify.ContextMenu");
    expect((err as Error).message).toContain("Spicetify.Platform");
    expect(t.ids()).toEqual([]);
  });

  it("S4: names only the globals still missing at the deadline", async () => {
    const t = fakeTimer();
    let first = true;
    const missing = () => {
      if (first) {
        first = false;
        return ["Spicetify.React", "Spicetify.ContextMenu", "Spicetify.Platform"];
      }
      return ["Spicetify.ContextMenu"];
    };
    const caught = waitForClient({ missing, timer: t.port, timeoutMs: READY_TIMEOUT_MS }).catch((e: unknown) => e);

    t.fire(idOf(t, 50));
    await flush();
    t.fire(idOf(t, READY_TIMEOUT_MS));
    const message = ((await caught) as Error).message;

    expect(message).toContain("Spicetify.ContextMenu");
    expect(message).not.toContain("Spicetify.React");
  });
});
