// src/index.ts
// Entry point: the v3 loader calls load(ctx). It waits (capped) for client
// readiness, then builds one wiring — live adapters, the pure core and the UI —
// and registers its dispose with ctx.defer. Every load() builds a fresh wiring,
// and unload disposes all of it (unload-teardown spec, U20–U24).
import { createSettings, type Settings } from "./settings";
import { createPreviewSource } from "./previewSource";
import { enumerate, collectionTypeForUri } from "./collections";
import { createPreviewEngine } from "./previewEngine";
import { createPlayerCoordinator } from "./playerCoordinator";
import { createPreviewController } from "./previewController";
import { createPendingRemovals, removalFailedMessage } from "./pendingRemovals";
import {
  createAudioPort,
  realTimer,
  createPlayerPort,
  localStorageAdapter,
  trackPreviewRequest,
  createCollectionDeps,
  spicetifyUriMatcher,
  playlistMetadata,
  playlistRemove,
  artistOverviewRequest,
} from "./spotify/ports";
import { createCollectionLabel } from "./spotify/collectionLabel";
import { fetchTrackRef } from "./spotify/fetchTrackRef";
import { notifications } from "./ui/notifications";
import { rowHighlight } from "./ui/rowHighlight";
import { createActionBarButton } from "./ui/actionBarButton";
import { createPreviewPanel } from "./ui/previewPanel";
import { progressFraction } from "./ui/previewPanel.view";
import { createContextMenus } from "./ui/contextMenus";
import { registerSettingsSection, type ModuleRuntimeContext } from "./ui/settingsSection";
import { waitForClient, READY_TIMEOUT_MS } from "./waitForClient";
import { createDisposer } from "./teardown";
import type { CollectionType } from "./types/domain";

/** The client-readiness globals still absent, as `"Spicetify.<Name>"`. */
function missingGlobals(): string[] {
  const s = (globalThis as { Spicetify?: Partial<Record<string, unknown>> }).Spicetify;
  return (["React", "ReactDOM", "ContextMenu", "Platform"] as const).filter((name) => !s?.[name]).map((name) => `Spicetify.${name}`);
}

export async function load(ctx: ModuleRuntimeContext): Promise<void> {
  // Rejects after READY_TIMEOUT_MS; the loader then records the module as failed (S4, S18).
  await waitForClient({ missing: missingGlobals, timer: realTimer, timeoutMs: READY_TIMEOUT_MS });

  const { settings, dispose } = wire(); // throws → already disposed (U22)
  // Deferred before the registrar exists, so on unload (reverse order) the
  // settings section goes first, then this wiring.
  ctx.defer(dispose);
  try {
    registerSettingsSection(ctx, settings);
  } catch (error) {
    // load() rejecting means the loader never runs our disposers (partial-load
    // leak), so dispose here; a later deferred call is a no-op (U24).
    try {
      dispose();
    } catch {
      // The original error is the one load() reports.
    }
    throw error;
  }
}

/**
 * Build live adapters, wire the pure core and register the non-registrar UI.
 * Each piece's teardown is recorded as soon as the piece exists, so a throw
 * part-way disposes what was built (in reverse) and re-throws (U22).
 */
function wire(): { settings: Settings; dispose: () => void } {
  const built: (() => void)[] = [];
  try {
    return build(built);
  } catch (error) {
    try {
      createDisposer([...built].reverse())();
    } catch {
      // The original error is the one load() reports.
    }
    throw error;
  }
}

function build(built: (() => void)[]): { settings: Settings; dispose: () => void } {
  const settings = createSettings(localStorageAdapter);
  const source = createPreviewSource(trackPreviewRequest);
  const collectionDeps = createCollectionDeps();
  const classify = (uri: string): CollectionType | null => collectionTypeForUri(uri, spicetifyUriMatcher);

  const coordinator = createPlayerCoordinator(createPlayerPort());
  const audio = createAudioPort();

  // Removals outlive sessions (R10), so this is built once, not per session.
  const pendingRemovals = createPendingRemovals({
    timer: realTimer,
    remove: playlistRemove,
    onError: (title, playlist) => notifications.error(removalFailedMessage(title, playlist)), // R15
  });
  built.push(() => pendingRemovals.flush());

  // Late binding: the panel and engine call into the controller, which is
  // built after them. Each lambda resolves `controller` at call time.
  let controller: ReturnType<typeof createPreviewController>;
  const panel = createPreviewPanel({
    onStop: () => controller.stop(),
    onClose: () => controller.stop(), // AC51
    onNext: () => controller.next(),
    onRemove: () => controller.removeCurrent(),
    progress: () => progressFraction(audio.sample(), settings.getDurationMs()),
    removals: pendingRemovals,
    getPanelPosition: () => settings.getPanelPosition(),
    onSettingsChange: (listener) => settings.onChange(listener),
  });
  built.push(() => panel.dispose());
  const engine = createPreviewEngine({
    audio,
    timer: realTimer,
    resolve: (uri) => source.resolve(uri),
    config: { getDurationMs: () => settings.getDurationMs(), getGapMs: () => settings.getGapMs() },
    emit: (event) => controller.onEvent(event),
    isExcluded: (uri) => controller.isExcluded(uri), // R13
  });

  controller = createPreviewController({
    engine,
    coordinator,
    enumerate: (uri) => enumerate(uri, collectionDeps, classify),
    fetchTrackRef,
    collectionTypeForUri: classify,
    notify: notifications,
    highlight: rowHighlight,
    onActiveCollection: () => actionBar.refresh(),
    panel,
    collectionLabel: createCollectionLabel({ playlistMetadata, artistOverview: artistOverviewRequest }),
    playlistMetadata,
    pendingRemovals,
  });
  built.push(() => controller.dispose());

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
  built.push(() => actionBar.stop());

  const contextMenus = createContextMenus({
    collectionTypeForUri: classify,
    isEnabled: (type) => settings.isEnabled(type),
    onPreviewCollection: (uri) => void controller.startCollection(uri, 0),
    onPreviewTrack: (uri) => void controller.startTrack(uri),
    onPreviewFromHere: (uri, contextUri) => void controller.startFromHere(uri, contextUri),
    getDurationMs: () => settings.getDurationMs(),
    currentCollectionUri: () => currentCollectionUri(),
    onSettingsChange: (listener) => settings.onChange(listener),
  });
  built.push(() => contextMenus.dispose());

  actionBar.start();
  contextMenus.register();

  // Unload order (spec: Teardown steps): end the session first so playback is
  // restored, then commit pending removals (U6), then remove the UI.
  const dispose = createDisposer([
    () => controller.dispose(),
    () => pendingRemovals.flush(),
    () => contextMenus.dispose(),
    () => actionBar.stop(),
    () => panel.dispose(),
    () => rowHighlight.clear(),
  ]);
  return { settings, dispose };
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
