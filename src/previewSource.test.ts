import { describe, it, expect, vi } from "vitest";
import { createPreviewSource, type TrackPreviewRequest } from "./previewSource";

/** Fake request that returns `url-<id>` for every uri except those in `missing`. */
function fakeRequest(missing: Set<string> = new Set()) {
  const fn = vi.fn<TrackPreviewRequest>(async (uris) => {
    const map = new Map<string, string | null>();
    for (const u of uris) map.set(u, missing.has(u) ? null : `url-${u}`);
    return map;
  });
  return fn;
}

describe("previewSource", () => {
  it("AC9: partitions >100 inputs into ≤100-URI operations, one result per input, order-aligned", async () => {
    const request = fakeRequest();
    const source = createPreviewSource(request);
    const uris = Array.from({ length: 250 }, (_, i) => `t${i}`);

    const results = await source.resolveBatch(uris);

    expect(results).toHaveLength(250);
    expect(results[0]).toBe("url-t0");
    expect(results[249]).toBe("url-t249");
    // 250 uris → chunks of 100,100,50
    expect(request).toHaveBeenCalledTimes(3);
    for (const call of request.mock.calls) {
      expect(call[0].length).toBeLessThanOrEqual(100);
    }
  });

  it("AC10: a track with no preview resolves to null rather than raising", async () => {
    const source = createPreviewSource(fakeRequest(new Set(["gone"])));
    expect(await source.resolve("gone")).toBeNull();
    expect(await source.resolve("here")).toBe("url-here");
  });

  it("AC11: repeated resolutions reuse the cache; at most one operation contains a URI", async () => {
    const request = fakeRequest();
    const source = createPreviewSource(request);

    await source.resolve("x");
    await source.resolve("x");
    await source.resolveBatch(["x", "y"]);

    const timesXRequested = request.mock.calls.filter((c) => c[0].includes("x")).length;
    expect(timesXRequested).toBe(1);
  });

  it("AC11: concurrent resolutions of the same URI issue a single operation for it", async () => {
    const request = fakeRequest();
    const source = createPreviewSource(request);

    await Promise.all([source.resolve("z"), source.resolve("z"), source.resolve("z")]);

    const timesZRequested = request.mock.calls.filter((c) => c[0].includes("z")).length;
    expect(timesZRequested).toBe(1);
  });

  it("clearCache forces the next resolution to re-request", async () => {
    const request = fakeRequest();
    const source = createPreviewSource(request);
    await source.resolve("a");
    source.clearCache();
    await source.resolve("a");
    expect(request.mock.calls.filter((c) => c[0].includes("a")).length).toBe(2);
  });
});
