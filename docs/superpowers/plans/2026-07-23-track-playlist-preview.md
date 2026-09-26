# Track & Playlist Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Spicetify extension that restores Spotify's removed track preview and extends it to whole playlists, albums, artists and Liked Songs, playing preview clips fetched from the `trackPreview` GraphQL operation through an `<Audio>` element.

**Architecture:** A pure, port-injected core (`previewEngine`, `previewSource`, `collections/`, `settings`, `playerCoordinator`) is unit-tested with Vitest without a running client. A thin adapter layer touches `Spicetify`/`Platform` globals and DOM, wires the core to the live client, and is verified manually against Spotify over the Chrome DevTools Protocol. Preview audio is produced only by an `<Audio>` element; Spotify's own player is `pause`d on session start and `resume`d on session end — never seeked, never re-pointed.

**Tech Stack:** TypeScript (strict), Bun (bundler via local `build.ts`), Vitest, React (aliased to `Spicetify.React`), Spicetify APIs (`GraphQL`, `Platform.PlaylistAPI`/`LibraryAPI`, `Player`, `Playbar`, `ContextMenu`, `Menu`, `PopupModal`, `URI`, `LocalStorage`).

## Global Constraints

Every task's requirements implicitly include this section. Exact values are copied from the spec.

- **Runtime is the live Spotify client.** Pure modules must run under Vitest with no `Spicetify`, `window` or `document`. Only adapter/UI modules may reference globals.
- **`previewEngine` must not reference `Spicetify`, `window`, or `document`.** Audio and timer access arrive as injected ports.
- **`playerCoordinator` is the only module that may call `Spicetify.Player`, and only `pause` and `resume`.** No `seek`, `playUri`, `next`, `back`, or context mutation anywhere.
- **Never hardcode an encore version string.** Button styling is read by cloning `className` from a live `[data-encore-id="buttonTertiary"]` sibling at injection time. `grep -rE 'e-[0-9]' src/` must return nothing.
- **Never copy a GraphQL `sha256Hash` into source.** Read operations from `Spicetify.GraphQL.Definitions` at runtime.
- **`Spicetify.Player.data.position` does not exist.** Use `Spicetify.Player.getProgress()` if progress is ever needed (it is not, in this design).
- **`spotify:playlist:…` parses as `playlist-v2`, not `PLAYLIST`.** Gate playlist predicates on `Spicetify.URI.isPlaylistV1OrV2()`, never `URI.Type.PLAYLIST`.
- **Liked Songs URI is `spotify:collection:tracks`** and must use `LibraryAPI.getTracks` — `PlaylistAPI` errors on it.
- **Defaults:** preview duration `15000` ms, inter-track gap `0` ms, all four collection types enabled.
- **Batch size:** at most `100` URIs per `trackPreview` operation.
- **Quality gate:** `bun run check` (`tsc --noEmit` + `vitest run`). There is no linter. Tests are co-located `*.test.ts` files picked up by Vitest's default globs.
- **The bundler does not typecheck.** A green `bun run build` proves nothing about types — the gate is `bun run check`.
- **Commit-message convention (from `git log`):** capitalized imperative, no `type:` prefix. Examples in history: "Add design spec and ADR 0001", "Replace spicetify-creator with a Bun bundler". Do **not** use `feat:`/`fix:` prefixes.
- **No AI-attribution lines** in commits (per user global rules).

## Conventions (referenced by every implementation task)

**Pre-commit verification (mandatory, identical every task).** Before EVERY `git commit`, dispatch a verification subagent with this exact instruction:

> Run `bun run check` from the repo root. Report `STATUS: PASS` or `STATUS: FAIL`. On FAIL, list each failing test or type error as one terse line (no raw output).

Wait for `STATUS: PASS`. If `FAIL`, fix within the current task and re-dispatch. Never use `git commit --no-verify`.

**Per-task policy.** Follow superpowers:test-driven-development for every pure module (red → green → commit). Invoke superpowers:verification-before-completion before claiming any task done — for UI adapters this means the manual CDP check described in the task, not a typecheck alone. One focused commit per task.

**Manual verification harness (adapters/UI).** Spotify exposes the Chrome DevTools Protocol on `127.0.0.1:8088` (because `always_enable_devtools = 1`). After `bun run build && spicetify apply`, drive `Runtime.evaluate` over that socket (or the committed `scripts/cdp-eval.mjs`, Task 20) to assert the acceptance criteria named in the task. Record the evaluated expression and its result in the commit body.

---

## File Structure

```
src/
  index.ts                       # entry: builds adapters, wires the controller (Task 19)
  types/
    domain.ts                    # TrackRef, PreviewSettings, ports, engine events (Task 2)
    css-modules.d.ts             # existing — plain *.css module declaration
    spicetify.d.ts               # existing — ambient Spicetify types
  settings.ts                    # typed settings over an injected StoragePort (Task 3)
  previewSource.ts               # TrackRef→url|null, batch ≤100, cache, dedupe (Task 4)
  collections/
    eligibility.ts               # shared isEligibleTrack + toTrackRef (Task 5)
    playlist.ts                  # PlaylistAPI.getContents (playlist + album) (Task 5)
    likedSongs.ts                # LibraryAPI.getTracks (Task 6)
    artist.ts                    # GraphQL queryArtistOverview topTracks (Task 7)
    index.ts                     # enumerate() dispatcher + collectionTypeForUri (Task 8)
  previewEngine.ts               # pure session state machine (Task 9)
  playerCoordinator.ts           # pause/resume only, ownership model (Task 10)
  spotify/
    ports.ts                     # real Audio/Timer/Player/Storage/GraphQL adapters (Task 11)
    fetchTrackRef.ts             # single-track metadata for bare-track previews (Task 12)
  ui/
    notifications.ts             # toast wrapper (Snackbar == showNotification) (Task 13)
    rowHighlight.ts              # highlight current row on its page (Task 14)
    rowHighlight.css             # highlight style, inlined by build.ts (Task 14)
    actionBarButton.ts           # inject/maintain the action-bar button (Task 15)
    playbarControls.ts           # Skip/Stop Playbar buttons (Task 16)
    contextMenus.ts              # track + collection context-menu items (Task 17)
    settingsModal.ts             # settings UI + profile Menu.Item (Task 18)
  previewController.ts           # orchestrates engine⇄coordinator⇄UI (Task 19)
scripts/
  cdp-eval.mjs                   # committed CDP harness (Task 20)
```

Co-located tests: `src/settings.test.ts`, `src/previewSource.test.ts`, `src/collections/playlist.test.ts`, `src/collections/likedSongs.test.ts`, `src/collections/artist.test.ts`, `src/collections/index.test.ts`, `src/previewEngine.test.ts`, `src/playerCoordinator.test.ts`.

---

## Task 1: Create an isolated workspace

**Files:** none (workspace setup)

- [ ] **Step 1: Create the worktree**

Use superpowers:using-git-worktrees to create an isolated workspace for branch `track-playlist-preview-impl` off `main`. All subsequent tasks run inside that worktree.

- [ ] **Step 2: Verify the toolchain is green before touching code**

Run: `bun install && bun run check`
Expected: install succeeds; `tsc --noEmit` passes; Vitest prints "No test files found, exiting with code 0" (because of `--passWithNoTests`). This confirms the baseline gate is green.

---

## Task 2: Domain types

**Files:**
- Create: `src/types/domain.ts`

**Interfaces:**
- Produces: `TrackRef`, `CollectionType`, `PreviewSettings`, `DEFAULT_SETTINGS`, `AudioPort`, `AudioHandlers`, `TimerPort`, `TimerId`, `ResolvePort`, `EngineConfigPort`, `SkipReason`, `EndReason`, `EngineEvent`, `EngineListener`. Every later task consumes from here.

- [ ] **Step 1: Write the types**

```typescript
// src/types/domain.ts
// Shared, framework-free domain types. No Spicetify/DOM references — these must
// compile and run under Vitest.

export interface TrackRef {
  uri: string;
  name: string;
  artist: string;
}

export type CollectionType = "playlist" | "likedSongs" | "album" | "artist";

export interface PreviewSettings {
  durationMs: number;
  gapMs: number;
  enabled: Record<CollectionType, boolean>;
}

export const DEFAULT_SETTINGS: PreviewSettings = {
  durationMs: 15000,
  gapMs: 0,
  enabled: { playlist: true, likedSongs: true, album: true, artist: true },
};

/** Callbacks the engine hands to the audio port for one clip. */
export interface AudioHandlers {
  /** Fired when the clip reaches its natural end. */
  onEnded: () => void;
  /** Fired when the clip URL 404s or the element raises an error. */
  onError: () => void;
}

/** Plays and stops a single preview clip. The engine owns no <Audio>. */
export interface AudioPort {
  play(url: string, handlers: AudioHandlers): void;
  stop(): void;
}

export type TimerId = number;

/** Timer access, injected so the engine stays pure and testable. */
export interface TimerPort {
  setTimeout(callback: () => void, ms: number): TimerId;
  clearTimeout(id: TimerId): void;
}

/** Resolve one track URI to a clip URL, or null when no clip exists. */
export type ResolvePort = (uri: string) => Promise<string | null>;

/** Live settings read per-track so mid-session changes take effect (AC45). */
export interface EngineConfigPort {
  getDurationMs(): number;
  getGapMs(): number;
}

export type SkipReason = "missing" | "error";
export type EndReason = "completed" | "stopped" | "replaced" | "aborted";

export type EngineEvent =
  | { type: "trackStarted"; index: number; total: number; track: TrackRef }
  | { type: "trackSkipped"; index: number; total: number; track: TrackRef; reason: SkipReason }
  | { type: "sessionEnded"; skipped: number; reason: EndReason };

export type EngineListener = (event: EngineEvent) => void;
```

- [ ] **Step 2: Verify it typechecks**

Run: `bun run typecheck`
Expected: PASS (no output, exit 0).

- [ ] **Step 3: Pre-commit verification** — dispatch the verification subagent (see Conventions). Wait for `STATUS: PASS`.

- [ ] **Step 4: Commit**

```bash
git add src/types/domain.ts
git commit -m "Add shared domain types and engine ports"
```

---

## Task 3: Settings module

**Files:**
- Create: `src/settings.ts`
- Test: `src/settings.test.ts`

**Interfaces:**
- Consumes: `PreviewSettings`, `DEFAULT_SETTINGS`, `CollectionType` from `./types/domain`.
- Produces: `StoragePort` (`{ get(key): string | null; set(key, value): void }`), `createSettings(storage: StoragePort)` returning `Settings` with `getDurationMs()`, `getGapMs()`, `isEnabled(type)`, `setDurationMs(ms)`, `setGapMs(ms)`, `setEnabled(type, on)`, `snapshot()`. Satisfies AC43, AC44 here; AC42/AC45 are exercised by later tasks.

- [ ] **Step 1: Write the failing test**

