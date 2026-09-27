// src/index.ts
// Entry point: build live adapters, wire the pure core, register UI.
// build.ts has already awaited Spicetify.React/ReactDOM/Platform; other
// namespaces (ContextMenu, GraphQL, Menu) are checked here.
import { createSettings } from "./settings";
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
import { registerSettingsMenu } from "./ui/settingsModal";
import type { CollectionType } from "./types/domain";

async function main(): Promise<void> {
  // Namespaces build.ts does not wait for.
  while (!Spicetify?.GraphQL || !Spicetify?.ContextMenu || !Spicetify?.Menu) {
    await new Promise((r) => setTimeout(r, 50));
  }

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
