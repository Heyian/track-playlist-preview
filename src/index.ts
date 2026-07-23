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