```typescript
// src/settings.test.ts
import { describe, it, expect } from "vitest";
import { createSettings, type StoragePort } from "./settings";
import { DEFAULT_SETTINGS } from "./types/domain";

function memoryStorage(seed: Record<string, string> = {}): StoragePort {
  const store = new Map(Object.entries(seed));
  return {
    get: (k) => store.get(k) ?? null,
    set: (k, v) => void store.set(k, v),
  };
}

describe("settings", () => {
  it("AC44: applies defaults when storage is empty", () => {
    const s = createSettings(memoryStorage());
    expect(s.getDurationMs()).toBe(15000);
    expect(s.getGapMs()).toBe(0);
    for (const t of ["playlist", "likedSongs", "album", "artist"] as const) {
      expect(s.isEnabled(t)).toBe(true);
    }
  });

  it("AC43: persists changes across a fresh instance over the same storage", () => {
    const storage = memoryStorage();
    const a = createSettings(storage);
    a.setDurationMs(8000);
    a.setGapMs(500);
    a.setEnabled("album", false);

    const b = createSettings(storage); // simulates a Spotify restart
    expect(b.getDurationMs()).toBe(8000);
    expect(b.getGapMs()).toBe(500);
    expect(b.isEnabled("album")).toBe(false);
    expect(b.isEnabled("playlist")).toBe(true);
  });

  it("falls back to defaults on corrupt stored JSON", () => {
    const s = createSettings(memoryStorage({ "track-playlist-preview:settings": "{not json" }));
    expect(s.snapshot()).toEqual(DEFAULT_SETTINGS);
  });

  it("merges partial stored settings onto defaults", () => {
    const s = createSettings(
      memoryStorage({ "track-playlist-preview:settings": JSON.stringify({ durationMs: 3000 }) }),
    );
    expect(s.getDurationMs()).toBe(3000);
    expect(s.getGapMs()).toBe(0);
    expect(s.isEnabled("artist")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test src/settings.test.ts`
Expected: FAIL — `createSettings` is not exported / module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/settings.ts
import { DEFAULT_SETTINGS, type PreviewSettings, type CollectionType } from "./types/domain";

