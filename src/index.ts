// src/index.ts
// Entry point: the v3 loader calls load(ctx). It waits (capped) for client
// readiness, then builds live adapters, wires the pure core and registers UI.
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
import type { CollectionType } from "./types/domain";

/** The client-readiness globals still absent, as `"Spicetify.<Name>"`. */
function missingGlobals(): string[] {
  const s = (globalThis as { Spicetify?: Partial<Record<string, unknown>> }).Spicetify;
  return (["React", "ReactDOM", "ContextMenu", "Platform"] as const).filter((name) => !s?.[name]).map((name) => `Spicetify.${name}`);
}

// The loader imports this file once but calls load() again each time the
// module is re-enabled. Unload removes only registrar items (full teardown is
// #8), so everything else is wired once and kept.
let wired: Settings | undefined;

export async function load(ctx: ModuleRuntimeContext): Promise<void> {
  // Rejects after READY_TIMEOUT_MS; the loader then records the module as failed (S4, S18).
  await waitForClient({ missing: missingGlobals, timer: realTimer, timeoutMs: READY_TIMEOUT_MS });

  wired ??= wire();
  registerSettingsSection(ctx, wired);
}

/** Build live adapters, wire the pure core and register the non-registrar UI. */
function wire(): Settings {
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
  });
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
    getDurationMs: () => settings.getDurationMs(),
    currentCollectionUri: () => currentCollectionUri(),
    onSettingsChange: (listener) => settings.onChange(listener),
  });

  actionBar.start();
  contextMenus.register();
  return settings;
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