export interface StoragePort {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

const KEY = "track-playlist-preview:settings";

export function createSettings(storage: StoragePort) {
  let current = load();

  function load(): PreviewSettings {
    const raw = storage.get(KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    try {
      const parsed = JSON.parse(raw) as Partial<PreviewSettings>;
      return {
        durationMs: typeof parsed.durationMs === "number" ? parsed.durationMs : DEFAULT_SETTINGS.durationMs,
        gapMs: typeof parsed.gapMs === "number" ? parsed.gapMs : DEFAULT_SETTINGS.gapMs,
        enabled: { ...DEFAULT_SETTINGS.enabled, ...(parsed.enabled ?? {}) },
      };
    } catch {
      return structuredClone(DEFAULT_SETTINGS);
    }
  }

  function persist(): void {
    storage.set(KEY, JSON.stringify(current));
  }

  return {
    getDurationMs: (): number => current.durationMs,
    getGapMs: (): number => current.gapMs,
    isEnabled: (type: CollectionType): boolean => current.enabled[type],
    setDurationMs(ms: number): void {
      current.durationMs = ms;
      persist();
    },
    setGapMs(ms: number): void {
      current.gapMs = ms;
      persist();
    },
    setEnabled(type: CollectionType, on: boolean): void {
      current.enabled[type] = on;
      persist();
    },
    snapshot: (): PreviewSettings => structuredClone(current),
  };
}

export type Settings = ReturnType<typeof createSettings>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test src/settings.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Pre-commit verification** — dispatch the verification subagent. Wait for `STATUS: PASS`.

- [ ] **Step 6: Commit**

```bash
git add src/settings.ts src/settings.test.ts
git commit -m "Add typed settings persisted over an injected storage port"
```

---

## Task 4: Preview source

**Files:**
- Create: `src/previewSource.ts`
- Test: `src/previewSource.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks (self-contained).
- Produces: `TrackPreviewRequest` (`(uris: string[]) => Promise<Map<string, string | null>>`), `createPreviewSource(request: TrackPreviewRequest)` returning `PreviewSource` with `resolveBatch(uris): Promise<(string|null)[]>` (order-aligned), `resolve(uri): Promise<string|null>`, `prefetch(uris): void`, `clearCache(): void`. Satisfies AC9, AC10, AC11; AC12 is exercised in the engine task.

- [ ] **Step 1: Write the failing test**

```typescript
// src/previewSource.test.ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test src/previewSource.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/previewSource.ts
// Resolves track URIs to preview-clip URLs. Batches ≤100 per operation,
// caches by URI, and de-duplicates in-flight requests. Pure given `request`.

export type TrackPreviewRequest = (uris: string[]) => Promise<Map<string, string | null>>;

const BATCH_SIZE = 100;

export function createPreviewSource(request: TrackPreviewRequest) {
  const cache = new Map<string, string | null>();
  const inflight = new Map<string, Promise<void>>();

  async function fetchChunk(uris: string[]): Promise<void> {
    const result = await request(uris);
    for (const uri of uris) cache.set(uri, result.get(uri) ?? null);
  }

  async function resolveBatch(uris: string[]): Promise<(string | null)[]> {
    const toFetch = uris.filter((u) => !cache.has(u) && !inflight.has(u));
    for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
      const chunk = toFetch.slice(i, i + BATCH_SIZE);
      const p = fetchChunk(chunk).finally(() => {
        for (const u of chunk) inflight.delete(u);
      });
      for (const u of chunk) inflight.set(u, p);
    }
    await Promise.all(uris.map((u) => inflight.get(u)).filter((p): p is Promise<void> => Boolean(p)));
    return uris.map((u) => cache.get(u) ?? null);
  }

  return {
    resolveBatch,
    resolve: async (uri: string): Promise<string | null> => (await resolveBatch([uri]))[0] ?? null,
    prefetch: (uris: string[]): void => void resolveBatch(uris),
    clearCache: (): void => cache.clear(),
  };
}

export type PreviewSource = ReturnType<typeof createPreviewSource>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test src/previewSource.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Pre-commit verification** — dispatch the verification subagent. Wait for `STATUS: PASS`.

- [ ] **Step 6: Commit**

```bash
git add src/previewSource.ts src/previewSource.test.ts
git commit -m "Add batching, caching preview source"
```

---

## Task 5: Collection adapters — playlist and album

**Files:**
- Create: `src/collections/eligibility.ts`
- Create: `src/collections/playlist.ts`
- Test: `src/collections/playlist.test.ts`

**Interfaces:**
- Consumes: `TrackRef` from `../types/domain`.
- Produces:
  - `eligibility.ts`: `RawTrackItem` (fields read from Platform items: `uri`, `type?`, `name?`, `isLocal?`, `isPlayable?`, `artists?: { name: string }[]`), `isEligibleTrack(item): boolean`, `toTrackRef(item): TrackRef`.
  - `playlist.ts`: `PlaylistContentsApi` (`{ getContents(uri, { limit, offset }): Promise<{ items: RawTrackItem[]; totalLength?: number }> }`), `enumeratePlaylistContents(uri: string, api: PlaylistContentsApi): Promise<TrackRef[]>`. Used for both playlist and album URIs (same Platform call). Satisfies AC1, AC2, AC4, AC6, AC7.

- [ ] **Step 1: Write the failing test**

```typescript
// src/collections/playlist.test.ts
import { describe, it, expect } from "vitest";
import { enumeratePlaylistContents, type PlaylistContentsApi } from "./playlist";
import type { RawTrackItem } from "./eligibility";

function track(id: string, extra: Partial<RawTrackItem> = {}): RawTrackItem {
  return { uri: `spotify:track:${id}`, type: "track", name: id, isLocal: false, isPlayable: true, artists: [{ name: "A" }], ...extra };
}

/** Serves `all` in pages of `pageSize`, reporting totalLength. */
function pagedApi(all: RawTrackItem[], pageSize: number): PlaylistContentsApi {
  return {
    async getContents(_uri, { limit, offset }) {
      const items = all.slice(offset, offset + Math.min(limit, pageSize));
      return { items, totalLength: all.length };
    },
  };
}

describe("enumeratePlaylistContents", () => {
  it("AC1: preserves stored order and returns one ref per eligible track", async () => {
    const all = [track("a"), track("b"), track("c")];
    const refs = await enumeratePlaylistContents("spotify:playlist:p", pagedApi(all, 100));
    expect(refs.map((r) => r.uri)).toEqual(all.map((t) => t.uri));
    expect(refs[0]).toEqual({ uri: "spotify:track:a", name: "a", artist: "A" });
  });

  it("AC2: paginates a >100-track collection and returns every eligible track", async () => {
    const all = Array.from({ length: 397 }, (_, i) => track(`t${i}`));
    const refs = await enumeratePlaylistContents("spotify:playlist:big", pagedApi(all, 100));
    expect(refs).toHaveLength(397);
    expect(refs.map((r) => r.uri)).toEqual(all.map((t) => t.uri));
  });

  it("AC6: excludes episodes, local files, and unplayable entries", async () => {
    const all = [
      track("ok"),
      { uri: "spotify:episode:e", type: "episode", name: "pod" } as RawTrackItem,
      track("local", { isLocal: true }),
      track("gone", { isPlayable: false }),
    ];
    const refs = await enumeratePlaylistContents("spotify:playlist:mixed", pagedApi(all, 100));
    expect(refs.map((r) => r.uri)).toEqual(["spotify:track:ok"]);
  });

  it("AC4: returns album tracks in the API's returned (disc/track) order", async () => {
    const all = [track("d1t1"), track("d1t2"), track("d2t1")];
    const refs = await enumeratePlaylistContents("spotify:album:al", pagedApi(all, 100));
    expect(refs.map((r) => r.uri)).toEqual(all.map((t) => t.uri));
  });

  it("stops cleanly on a short final page", async () => {
    const all = Array.from({ length: 150 }, (_, i) => track(`t${i}`));
    const refs = await enumeratePlaylistContents("spotify:playlist:p", pagedApi(all, 100));
    expect(refs).toHaveLength(150);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test src/collections/playlist.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `eligibility.ts`**

```typescript
// src/collections/eligibility.ts
import type { TrackRef } from "../types/domain";

/** The subset of a Platform track item this extension reads. */
export interface RawTrackItem {
  uri: string;
  type?: string;
  name?: string;
  isLocal?: boolean;
  isPlayable?: boolean;
  artists?: { name: string }[];
}

/** AC6: only playable, non-local, `track`-type entries are previewable. */
export function isEligibleTrack(item: RawTrackItem): boolean {
  if (!item?.uri) return false;
  if (item.type !== undefined && item.type !== "track") return false;
  if (item.isLocal === true) return false;
  if (item.isPlayable === false) return false;
  return item.uri.startsWith("spotify:track:");
}

export function toTrackRef(item: RawTrackItem): TrackRef {
  return {
    uri: item.uri,
    name: item.name ?? "",
    artist: item.artists?.map((a) => a.name).join(", ") ?? "",
  };
}
```

- [ ] **Step 4: Write `playlist.ts`**

```typescript
// src/collections/playlist.ts
// Enumerates a playlist OR an album — both answer Platform.PlaylistAPI.getContents.
import type { TrackRef } from "../types/domain";
import { isEligibleTrack, toTrackRef, type RawTrackItem } from "./eligibility";

export interface PlaylistContentsApi {
  getContents(
    uri: string,
    options: { limit: number; offset: number },
  ): Promise<{ items: RawTrackItem[]; totalLength?: number }>;
}

const PAGE = 100;

export async function enumeratePlaylistContents(uri: string, api: PlaylistContentsApi): Promise<TrackRef[]> {
  const out: TrackRef[] = [];
  let offset = 0;
  for (;;) {
    const page = await api.getContents(uri, { limit: PAGE, offset });
    const items = page.items ?? [];
    for (const item of items) {
      if (isEligibleTrack(item)) out.push(toTrackRef(item));
    }
    offset += items.length;
    const total = page.totalLength ?? offset;
    if (items.length === 0 || offset >= total) break;
  }
  return out;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun run test src/collections/playlist.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Pre-commit verification** — dispatch the verification subagent. Wait for `STATUS: PASS`.

- [ ] **Step 7: Commit**

```bash
git add src/collections/eligibility.ts src/collections/playlist.ts src/collections/playlist.test.ts
git commit -m "Add playlist and album enumeration adapters"
```

---

## Task 6: Collection adapter — Liked Songs

**Files:**
- Create: `src/collections/likedSongs.ts`
- Test: `src/collections/likedSongs.test.ts`

**Interfaces:**
- Consumes: `TrackRef` from `../types/domain`; `isEligibleTrack`, `toTrackRef`, `RawTrackItem` from `./eligibility`.
- Produces: `LibraryApi` (`{ getTracks(options: { limit: number; offset: number }): Promise<{ items: RawTrackItem[]; totalLength?: number; unfilteredTotalLength?: number }> }`), `enumerateLikedSongs(api: LibraryApi): Promise<TrackRef[]>`. Satisfies AC3.

- [ ] **Step 1: Write the failing test**

```typescript
// src/collections/likedSongs.test.ts
import { describe, it, expect } from "vitest";
import { enumerateLikedSongs, type LibraryApi } from "./likedSongs";
import type { RawTrackItem } from "./eligibility";

function track(id: string, extra: Partial<RawTrackItem> = {}): RawTrackItem {
  return { uri: `spotify:track:${id}`, type: "track", name: id, isLocal: false, isPlayable: true, artists: [{ name: "A" }], ...extra };
}

function pagedLibrary(all: RawTrackItem[], pageSize: number): LibraryApi {
  return {
    async getTracks({ limit, offset }) {
      return { items: all.slice(offset, offset + Math.min(limit, pageSize)), totalLength: all.length };
    },
  };
}

describe("enumerateLikedSongs", () => {
  it("AC3: returns every eligible track URI in the API's response order", async () => {
    const all = Array.from({ length: 220 }, (_, i) => track(`t${i}`));
    const refs = await enumerateLikedSongs(pagedLibrary(all, 100));
    expect(refs).toHaveLength(220);
    expect(refs.map((r) => r.uri)).toEqual(all.map((t) => t.uri));
  });

  it("AC6: excludes local and unplayable entries from Liked Songs", async () => {
    const all = [track("ok"), track("local", { isLocal: true }), track("gone", { isPlayable: false })];
    const refs = await enumerateLikedSongs(pagedLibrary(all, 100));
    expect(refs.map((r) => r.uri)).toEqual(["spotify:track:ok"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test src/collections/likedSongs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/collections/likedSongs.ts
// Liked Songs (spotify:collection:tracks) answers LibraryAPI.getTracks, NOT
// PlaylistAPI (which errors "Invalid playlist response!" on that URI).
import type { TrackRef } from "../types/domain";
import { isEligibleTrack, toTrackRef, type RawTrackItem } from "./eligibility";

export interface LibraryApi {
  getTracks(options: { limit: number; offset: number }): Promise<{
    items: RawTrackItem[];
    totalLength?: number;
    unfilteredTotalLength?: number;
  }>;
}

const PAGE = 100;

export async function enumerateLikedSongs(api: LibraryApi): Promise<TrackRef[]> {
  const out: TrackRef[] = [];
  let offset = 0;
  for (;;) {
    const page = await api.getTracks({ limit: PAGE, offset });
    const items = page.items ?? [];
    for (const item of items) {
      if (isEligibleTrack(item)) out.push(toTrackRef(item));
    }
    offset += items.length;
    const total = page.totalLength ?? offset;
    if (items.length === 0 || offset >= total) break;
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test src/collections/likedSongs.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Pre-commit verification** — dispatch the verification subagent. Wait for `STATUS: PASS`.

- [ ] **Step 6: Commit**

```bash
git add src/collections/likedSongs.ts src/collections/likedSongs.test.ts
git commit -m "Add Liked Songs enumeration adapter"
```

---

## Task 7: Collection adapter — artist

**Files:**
- Create: `src/collections/artist.ts`
- Test: `src/collections/artist.test.ts`

**Interfaces:**
- Consumes: `TrackRef` from `../types/domain`.
- Produces: `ArtistOverviewApi` (`(uri: string) => Promise<unknown>` — the raw GraphQL response), `enumerateArtist(uri: string, request: ArtistOverviewApi): Promise<TrackRef[]>`. Reads `data.artistUnion.discography.topTracks.items[].track` (`uri`, `name`, `artists.items[].profile.name`). Satisfies AC5. No fixed count is assumed.

- [ ] **Step 1: Write the failing test**

```typescript
// src/collections/artist.test.ts
import { describe, it, expect } from "vitest";
import { enumerateArtist, type ArtistOverviewApi } from "./artist";

function overview(tracks: { uri: string; name: string; artist: string }[]) {
  return {
    data: {
      artistUnion: {
        discography: {
          topTracks: {
            items: tracks.map((t) => ({
              track: {
                uri: t.uri,
                name: t.name,
                artists: { items: [{ profile: { name: t.artist } }] },
                playability: { playable: true },
              },
            })),
          },
        },
      },
    },
  };
}

describe("enumerateArtist", () => {
  it("AC5: returns each supplied top track once, in response order, no fixed count", async () => {
    const tracks = [
      { uri: "spotify:track:1", name: "One", artist: "Band" },
      { uri: "spotify:track:2", name: "Two", artist: "Band" },
    ];
    const request: ArtistOverviewApi = async () => overview(tracks);
    const refs = await enumerateArtist("spotify:artist:x", request);
    expect(refs).toEqual([
      { uri: "spotify:track:1", name: "One", artist: "Band" },
      { uri: "spotify:track:2", name: "Two", artist: "Band" },
    ]);
  });

  it("returns [] when the artist has no top tracks", async () => {
    const request: ArtistOverviewApi = async () => overview([]);
    expect(await enumerateArtist("spotify:artist:x", request)).toEqual([]);
  });

  it("AC6: drops entries flagged unplayable", async () => {
    const raw = overview([{ uri: "spotify:track:1", name: "One", artist: "Band" }]);
    raw.data.artistUnion.discography.topTracks.items[0]!.track.playability.playable = false;
    const request: ArtistOverviewApi = async () => raw;
    expect(await enumerateArtist("spotify:artist:x", request)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test src/collections/artist.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/collections/artist.ts
// Artist top tracks come from the queryArtistOverview GraphQL operation
// (top-tracks only, ~10 entries). The caller supplies the request function so
// this module stays free of Spicetify.
import type { TrackRef } from "../types/domain";

export type ArtistOverviewApi = (uri: string) => Promise<unknown>;

interface OverviewShape {
  data?: {
    artistUnion?: {
      discography?: {
        topTracks?: {
          items?: {
            track?: {
              uri?: string;
              name?: string;
              artists?: { items?: { profile?: { name?: string } }[] };
              playability?: { playable?: boolean };
            };
          }[];
        };
      };
    };
  };
}

export async function enumerateArtist(uri: string, request: ArtistOverviewApi): Promise<TrackRef[]> {
  const raw = (await request(uri)) as OverviewShape;
  const items = raw.data?.artistUnion?.discography?.topTracks?.items ?? [];
  const out: TrackRef[] = [];
  for (const entry of items) {
    const track = entry.track;
    if (!track?.uri) continue;
    if (track.playability?.playable === false) continue;
    out.push({
      uri: track.uri,
      name: track.name ?? "",
      artist: track.artists?.items?.map((a) => a.profile?.name ?? "").filter(Boolean).join(", ") ?? "",
    });
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test src/collections/artist.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Pre-commit verification** — dispatch the verification subagent. Wait for `STATUS: PASS`.

- [ ] **Step 6: Commit**

```bash
git add src/collections/artist.ts src/collections/artist.test.ts
git commit -m "Add artist top-tracks enumeration adapter"
```

> **Note for the implementer:** the exact `queryArtistOverview` response shape (`playability`, `artists.items[].profile.name`) must be confirmed live in Task 19's manual check. If the live shape differs, adjust `OverviewShape` and the test's `overview()` fixture together so they stay in lockstep.

---

## Task 8: Collection dispatcher

**Files:**
- Create: `src/collections/index.ts`
- Test: `src/collections/index.test.ts`

**Interfaces:**
- Consumes: `TrackRef`, `CollectionType` from `../types/domain`; the four adapters and their API interfaces.
- Produces:
  - `CollectionDeps` (`{ playlistApi: PlaylistContentsApi; libraryApi: LibraryApi; artistOverview: ArtistOverviewApi }`).
  - `collectionTypeForUri(uri: string): CollectionType | null` — pure URI classification injectable with a `UriMatcher` so it is testable without Spicetify.
  - `enumerate(uri: string, deps: CollectionDeps, classify?: (uri: string) => CollectionType | null): Promise<TrackRef[]>`.
- Consumed by: Task 15 (actionBarButton), Task 17 (contextMenus), Task 19 (controller).

The URI classification must not depend on `URI.Type.PLAYLIST` (playlists parse as `playlist-v2`). To keep this unit-testable, `collectionTypeForUri` takes an injected matcher; the real Spicetify matcher is supplied in Task 19.

- [ ] **Step 1: Write the failing test**

```typescript
// src/collections/index.test.ts
import { describe, it, expect, vi } from "vitest";
import { collectionTypeForUri, enumerate, type UriMatcher, type CollectionDeps } from "./index";

const matcher: UriMatcher = {
  isPlaylistV1OrV2: (u) => u.startsWith("spotify:playlist:") || u.startsWith("spotify:user:"),
  isAlbum: (u) => u.startsWith("spotify:album:"),
  isArtist: (u) => u.startsWith("spotify:artist:"),
};

describe("collectionTypeForUri", () => {
  it("AC35: classifies a playlist URI (which parses as playlist-v2) as playlist", () => {
    expect(collectionTypeForUri("spotify:playlist:abc", matcher)).toBe("playlist");
  });
  it("classifies Liked Songs, album and artist URIs", () => {
    expect(collectionTypeForUri("spotify:collection:tracks", matcher)).toBe("likedSongs");
    expect(collectionTypeForUri("spotify:album:abc", matcher)).toBe("album");
    expect(collectionTypeForUri("spotify:artist:abc", matcher)).toBe("artist");
  });
  it("returns null for an unrelated URI", () => {
    expect(collectionTypeForUri("spotify:track:abc", matcher)).toBeNull();
  });
});

describe("enumerate", () => {
  function deps(): CollectionDeps {
    return {
      playlistApi: { getContents: vi.fn(async () => ({ items: [{ uri: "spotify:track:p", type: "track", name: "P", isPlayable: true, artists: [{ name: "A" }] }], totalLength: 1 })) },
      libraryApi: { getTracks: vi.fn(async () => ({ items: [{ uri: "spotify:track:l", type: "track", name: "L", isPlayable: true, artists: [{ name: "A" }] }], totalLength: 1 })) },
      artistOverview: vi.fn(async () => ({ data: { artistUnion: { discography: { topTracks: { items: [{ track: { uri: "spotify:track:a", name: "AA", artists: { items: [{ profile: { name: "A" } }] }, playability: { playable: true } } }] } } } } })),
    };
  }

  it("routes playlist URIs to PlaylistAPI", async () => {
    const d = deps();
    const refs = await enumerate("spotify:playlist:p", d, (u) => collectionTypeForUri(u, matcher));
    expect(refs.map((r) => r.uri)).toEqual(["spotify:track:p"]);
    expect(d.playlistApi.getContents).toHaveBeenCalled();
  });
  it("routes album URIs to PlaylistAPI", async () => {
    const d = deps();
    await enumerate("spotify:album:x", d, (u) => collectionTypeForUri(u, matcher));
    expect(d.playlistApi.getContents).toHaveBeenCalled();
  });
  it("routes Liked Songs to LibraryAPI", async () => {
    const d = deps();
    const refs = await enumerate("spotify:collection:tracks", d, (u) => collectionTypeForUri(u, matcher));
    expect(refs.map((r) => r.uri)).toEqual(["spotify:track:l"]);
    expect(d.libraryApi.getTracks).toHaveBeenCalled();
  });
  it("routes artist URIs to the overview request", async () => {
    const d = deps();
    const refs = await enumerate("spotify:artist:x", d, (u) => collectionTypeForUri(u, matcher));
    expect(refs.map((r) => r.uri)).toEqual(["spotify:track:a"]);
  });
  it("returns [] for a non-collection URI", async () => {
    const d = deps();
    expect(await enumerate("spotify:track:x", d, (u) => collectionTypeForUri(u, matcher))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test src/collections/index.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/collections/index.ts
import type { TrackRef, CollectionType } from "../types/domain";
import { enumeratePlaylistContents, type PlaylistContentsApi } from "./playlist";
import { enumerateLikedSongs, type LibraryApi } from "./likedSongs";
import { enumerateArtist, type ArtistOverviewApi } from "./artist";

export const LIKED_SONGS_URI = "spotify:collection:tracks";

/** The three URI predicates this module needs; injectable for testing. */
export interface UriMatcher {
  isPlaylistV1OrV2(uri: string): boolean;
  isAlbum(uri: string): boolean;
  isArtist(uri: string): boolean;
}

export interface CollectionDeps {
  playlistApi: PlaylistContentsApi;
  libraryApi: LibraryApi;
  artistOverview: ArtistOverviewApi;
}

export function collectionTypeForUri(uri: string, matcher: UriMatcher): CollectionType | null {
  if (uri === LIKED_SONGS_URI) return "likedSongs";
  if (matcher.isPlaylistV1OrV2(uri)) return "playlist";
  if (matcher.isAlbum(uri)) return "album";
  if (matcher.isArtist(uri)) return "artist";
  return null;
}

export async function enumerate(
  uri: string,
  deps: CollectionDeps,
  classify: (uri: string) => CollectionType | null,
): Promise<TrackRef[]> {
  switch (classify(uri)) {
    case "playlist":
    case "album":
      return enumeratePlaylistContents(uri, deps.playlistApi);
    case "likedSongs":
      return enumerateLikedSongs(deps.libraryApi);
    case "artist":
      return enumerateArtist(uri, deps.artistOverview);
    default:
      return [];
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test src/collections/index.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Pre-commit verification** — dispatch the verification subagent. Wait for `STATUS: PASS`.

- [ ] **Step 6: Commit**

```bash
git add src/collections/index.ts src/collections/index.test.ts
git commit -m "Add collection dispatcher and URI classification"
```

---

## Task 9: Preview engine

**Files:**
- Create: `src/previewEngine.ts`
- Test: `src/previewEngine.test.ts`

**Interfaces:**
- Consumes: `TrackRef`, `AudioPort`, `AudioHandlers`, `TimerPort`, `TimerId`, `ResolvePort`, `EngineConfigPort`, `EngineEvent`, `EngineListener`, `EndReason` from `./types/domain`.
- Produces: `EngineDeps` (`{ audio: AudioPort; timer: TimerPort; resolve: ResolvePort; config: EngineConfigPort; emit: EngineListener }`), `createPreviewEngine(deps: EngineDeps)` returning `PreviewEngine` with `start(queue: TrackRef[], startIndex?: number): void`, `skip(): void`, `stop(): void`, `isActive(): boolean`, `currentIndex(): number`. Satisfies AC12–AC23, and the engine half of AC13.
- Consumed by: Task 19 (controller).

This is the core state machine. It resolves lazily one track ahead of playback (never upfront — AC12), races the configured-duration timer against the clip's natural end (AC14/AC15), and applies the inter-track gap only after normal completion (AC23). A monotonically increasing `generation` counter invalidates callbacks from a session that has since been stopped or replaced, so stale async resolves and timers cannot advance a dead session.

- [ ] **Step 1: Write the failing test**

```typescript
// src/previewEngine.test.ts
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
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test src/previewEngine.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/previewEngine.ts
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
    if (index >= queue.length) {
      endSession("completed");
      return;
    }
    const track = queue[index]!;

    let url: string | null;
    try {
      url = await deps.resolve(track.uri);
    } catch {
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
      advanceImmediately(generation);
    },
    stop(): void {
      if (state !== "previewing") return;
      generation += 1;
      endSession("stopped");
    },
    isActive: (): boolean => state === "previewing",
    currentIndex: (): number => index,
  };
}

export type PreviewEngine = ReturnType<typeof createPreviewEngine>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test src/previewEngine.test.ts`
Expected: PASS (16 tests).

- [ ] **Step 5: Pre-commit verification** — dispatch the verification subagent. Wait for `STATUS: PASS`.

- [ ] **Step 6: Commit**

```bash
git add src/previewEngine.ts src/previewEngine.test.ts
git commit -m "Add pure preview-session state machine"
```

---

## Task 10: Player coordinator

**Files:**
- Create: `src/playerCoordinator.ts`
- Test: `src/playerCoordinator.test.ts`

**Interfaces:**
- Produces: `PlayerPort` (`{ isPlaying(): boolean; pause(): void; resume(): void }`), `createPlayerCoordinator(player: PlayerPort)` returning `{ acquire(): void; release(): void; isActive(): boolean }`. Satisfies AC24, AC25, AC26; the coordinator half of AC27; AC28 is guaranteed structurally by the port only exposing `pause`/`resume`.
- Consumed by: Task 19 (controller).

Ownership model: `acquire()` pauses only if Spotify is playing and the coordinator is not already active, recording `wasPlaying`. A second `acquire()` while active is a no-op (AC27: no second pause). `release()` resumes exactly once iff `wasPlaying`. The controller does **not** call `release()` on a `replaced` session end, which is what transfers pause ownership to the replacing session.

- [ ] **Step 1: Write the failing test**

```typescript
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test src/playerCoordinator.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/playerCoordinator.ts
// The ONLY module permitted to touch Spotify playback, and only via pause/resume.
// The injected port deliberately has no seek/playUri surface (AC28).

export interface PlayerPort {
  isPlaying(): boolean;
  pause(): void;
  resume(): void;
}

export function createPlayerCoordinator(player: PlayerPort) {
  let active = false;
  let wasPlaying = false;

  return {
    acquire(): void {
      if (active) return; // AC27: no second pause on replacement
      wasPlaying = player.isPlaying();
      if (wasPlaying) player.pause(); // AC24
      active = true;
    },
    release(): void {
      if (!active) return;
      if (wasPlaying) player.resume(); // AC25 / AC26
      active = false;
    },
    isActive: (): boolean => active,
  };
}

export type PlayerCoordinator = ReturnType<typeof createPlayerCoordinator>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test src/playerCoordinator.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Pre-commit verification** — dispatch the verification subagent. Wait for `STATUS: PASS`.

- [ ] **Step 6: Commit**

```bash
git add src/playerCoordinator.ts src/playerCoordinator.test.ts
git commit -m "Add player coordinator with pause-ownership model"
```

---

## Task 11: Spotify port adapters

**Files:**
- Create: `src/spotify/ports.ts`

**Interfaces:**
- Consumes: `AudioPort`, `AudioHandlers`, `TimerPort`, `TimerId` from `../types/domain`; `TrackPreviewRequest` from `../previewSource`; `PlayerPort` from `../playerCoordinator`; `StoragePort` from `../settings`; `CollectionDeps`, `UriMatcher` from `../collections`.
- Produces: `createAudioPort(): AudioPort`, `realTimer: TimerPort`, `createPlayerPort(): PlayerPort`, `localStorageAdapter: StoragePort`, `trackPreviewRequest: TrackPreviewRequest`, `createCollectionDeps(): CollectionDeps`, `spicetifyUriMatcher: UriMatcher`, `artistOverviewRequest: ArtistOverviewApi`.
- Consumed by: Task 19 (controller).

These are thin bindings to live globals; there are no Vitest tests. Verification is the live CDP check in Step 3 plus the whole-extension check in Task 19.

- [ ] **Step 1: Write the adapters**

```typescript
// src/spotify/ports.ts
// Thin bindings from injected ports to live Spicetify/DOM globals. No logic —
// the logic lives in the pure modules these feed.
import type { AudioPort, AudioHandlers, TimerPort, TimerId } from "../types/domain";
import type { TrackPreviewRequest } from "../previewSource";
import type { PlayerPort } from "../playerCoordinator";
import type { StoragePort } from "../settings";
import type { CollectionDeps, UriMatcher } from "../collections";
import type { ArtistOverviewApi } from "../collections/artist";

/** A single reused <Audio> element fed clip URLs. */
export function createAudioPort(): AudioPort {
  const el = new Audio();
  el.preload = "auto";
  let handlers: AudioHandlers | null = null;
  el.addEventListener("ended", () => handlers?.onEnded());
  el.addEventListener("error", () => handlers?.onError());
  return {
    play(url: string, h: AudioHandlers): void {
      handlers = h;
      el.src = url;
      void el.play().catch(() => h.onError()); // AC21: play() rejection is a clip error
    },
    stop(): void {
      handlers = null;
      el.pause();
      el.removeAttribute("src");
      el.load();
    },
  };
}

export const realTimer: TimerPort = {
  setTimeout: (cb, ms): TimerId => window.setTimeout(cb, ms),
  clearTimeout: (id): void => window.clearTimeout(id),
};

/** AC28: pause/resume only. resume() maps to Player.play(). */
export function createPlayerPort(): PlayerPort {
  return {
    isPlaying: () => Spicetify.Player.isPlaying(),
    pause: () => Spicetify.Player.pause(),
    resume: () => Spicetify.Player.play(),
  };
}

export const localStorageAdapter: StoragePort = {
  get: (key) => Spicetify.LocalStorage.get(key),
  set: (key, value) => Spicetify.LocalStorage.set(key, value),
};

/**
 * Resolves URIs to clip URLs via the trackPreview GraphQL operation. The
 * operation is read from Definitions at call time so a rotated sha256Hash
 * self-heals (ADR 0001). Response shape:
 *   data.lookup[i].data.previews.audioPreviewsV2.items[0].url
 * lookup is order-aligned with the input `uris`.
 */
export const trackPreviewRequest: TrackPreviewRequest = async (uris) => {
  const res = await Spicetify.GraphQL.Request(Spicetify.GraphQL.Definitions.trackPreview, { uris });
  const map = new Map<string, string | null>();
  const lookup: any[] = res?.data?.lookup ?? [];
  uris.forEach((uri, i) => {
    const url: string | null = lookup[i]?.data?.previews?.audioPreviewsV2?.items?.[0]?.url ?? null;
    map.set(uri, url);
  });
  return map;
};

export const artistOverviewRequest: ArtistOverviewApi = (uri) =>
  Spicetify.GraphQL.Request(Spicetify.GraphQL.Definitions.queryArtistOverview, {
    uri,
    locale: "",
    includePrerelease: true,
  });

export const spicetifyUriMatcher: UriMatcher = {
  isPlaylistV1OrV2: (uri) => Spicetify.URI.isPlaylistV1OrV2(uri),
  isAlbum: (uri) => Spicetify.URI.isAlbum(uri),
  isArtist: (uri) => Spicetify.URI.isArtist(uri),
};

export function createCollectionDeps(): CollectionDeps {
  return {
    playlistApi: Spicetify.Platform.PlaylistAPI,
    libraryApi: Spicetify.Platform.LibraryAPI,
    artistOverview: artistOverviewRequest,
  };
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `bun run check`
Expected: PASS (typecheck clean; existing tests still pass).

- [ ] **Step 3: Manual live verification (CDP)** — invoke superpowers:verification-before-completion. After Task 20's harness exists you can script this; for now, in Spotify DevTools console (`127.0.0.1:8088`) confirm the two GraphQL shapes the adapters assume:

```js
// trackPreview: order-aligned lookup with a clip URL
const r = await Spicetify.GraphQL.Request(
  Spicetify.GraphQL.Definitions.trackPreview,
  { uris: ["spotify:track:0QnjcR3CzjZAibq74RW02x"] },
);
console.log(r.data.lookup[0].data.previews.audioPreviewsV2.items[0].url);
// queryArtistOverview: top tracks present
const a = await Spicetify.GraphQL.Request(
  Spicetify.GraphQL.Definitions.queryArtistOverview,
  { uri: "spotify:artist:4gzpq5DPGxSnKTe4SA8HAU", locale: "", includePrerelease: true },
);
console.log(a.data.artistUnion.discography.topTracks.items[0].track.uri);
```

Both must log a value. If `queryArtistOverview`'s shape differs, reconcile Task 7's `OverviewShape` + fixtures and this adapter together.

- [ ] **Step 4: Pre-commit verification** — dispatch the verification subagent. Wait for `STATUS: PASS`.

- [ ] **Step 5: Commit**

```bash
git add src/spotify/ports.ts
git commit -m "Add live Spicetify port adapters"
```

---

## Task 12: Single-track metadata fetch

**Files:**
- Create: `src/spotify/fetchTrackRef.ts`

**Interfaces:**
- Consumes: `TrackRef` from `../types/domain`.
- Produces: `fetchTrackRef(uri: string): Promise<TrackRef>` — used only for bare-track previews (AC36 "Preview track (15s)" and AC37 fallback), where no enumerated queue supplies the name/artist.
- Consumed by: Task 17 (contextMenus), Task 19 (controller).

- [ ] **Step 1: Write the adapter**

```typescript
// src/spotify/fetchTrackRef.ts
// Fetches display metadata for a single track URI. Bare-track preview entry
// points (context menu) only receive a URI; the Snackbar (AC38) needs a name
// and artist. Falls back to a readable label if the lookup shape shifts.
import type { TrackRef } from "../types/domain";

export async function fetchTrackRef(uri: string): Promise<TrackRef> {
  try {
    const res = await Spicetify.GraphQL.Request(Spicetify.GraphQL.Definitions.trackPreview, { uris: [uri] });
    const entity: any = res?.data?.lookup?.[0]?.data;
    const name: string | undefined = entity?.name;
    const artist: string | undefined = entity?.artists?.items?.map((a: any) => a?.profile?.name).filter(Boolean).join(", ");
    if (name) return { uri, name, artist: artist ?? "" };
  } catch {
    // fall through to the label fallback
  }
  return { uri, name: uri.split(":").pop() ?? uri, artist: "" };
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 3: Manual live verification (CDP)** — in the Spotify console confirm the `trackPreview` lookup entity carries `name`/`artists`:

```js
const r = await Spicetify.GraphQL.Request(
  Spicetify.GraphQL.Definitions.trackPreview,
  { uris: ["spotify:track:0QnjcR3CzjZAibq74RW02x"] },
);
console.log(r.data.lookup[0].data.name, r.data.lookup[0].data.artists);
```

If `name`/`artists` are absent on the `trackPreview` entity, switch the lookup to `Spicetify.GraphQL.Definitions.getTrackName` + `queryTrackArtists` and update the adapter; the fallback label keeps the feature working regardless.

- [ ] **Step 4: Pre-commit verification** — dispatch the verification subagent. Wait for `STATUS: PASS`.

- [ ] **Step 5: Commit**

```bash
git add src/spotify/fetchTrackRef.ts
git commit -m "Add single-track metadata fetch for bare-track previews"
```

---

## Task 13: Notifications adapter

**Files:**
- Create: `src/ui/notifications.ts`

**Interfaces:**
- Produces: `notifications` object with `info(message: string): void` and `error(message: string): void`. Wraps `Spicetify.showNotification` (the Snackbar/toast the spec refers to). Used for AC8, AC13, AC38, AC41.
- Consumed by: Task 19 (controller), Task 17 (context menus fallback messaging).

- [ ] **Step 1: Write the adapter**

```typescript
// src/ui/notifications.ts
// The spec's "Snackbar" is Spicetify's toast: Spicetify.showNotification.
export const notifications = {
  info(message: string): void {
    Spicetify.showNotification(message);
  },
  error(message: string): void {
    Spicetify.showNotification(message, true);
  },
};
```

- [ ] **Step 2: Verify it typechecks**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 3: Pre-commit verification** — dispatch the verification subagent. Wait for `STATUS: PASS`.

- [ ] **Step 4: Commit**

```bash
git add src/ui/notifications.ts
git commit -m "Add notifications adapter over showNotification"
```

---

## Task 14: Row highlight

**Files:**
- Create: `src/ui/rowHighlight.ts`
- Create: `src/ui/rowHighlight.css`

**Interfaces:**
- Produces: `rowHighlight` object with `set(uri: string): void` and `clear(): void`. Highlights the tracklist row whose track URI matches, on whichever page is currently rendered, and re-applies as rows virtualize in/out via a `MutationObserver`. Satisfies AC39.
- Consumed by: Task 19 (controller).

- [ ] **Step 1: Write the CSS**

```css
/* src/ui/rowHighlight.css — inlined into the bundle by build.ts */
.tpp-previewing-row {
  box-shadow: inset 2px 0 0 0 var(--spice-button, #1ed760);
  background-color: var(--spice-highlight, rgba(30, 215, 96, 0.08));
}
```

- [ ] **Step 2: Write the module**

```typescript
// src/ui/rowHighlight.ts
// Highlights the currently-previewing row wherever it is rendered. Rows
// virtualize, so a MutationObserver re-applies the class as they mount.
import "./rowHighlight.css";

const CLASS = "tpp-previewing-row";
const ROW = ".main-trackList-trackListRow";

let currentUri: string | null = null;
let observer: MutationObserver | null = null;

/** True if `row` links to `uri` (row anchors carry /track/<id> hrefs). */
function rowMatches(row: Element, uri: string): boolean {
  const id = uri.split(":").pop();
  if (!id) return false;
  return row.querySelector(`a[href*="${id}"]`) !== null;
}

function apply(): void {
  for (const row of document.querySelectorAll(`.${CLASS}`)) row.classList.remove(CLASS);
  if (!currentUri) return;
  for (const row of document.querySelectorAll(ROW)) {
    if (rowMatches(row, currentUri)) row.classList.add(CLASS);
  }
}

function ensureObserver(): void {
  if (observer) return;
  observer = new MutationObserver(() => apply());
  observer.observe(document.body, { childList: true, subtree: true });
}

export const rowHighlight = {
  set(uri: string): void {
    currentUri = uri;
    ensureObserver();
    apply();
  },
  clear(): void {
    currentUri = null;
    apply();
    observer?.disconnect();
    observer = null;
  },
};
```

- [ ] **Step 3: Verify it typechecks and builds (CSS import path)**

Run: `bun run check && bun run build:local`
Expected: both PASS; `dist/track-playlist-preview.js` contains the `.tpp-previewing-row` rule (the build inlines CSS). Confirm with: `grep -c tpp-previewing-row dist/track-playlist-preview.js` → prints `1` or more.

- [ ] **Step 4: Manual live verification (CDP)** — deferred to Task 19's end-to-end run (AC39), where a live session exists to highlight. Note this dependency in the commit body.

- [ ] **Step 5: Pre-commit verification** — dispatch the verification subagent. Wait for `STATUS: PASS`.

- [ ] **Step 6: Commit**

```bash
git add src/ui/rowHighlight.ts src/ui/rowHighlight.css
git commit -m "Add previewing-row highlight"
```

---

## Task 15: Action-bar button

**Files:**
- Create: `src/ui/actionBarButton.ts`

**Interfaces:**
- Consumes: `collectionTypeForUri` (via injected classifier), `Settings` (via `isEnabled`), and start/stop callbacks.
- Produces: `createActionBarButton(deps: ActionBarDeps)` returning `{ start(): void }` where `ActionBarDeps = { isEnabledForCurrentPage(): CollectionType | null; isActiveSession(uri: string): boolean; onToggle(uri: string): void; currentUri(): string | null }`. Injects exactly one button into `.main-actionBar-ActionBarRow`, cloning `className` from a `[data-encore-id="buttonTertiary"]` sibling, and re-injects on navigation. Satisfies AC29, AC30, AC31, AC32, AC34.
- Consumed by: Task 19 (controller).

The button's `className` is copied from the live tertiary sibling — never written in source (Global Constraints). If the row or a tertiary sibling is absent, injection is skipped silently and retried on the next navigation (AC32).

- [ ] **Step 1: Write the module**

```typescript
// src/ui/actionBarButton.ts
// Injects and maintains a single preview toggle in the collection action bar.
import type { CollectionType } from "../types/domain";

export interface ActionBarDeps {
  /** The current page's collection type if enabled in settings, else null. */
  isEnabledForCurrentPage(): CollectionType | null;
  /** True when a session is active for the given collection URI. */
  isActiveSession(uri: string): boolean;
  /** Start (or, if active on this URI, stop) a session for the URI. */
  onToggle(uri: string): void;
  /** The current page's collection URI, or null off a collection page. */
  currentUri(): string | null;
}

const BUTTON_ID = "tpp-action-bar-button";
const ROW = ".main-actionBar-ActionBarRow";
const TERTIARY = '[data-encore-id="buttonTertiary"]';

export function createActionBarButton(deps: ActionBarDeps) {
  function label(active: boolean): string {
    return active ? "Stop preview" : "Preview all";
  }

  function inject(): void {
    const type = deps.isEnabledForCurrentPage();
    const uri = deps.currentUri();
    const existing = document.getElementById(BUTTON_ID);

    // AC30: disabled type or off a collection page → ensure no button.
    if (!type || !uri) {
      existing?.remove();
      return;
    }
    // AC31: never duplicate — one button per row.
    if (existing) {
      existing.textContent = label(deps.isActiveSession(uri));
      return;
    }

    const row = document.querySelector(ROW);
    const sibling = row?.querySelector(TERTIARY);
    // AC32: no row or no tertiary sibling → skip silently, retry next nav.
    if (!row || !sibling) return;

    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.className = sibling.className; // AC32: cloned, no encore string in source
    button.type = "button";
    button.textContent = label(deps.isActiveSession(uri));
    button.addEventListener("click", () => {
      const u = deps.currentUri();
      if (u) deps.onToggle(u); // AC34: toggles the active session
    });
    row.appendChild(button);
  }

  return {
    start(): void {
      inject();
      // Re-inject on SPA navigation and on late-rendering action bars.
      Spicetify.Platform.History.listen(() => queueMicrotask(inject));
      const observer = new MutationObserver(() => inject());
      observer.observe(document.body, { childList: true, subtree: true });
    },
  };
}
```

- [ ] **Step 2: Verify it typechecks and builds**

Run: `bun run check && bun run build:local`
Expected: PASS. Also confirm the encore constraint: `grep -rE 'e-[0-9]' src/` → no output.

- [ ] **Step 3: Manual live verification (CDP)** — after Task 19 wires it, invoke superpowers:verification-before-completion and confirm on each of playlist / `/collection/tracks` / album / artist pages:
  - exactly one `#tpp-action-bar-button` exists (AC29);
  - its `className` equals the sibling tertiary button's (AC32) — `document.getElementById('tpp-action-bar-button').className === document.querySelector('.main-actionBar-ActionBarRow [data-encore-id=\"buttonTertiary\"]').className`;
  - navigating away and back yields exactly one button (AC31);
  - disabling a type in settings removes the button on its pages (AC30).

- [ ] **Step 4: Pre-commit verification** — dispatch the verification subagent. Wait for `STATUS: PASS`.

- [ ] **Step 5: Commit**

```bash
git add src/ui/actionBarButton.ts
git commit -m "Add action-bar preview button with cloned styling"
```

---

## Task 16: Playbar controls

**Files:**
- Create: `src/ui/playbarControls.ts`

**Interfaces:**
- Produces: `createPlaybarControls(deps: { onSkip(): void; onStop(): void })` returning `{ register(): void; deregister(): void }`. Registers Skip and Stop `Spicetify.Playbar.Button`s while a session is active and removes them when idle; `register()` is idempotent. Satisfies AC33.
- Consumed by: Task 19 (controller).

- [ ] **Step 1: Write the module**

```typescript
// src/ui/playbarControls.ts
// Skip and Stop buttons live in the Playbar only while a session is active.
export interface PlaybarControlsDeps {
  onSkip(): void;
  onStop(): void;
}

export function createPlaybarControls(deps: PlaybarControlsDeps) {
  let skip: Spicetify.Playbar.Button | null = null;
  let stop: Spicetify.Playbar.Button | null = null;

  return {
    register(): void {
      if (skip || stop) return; // idempotent (AC33 across replacement)
      skip = new Spicetify.Playbar.Button("Skip preview", "skip-forward", () => deps.onSkip(), false, false);
      stop = new Spicetify.Playbar.Button("Stop preview", "stop", () => deps.onStop(), false, false);
      skip.register();
      stop.register();
    },
    deregister(): void {
      skip?.deregister();
      stop?.deregister();
      skip = null;
      stop = null;
    },
  };
}
```

> **Implementer note:** confirm `"stop"` is a valid `Spicetify.Icon` in `src/types/spicetify.d.ts`. It is not in the current union — use `"pause"` (which is present) or another listed icon, and update this call accordingly. The `Icon` type accepts `Icon | string`, so a string literal typechecks, but prefer a listed icon for a real glyph.

- [ ] **Step 2: Verify it typechecks and builds**

Run: `bun run check && bun run build:local`
Expected: PASS.

- [ ] **Step 3: Manual live verification (CDP)** — deferred to Task 19: with a session active, `Spicetify.Playbar` shows Skip and Stop; when idle, neither is present (AC33).

- [ ] **Step 4: Pre-commit verification** — dispatch the verification subagent. Wait for `STATUS: PASS`.

- [ ] **Step 5: Commit**

```bash
git add src/ui/playbarControls.ts
git commit -m "Add Playbar skip/stop controls"
```

---

## Task 17: Context menus

**Files:**
- Create: `src/ui/contextMenus.ts`

**Interfaces:**
- Consumes: `CollectionType` from `../types/domain`; classifier + settings + start callbacks.
- Produces: `createContextMenus(deps: ContextMenuDeps)` returning `{ register(): void }` where `ContextMenuDeps = { collectionTypeForUri(uri): CollectionType | null; isEnabled(type): boolean; onPreviewCollection(uri): void; onPreviewTrack(uri): void; onPreviewFromHere(uri, contextUri?): void }`. Registers a collection menu item (shown per enabled type, including playlist-v2 URIs) and two track menu items. Satisfies AC35, AC36, AC37.
- Consumed by: Task 19 (controller).

- [ ] **Step 1: Write the module**

```typescript
// src/ui/contextMenus.ts
import type { CollectionType } from "../types/domain";

export interface ContextMenuDeps {
  collectionTypeForUri(uri: string): CollectionType | null;
  isEnabled(type: CollectionType): boolean;
  onPreviewCollection(uri: string): void;
  onPreviewTrack(uri: string): void;
  onPreviewFromHere(uri: string, contextUri?: string): void;
}

export function createContextMenus(deps: ContextMenuDeps) {
  return {
    register(): void {
      // Collection menu item — one URI, an enabled collection type (AC35).
      const collectionItem = new Spicetify.ContextMenu.Item(
        "Preview this collection",
        (uris) => {
          const uri = uris[0];
          if (uri) deps.onPreviewCollection(uri);
        },
        (uris) => {
          const uri = uris[0];
          if (!uri) return false;
          const type = deps.collectionTypeForUri(uri);
          return type !== null && deps.isEnabled(type);
        },
        "play",
      );
      collectionItem.register();

      // Track menu items — a single track URI (AC36/AC37).
      const isSingleTrack = (uris: string[]): boolean =>
        uris.length === 1 && Spicetify.URI.isTrack(uris[0]!);

      const previewTrack = new Spicetify.ContextMenu.Item(
        "Preview track (15s)",
        (uris) => {
          if (uris[0]) deps.onPreviewTrack(uris[0]);
        },
        isSingleTrack,
        "play",
      );
      previewTrack.register();

      const previewFromHere = new Spicetify.ContextMenu.Item(
        "Preview from here",
        (uris, _uids, contextUri) => {
          if (uris[0]) deps.onPreviewFromHere(uris[0], contextUri);
        },
        isSingleTrack,
        "play",
      );
      previewFromHere.register();
    },
  };
}
```

- [ ] **Step 2: Verify it typechecks and builds**

Run: `bun run check && bun run build:local`
Expected: PASS.

- [ ] **Step 3: Manual live verification (CDP/UI)** — after Task 19: right-click a playlist/album/artist/Liked-Songs entry → "Preview this collection" present iff that type is enabled (AC35); right-click a track → both "Preview track (15s)" and "Preview from here" appear (AC36); "Preview from here" outside a collection context falls back to a single-track preview (AC37).

- [ ] **Step 4: Pre-commit verification** — dispatch the verification subagent. Wait for `STATUS: PASS`.

- [ ] **Step 5: Commit**

```bash
git add src/ui/contextMenus.ts
git commit -m "Add track and collection context-menu items"
```

---

## Task 18: Settings modal

**Files:**
- Create: `src/ui/settingsModal.ts`

**Interfaces:**
- Consumes: `Settings` from `../settings`; `CollectionType` from `../types/domain`.
- Produces: `registerSettingsMenu(settings: Settings): void` — adds a `Spicetify.Menu.Item` to the profile dropdown that opens a `PopupModal` exposing preview duration, inter-track gap, and one toggle per collection type. Satisfies AC42; persistence (AC43) and defaults (AC44) are already covered by Task 3.
- Consumed by: Task 19 (controller).

- [ ] **Step 1: Write the module**

```typescript
// src/ui/settingsModal.ts
// Profile-menu entry → settings modal. Uses Spicetify.React so it is bundled
// against Spotify's own React (see build.ts alias).
import type { Settings } from "../settings";
import type { CollectionType } from "../types/domain";

const react = Spicetify.React;

const TYPES: { key: CollectionType; label: string }[] = [
  { key: "playlist", label: "Playlists" },
  { key: "likedSongs", label: "Liked Songs" },
  { key: "album", label: "Albums" },
  { key: "artist", label: "Artists" },
];

function SettingsPanel({ settings }: { settings: Settings }): unknown {
  const [, force] = react.useReducer((n: number) => n + 1, 0);
  const numberRow = (labelText: string, value: number, onChange: (n: number) => void) =>
    react.createElement(
      "label",
      { style: { display: "flex", justifyContent: "space-between", gap: "1rem", margin: "0.5rem 0" } },
      labelText,
      react.createElement("input", {
        type: "number",
        min: 0,
        defaultValue: value,
        onChange: (e: any) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n >= 0) onChange(n);
        },
      }),
    );

  return react.createElement(
    "div",
    null,
    numberRow("Preview duration (ms)", settings.getDurationMs(), (n) => {
      settings.setDurationMs(n);
      force();
    }),
    numberRow("Gap between tracks (ms)", settings.getGapMs(), (n) => {
      settings.setGapMs(n);
      force();
    }),
    ...TYPES.map((t) =>
      react.createElement(
        "label",
        { key: t.key, style: { display: "flex", justifyContent: "space-between", gap: "1rem", margin: "0.5rem 0" } },
        t.label,
        react.createElement("input", {
          type: "checkbox",
          defaultChecked: settings.isEnabled(t.key),
          onChange: (e: any) => {
            settings.setEnabled(t.key, Boolean(e.target.checked));
            force();
          },
        }),
      ),
    ),
  );
}

export function registerSettingsMenu(settings: Settings): void {
  const item = new Spicetify.Menu.Item("Track & Playlist Preview", false, () => {
    Spicetify.PopupModal.display({
      title: "Track & Playlist Preview",
      content: react.createElement(SettingsPanel, { settings }),
    });
  });
  item.register();
}
```

- [ ] **Step 2: Verify it typechecks and builds**

Run: `bun run check && bun run build:local`
Expected: PASS.

- [ ] **Step 3: Manual live verification (UI)** — after Task 19: open the profile dropdown → "Track & Playlist Preview" opens a modal with duration, gap and four toggles; changing a value and reopening shows the new value; restart Spotify and confirm it persisted (AC42/AC43).

- [ ] **Step 4: Pre-commit verification** — dispatch the verification subagent. Wait for `STATUS: PASS`.

- [ ] **Step 5: Commit**

```bash
git add src/ui/settingsModal.ts
git commit -m "Add settings modal and profile-menu entry"
```

---

## Task 19: Controller and entry point

**Files:**
- Create: `src/previewController.ts`
- Modify: `src/index.ts` (replace the skeleton `main`)

**Interfaces:**
- Consumes: everything above — `createSettings`, `createPreviewSource`, `enumerate`/`collectionTypeForUri`, `createPreviewEngine`, `createPlayerCoordinator`, all `spotify/ports` adapters, `fetchTrackRef`, and every `ui/*` module.
- Produces: `createPreviewController(deps): PreviewController` with `startCollection(uri: string, startIndex?: number)`, `startTrack(uri: string)`, `startFromHere(uri: string, contextUri?: string)`, `toggleCollection(uri: string)`, `stop()`, `isActiveFor(uri: string): boolean`. `index.ts` builds the adapters, constructs the controller, and registers all UI. Satisfies the integration criteria: AC8, AC13 (full), AC27 (wiring), AC33, AC38, AC40, AC41.

The controller owns the mapping from engine events to side effects, and the AC27 rule that a `replaced` end does **not** release the coordinator or tear down controls.

- [ ] **Step 1: Write the controller**

```typescript
// src/previewController.ts
// Orchestrates the pure engine with the live coordinator and UI. Owns the
// session-teardown policy, including the AC27 replacement rule.
import type { TrackRef, EngineEvent, CollectionType } from "./types/domain";
import type { PreviewEngine } from "./previewEngine";
import type { PlayerCoordinator } from "./playerCoordinator";

export interface ControllerDeps {
  engine: PreviewEngine;
  coordinator: PlayerCoordinator;
  enumerate(uri: string): Promise<TrackRef[]>;
  fetchTrackRef(uri: string): Promise<TrackRef>;
  collectionTypeForUri(uri: string): CollectionType | null;
  notify: { info(m: string): void; error(m: string): void };
  playbar: { register(): void; deregister(): void };
  highlight: { set(uri: string): void; clear(): void };
  /** The URI whose collection is currently being previewed, for AC34/AC40. */
  onActiveCollection(uri: string | null): void;
}

export function createPreviewController(deps: ControllerDeps) {
  let activeCollectionUri: string | null = null;

  function onEvent(event: EngineEvent): void {
    switch (event.type) {
      case "trackStarted":
        deps.notify.info(`${event.track.name} — ${event.track.artist} (${event.index + 1}/${event.total})`); // AC38
        deps.highlight.set(event.track.uri); // AC39
        break;
      case "trackSkipped":
        break; // counted; summarised at session end (AC41)
      case "sessionEnded":
        if (event.reason === "replaced") return; // AC27: new session keeps pause + controls
        deps.playbar.deregister(); // AC33
        deps.highlight.clear(); // AC39
        deps.coordinator.release(); // AC25/AC26
        activeCollectionUri = null;
        deps.onActiveCollection(null);
        if (event.reason === "aborted") deps.notify.error("Preview unavailable — Spotify API error"); // AC13
        if (event.skipped > 0) deps.notify.info(`Skipped ${event.skipped} track${event.skipped === 1 ? "" : "s"} with no preview`); // AC41
        break;
    }
  }

  // The engine is created by index.ts with this listener; see wiring note.
  async function beginSession(queue: TrackRef[], startIndex: number, collectionUri: string | null): Promise<void> {
    if (queue.length === 0) {
      deps.notify.info("Nothing to preview"); // AC8: no pause, no audio, no controls
      return;
    }
    deps.coordinator.acquire(); // AC24 (no-op if a session is being replaced — AC27)
    deps.playbar.register(); // AC33 (idempotent)
    activeCollectionUri = collectionUri;
    deps.onActiveCollection(collectionUri);
    deps.engine.start(queue, startIndex);
  }

  return {
    onEvent,
    async startCollection(uri: string, startIndex = 0): Promise<void> {
      let queue: TrackRef[];
      try {
        queue = await deps.enumerate(uri);
      } catch {
        deps.notify.error("Preview unavailable — Spotify API error");
        return;
      }
      await beginSession(queue, startIndex, uri);
    },
    async startTrack(uri: string): Promise<void> {
      const ref = await deps.fetchTrackRef(uri); // AC36 single-track
      await beginSession([ref], 0, null);
    },
    async startFromHere(uri: string, contextUri?: string): Promise<void> {
      // AC36: within a collection, start at this track inside the full queue.
      // AC37: outside a collection context, fall back to a single-track preview.
      const type = contextUri ? deps.collectionTypeForUri(contextUri) : null;
      if (!contextUri || type === null) {
        await this.startTrack(uri);
        return;
      }
      let queue: TrackRef[];
      try {
        queue = await deps.enumerate(contextUri);
      } catch {
        deps.notify.error("Preview unavailable — Spotify API error");
        return;
      }
      const index = queue.findIndex((t) => t.uri === uri);
      if (index < 0) {
        await this.startTrack(uri);
        return;
      }
      await beginSession(queue, index, contextUri);
    },
    toggleCollection(uri: string): void {
      // AC34: clicking the action-bar button during this collection's session stops it.
      if (activeCollectionUri === uri && deps.engine.isActive()) {
        deps.engine.stop();
      } else {
        void this.startCollection(uri, 0);
      }
    },
    stop(): void {
      deps.engine.stop();
    },
    isActiveFor(uri: string): boolean {
      return activeCollectionUri === uri && deps.engine.isActive();
    },
  };
}

export type PreviewController = ReturnType<typeof createPreviewController>;
```

- [ ] **Step 2: Write the entry point**

```typescript
// src/index.ts
// Entry point: build live adapters, wire the pure core, register UI.
// build.ts has already awaited Spicetify.React/ReactDOM/Platform; other
// namespaces (Playbar, ContextMenu, GraphQL, Menu) are checked here.
import { createSettings } from "./settings";
import { createPreviewSource } from "./previewSource";
import { enumerate, collectionTypeForUri } from "./collections";
import { createPreviewEngine } from "./previewEngine";
import { createPlayerCoordinator } from "./playerCoordinator";
import { createPreviewController } from "./previewController";
import {
  createAudioPort,
  realTimer,
  createPlayerPort,
  localStorageAdapter,
  trackPreviewRequest,
  createCollectionDeps,
  spicetifyUriMatcher,
} from "./spotify/ports";
import { fetchTrackRef } from "./spotify/fetchTrackRef";
import { notifications } from "./ui/notifications";
import { rowHighlight } from "./ui/rowHighlight";
import { createActionBarButton } from "./ui/actionBarButton";
import { createPlaybarControls } from "./ui/playbarControls";
import { createContextMenus } from "./ui/contextMenus";
import { registerSettingsMenu } from "./ui/settingsModal";
import type { CollectionType } from "./types/domain";

async function main(): Promise<void> {
  // Namespaces build.ts does not wait for.
  while (!Spicetify?.GraphQL || !Spicetify?.Playbar || !Spicetify?.ContextMenu || !Spicetify?.Menu) {
    await new Promise((r) => setTimeout(r, 50));
  }

  const settings = createSettings(localStorageAdapter);
  const source = createPreviewSource(trackPreviewRequest);
  const collectionDeps = createCollectionDeps();
  const classify = (uri: string): CollectionType | null => collectionTypeForUri(uri, spicetifyUriMatcher);

  const coordinator = createPlayerCoordinator(createPlayerPort());
  const playbar = createPlaybarControls({
    onSkip: () => engine.skip(),
    onStop: () => controller.stop(),
  });

  // Late binding: controller needs the engine, the engine needs the
  // controller's onEvent. Build the engine with a forwarding emitter.
  let controller: ReturnType<typeof createPreviewController>;
  const engine = createPreviewEngine({
    audio: createAudioPort(),
    timer: realTimer,
    resolve: (uri) => source.resolve(uri),
    config: { getDurationMs: () => settings.getDurationMs(), getGapMs: () => settings.getGapMs() },
    emit: (event) => controller.onEvent(event),
  });

  controller = createPreviewController({
    engine,
    coordinator,
    enumerate: (uri) => enumerate(uri, collectionDeps, classify),
    fetchTrackRef,
    collectionTypeForUri: classify,
    notify: notifications,
    playbar,
    highlight: rowHighlight,
    onActiveCollection: () => actionBar.start(),
  });

  const actionBar = createActionBarButton({
    isEnabledForCurrentPage: () => {
      const uri = currentCollectionUri();
      if (!uri) return null;
      const type = classify(uri);
      return type && settings.isEnabled(type) ? type : null;
    },
    isActiveSession: (uri) => controller.isActiveFor(uri),
    onToggle: (uri) => controller.toggleCollection(uri),
    currentUri: () => currentCollectionUri(),
  });

  const contextMenus = createContextMenus({
    collectionTypeForUri: classify,
    isEnabled: (type) => settings.isEnabled(type),
    onPreviewCollection: (uri) => void controller.startCollection(uri, 0),
    onPreviewTrack: (uri) => void controller.startTrack(uri),
    onPreviewFromHere: (uri, contextUri) => void controller.startFromHere(uri, contextUri),
  });

  actionBar.start();
  contextMenus.register();
  registerSettingsMenu(settings);
}

/** The collection URI for the page currently shown, or null. */
function currentCollectionUri(): string | null {
  const pathname: string = Spicetify.Platform.History.location?.pathname ?? "";
  // /playlist/<id>, /album/<id>, /artist/<id>, /collection/tracks
  if (pathname === "/collection/tracks") return "spotify:collection:tracks";
  const m = /^\/(playlist|album|artist)\/([a-zA-Z0-9]+)/.exec(pathname);
  if (!m) return null;
  return `spotify:${m[1]}:${m[2]}`;
}

void main();
```

- [ ] **Step 3: Verify it typechecks and builds**

Run: `bun run check && bun run build:local`
Expected: PASS. Then `grep -rE 'e-[0-9]' src/` → no output.

- [ ] **Step 4: Full manual acceptance run (CDP + UI)** — invoke superpowers:verification-before-completion. Build into the client and apply:

Run: `bun run build && spicetify apply`

Then verify against the live client (use `scripts/cdp-eval.mjs` from Task 20 where scriptable):
  - **AC8:** action-bar button on an empty/all-unavailable collection → "Nothing to preview"; `Spicetify.Player.isPlaying()` unchanged; no Playbar controls.
  - **AC38:** starting a collection shows `Title — Artist (1/N)` then `(2/N)`…
  - **AC40:** with a session active, navigate to another page → audio continues and the index keeps advancing.
  - **AC33:** Skip/Stop present while active, absent when idle.
  - **AC39:** current row highlighted on its page; navigating away clears it there; stopping clears all.
  - **AC41:** on a collection containing tracks with no clip, the end-of-session Snackbar reports the skipped count.
  - **AC27:** start collection A, then start collection B mid-session → no audible resume/re-pause blip at the swap; when B ends, Spotify resumes once.
  - **AC13:** temporarily break resolution (e.g. evaluate a session start with the network throttled/offline) → "Preview unavailable — Spotify API error", controls gone, Spotify resumes iff it was playing.

Record the checks and results in the commit body.

- [ ] **Step 5: Pre-commit verification** — dispatch the verification subagent. Wait for `STATUS: PASS`.

- [ ] **Step 6: Commit**

```bash
git add src/previewController.ts src/index.ts
git commit -m "Wire preview controller and entry point"
```

---

## Task 20: Commit the CDP dev harness

**Files:**
- Create: `scripts/cdp-eval.mjs`

**Interfaces:**
- Produces: a Node script that evaluates an expression in the running Spotify renderer over the Chrome DevTools Protocol (`127.0.0.1:8088`) and prints the result — the harness used throughout the manual-verification steps.

- [ ] **Step 1: Write the harness**

```javascript
// scripts/cdp-eval.mjs
// Evaluate a JS expression in the running Spotify renderer via the Chrome
// DevTools Protocol. Spotify exposes CDP on 127.0.0.1:8088 when
// `always_enable_devtools = 1` is set in the Spicetify config.
//
//   node scripts/cdp-eval.mjs 'Spicetify.Player.isPlaying()'
//   node scripts/cdp-eval.mjs "$(cat probe.js)"
//
// Prints the awaited result as JSON, or the error and exits non-zero.

const PORT = process.env.CDP_PORT ?? "8088";
const expression = process.argv.slice(2).join(" ");
if (!expression) {
  console.error("usage: node scripts/cdp-eval.mjs '<expression>'");
  process.exit(2);
}

async function firstPageTarget() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`);
  const targets = await res.json();
  const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!page) throw new Error("No page target with a WebSocket debugger URL found.");
  return page.webSocketDebuggerUrl;
}

async function evaluate(wsUrl, expr) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("WebSocket connection failed.")), { once: true });
  });
  const id = 1;
  const result = new Promise((resolve, reject) => {
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id !== id) return;
      if (msg.error) reject(new Error(msg.error.message));
      else if (msg.result?.exceptionDetails) reject(new Error(msg.result.exceptionDetails.text));
      else resolve(msg.result.result.value);
    });
  });
  ws.send(
    JSON.stringify({
      id,
      method: "Runtime.evaluate",
      params: { expression: `(async () => (${expr}))()`, awaitPromise: true, returnByValue: true },
    }),
  );
  const value = await result;
  ws.close();
  return value;
}

try {
  const value = await evaluate(await firstPageTarget(), expression);
  console.log(JSON.stringify(value, null, 2));
} catch (err) {
  console.error(String(err.message ?? err));
  process.exit(1);
}
```

- [ ] **Step 2: Smoke-test the harness (requires a running Spotify with CDP enabled)**

Run: `node scripts/cdp-eval.mjs 'Spicetify.Player.isPlaying()'`
Expected: prints `true` or `false`. If Spotify is not running with `always_enable_devtools = 1`, note that in the commit body and defer the smoke-test — the script is still correct.

- [ ] **Step 3: Pre-commit verification** — dispatch the verification subagent. Wait for `STATUS: PASS`.

- [ ] **Step 4: Commit**

```bash
git add scripts/cdp-eval.mjs
git commit -m "Commit CDP evaluation harness as a dev tool"
```

---

## Task 21: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

The design doc mandates the agent index carry only a pointer/short summary. CLAUDE.md already documents the architecture and constraints; add only what is newly true.

- [ ] **Step 1: Add the CDP dev-script line and confirm the module map matches reality**

In the "Debugging against the live client" section, add one line pointing at the committed harness:

```markdown
The committed harness is `scripts/cdp-eval.mjs`:
`node scripts/cdp-eval.mjs 'Spicetify.Player.isPlaying()'`.
```

Verify the Architecture module list in CLAUDE.md names the modules that now exist (`previewSource`, `collections/`, `previewEngine`, `playerCoordinator`, `settings`, `ui/`). Add `previewController` and `spotify/` if the one-line map benefits — keep the index under 300 lines and do not paste design content.

- [ ] **Step 2: Verify the file is still coherent and short**

Run: `wc -l CLAUDE.md`
Expected: well under 300 lines.

- [ ] **Step 3: Pre-commit verification** — dispatch the verification subagent. Wait for `STATUS: PASS`.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "Point CLAUDE.md at the committed CDP harness"
```

---

## Task 22: Update README.md

**Files:**
- Modify: `README.md`

**Interfaces:** none.

- [ ] **Step 1: Confirm the README describes the shipped feature**

Read `README.md`. It was already replaced during design; verify it accurately covers: what the extension does, install steps (`bun run build` then `spicetify apply`), the settings (duration, gap, per-type toggles), and the caveat that `trackPreview` is an internal, undocumented Spotify API that may change without notice. Fill any gap; make no cosmetic churn if it is already complete.

- [ ] **Step 2: Pre-commit verification** — dispatch the verification subagent. Wait for `STATUS: PASS`.

- [ ] **Step 3: Commit (only if changed)**

```bash
git add README.md
git commit -m "Document settings and internal-API caveat in README"
```

If Step 1 found the README already complete, skip the commit and note "README already complete — no change" in the task record.

---

## Task 23: Config files — vitest.config.ts decision

**Files:**
- Possibly create: `vitest.config.ts`

The spec lists `vitest.config.ts` as "add only if the default include globs prove insufficient". Every test in this plan is a co-located `src/**/*.test.ts`, which Vitest's defaults already match.

- [ ] **Step 1: Confirm the default globs cover every test**

Run: `bun run test`
Expected: all suites from Tasks 3–10 run and pass. If every `*.test.ts` is discovered, **do not** create `vitest.config.ts` — record "defaults sufficient; no config added" and move on. Only if a suite is missed, add a minimal config:

```typescript
// vitest.config.ts (only if defaults miss a suite)
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
});
```

- [ ] **Step 2: Commit (only if a config was needed)**

```bash
git add vitest.config.ts
git commit -m "Add vitest include globs"
```

(`.gitignore`, `package.json`, `tsconfig.json`, `build.ts`, `src/index.ts` skeleton, `src/settings.json` deletion, `src/types/css-modules.d.ts`, `README.md`, `LICENSE` are already marked **Done** in the spec's Config Impact table and are covered by Tasks 19/22 where touched — no separate task.)

---

## Task 24: Verify deferred issues and ADR

**Files:** none (verification only).

- [ ] **Step 1: Confirm each deferred issue has all four body sections**

Run:
```bash
for n in 1 2 3; do
  echo "== #$n ==";
  gh issue view "$n" --repo Heyian/track-playlist-preview --json body -q .body \
    | grep -E '^#{1,3} +(Context|Required|Integration Points|Priority)';
done
```
Expected: each issue prints all four headings (`Context`, `Required`, `Integration Points`, `Priority`). If any is missing, edit that issue to add the section before proceeding.

- [ ] **Step 2: Confirm ADR 0001 exists and has no unresolved conflicts**

Run: `ls docs/adr/ && grep -i '^\*\*Status:\*\*' docs/adr/0001-*.md`
Expected: `0001-preview-audio-via-trackpreview-graphql.md` exists with `Status: Accepted`. The spec records no ADR conflicts surfaced, so no other ADR needs a status update. No new ADR is required (0001 was created at design time).

- [ ] **Step 3: Record the verification** — no commit; note the results in the task record.

---

## Task 25: Post-implementation verification

**Files:** none (audit only). Read the actual diff — do not trust checkboxes.

- [ ] **Step 1: Confirm every source module and test exists**

Run:
```bash
/usr/bin/find src scripts -type f -name '*.ts' -o -type f -name '*.css' -o -type f -name '*.mjs' | sort
```
Expected: all files from the File Structure section are present, including every `*.test.ts` from Tasks 3–10.

- [ ] **Step 2: Confirm the pure-core / adapter boundary and constraints hold**

Run:
```bash
grep -rE 'e-[0-9]' src/ ; echo "encore-check-done"
grep -rnE 'Spicetify|window|document' src/previewEngine.ts src/previewSource.ts src/settings.ts src/collections/ ; echo "purity-check-done"
grep -rn 'Spicetify.Player' src/ | grep -v playerCoordinator | grep -v 'spotify/ports.ts'
grep -rnE '\.playUri|\.seek\(' src/
```
Expected: no `e-[0-9]` matches; no `Spicetify`/`window`/`document` in the pure modules; `Spicetify.Player` referenced only in `spotify/ports.ts` (the `PlayerPort` adapter); no `playUri`/`seek` anywhere.

- [ ] **Step 3: Confirm docs and config tasks landed**

Run: `git log --oneline main..HEAD`
Expected: commits for CLAUDE.md, the CDP harness, and (if changed) README. Confirm the deferred-issue/ADR verification (Task 24) was performed.

- [ ] **Step 4: Full gate**

Run: `bun run check`
Expected: typecheck clean, all suites pass.

- [ ] **Step 5: Record the audit** — no commit; list any gaps found and fix them in their owning task before continuing.

---

## Task 26: Final build

**Files:** none.

- [ ] **Step 1: Build for real**

Run: `bun run build`
Expected: writes `track-playlist-preview.js` into the Spicetify Extensions folder with no bundler errors. If it fails, fix the cause (a build-time failure the typecheck did not catch) and re-run until green — this task is non-negotiable.

- [ ] **Step 2: Apply and sanity-check**

Run: `spicetify apply`
Expected: Spotify reloads with the extension loaded and no console errors on startup (`node scripts/cdp-eval.mjs 'typeof Spicetify'` → `"object"`; check the renderer console for extension errors).

- [ ] **Step 3: Advisory cross-model review (optional, non-gating)**

If a cross-model review helper is available (e.g. the Codex plugin's adversarial review), run it with focus: *"Judge correctness against the spec's acceptance criteria (AC1–AC45) only. Do not flag anything outside the stated criteria — no design alternatives, hardening, or scope the spec did not claim."* This never gates the merge; the gate remains `bun run check` + `bun run build`. Address anything it surfaces that maps to a real AC gap; otherwise proceed. If no helper is available, finish without it.

- [ ] **Step 4: Finish the branch**

Use superpowers:finishing-a-development-branch to choose how to integrate the work (merge / PR / cleanup).

---

## Self-Review

**Spec coverage (AC1–AC45 → task):**

- AC1, AC2, AC4, AC6, AC7 → Task 5 (playlist/album). AC3 → Task 6. AC5 → Task 7. AC35 URI classification → Task 8; menu behaviour → Task 17.
- AC9, AC10, AC11 → Task 4. AC12 → Task 9 (engine, lazy resolution).
- AC13 → engine half Task 9, full (Snackbar/controls/resume) Task 19. AC14–AC23 → Task 9.
- AC24, AC25, AC26 → Task 10; AC27 → Task 10 (coordinator) + Task 19 (wiring); AC28 → Task 10 (port shape) + Task 25 (grep audit).
- AC29–AC32, AC34 → Task 15. AC33 → Task 16 + Task 19. AC35–AC37 → Task 17. AC38, AC40, AC41 → Task 19. AC39 → Task 14 + Task 19.
- AC42 → Task 18; AC43, AC44 → Task 3; AC45 → Task 9 (config port read per track).
- Design constraints (encore string, sha256Hash, Player-only-in-coordinator, engine purity) → enforced in Tasks 9/10/11/15 and audited in Task 25.
- Config Impact files → Task 20 (cdp-eval), Task 23 (vitest decision); rest **Done** per spec. Documentation Updates → Task 21 (CLAUDE.md), Task 22 (README), ADR verified Task 24. Deferred items → Task 24. Isolated workspace → Task 1. Post-impl check → Task 25. Final build → Task 26.

**Placeholder scan:** no "TBD"/"handle edge cases"/"add validation"/"similar to Task N". Every code step carries complete code; every test step carries assertions; the two live-shape risks (artist overview, single-track metadata) are called out with an explicit reconcile-together instruction rather than left vague.

**Type consistency:** `TrackRef {uri,name,artist}`, `EngineEvent` variants, `PlayerPort`, `StoragePort`, `PreviewSource`, `CollectionDeps`/`UriMatcher`, `EngineConfigPort` names are used identically across the tasks that define and consume them. The engine reads duration/gap through `EngineConfigPort` getters (never captured at start), which is what makes AC45 hold. The controller's `sessionEnded`/`replaced` handling matches the engine's emitted `EndReason` values.

**Known live-verification risks (surfaced, not hidden):** the exact `queryArtistOverview` and single-track metadata GraphQL shapes are asserted against fixtures and must be confirmed live in Tasks 11/12; the tracklist-row and action-bar DOM selectors (`.main-trackList-trackListRow`, `.main-actionBar-ActionBarRow`, `[data-encore-id="buttonTertiary"]`) are the spec's verified anchors but are confirmed end-to-end in Task 19. The Playbar `"stop"` icon may not be in the `Icon` union — flagged inline in Task 16.
