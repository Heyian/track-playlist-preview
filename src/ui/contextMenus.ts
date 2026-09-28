// src/ui/contextMenus.ts
import type { CollectionType } from "../types/domain";

export interface ContextMenuDeps {
  collectionTypeForUri(uri: string): CollectionType | null;
  isEnabled(type: CollectionType): boolean;
  onPreviewCollection(uri: string): void;
  onPreviewTrack(uri: string): void;
  onPreviewFromHere(uri: string, contextUri?: string): void;
  getDurationMs(): number;
  /** The collection URI of the page currently shown, or null. */
  currentCollectionUri(): string | null;
  /** Subscribe to settings changes; returns an unsubscribe function. */
  onSettingsChange(listener: () => void): () => void;
}

export function createContextMenus(deps: ContextMenuDeps) {
  // Only items whose register() returned, so a throw mid-register leaves
  // dispose() exactly the items to deregister (U14).
  let registered: { deregister(): void }[] = [];
  let unsubscribe: (() => void) | null = null;

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
      registered.push(collectionItem);

      // Track menu items — a single track URI (AC36/AC37).
      const isSingleTrack = (uris: string[]): boolean =>
        uris.length === 1 && Spicetify.URI.isTrack(uris[0]!);

      const trackLabel = (): string => `Preview track (${Math.round(deps.getDurationMs() / 1000)}s)`;
      const previewTrack = new Spicetify.ContextMenu.Item(
        trackLabel(),
        (uris) => {
          if (uris[0]) deps.onPreviewTrack(uris[0]);
        },
        isSingleTrack,
        "play",
      );
      previewTrack.register();
      registered.push(previewTrack);
      // The name setter relabels a registered item in place (S13).
      unsubscribe = deps.onSettingsChange(() => {
        previewTrack.name = trackLabel();
      });

      const previewFromHere = new Spicetify.ContextMenu.Item(
        "Preview from here",
        (uris, _uids, contextUri) => {
          // Live track rows arrive with contextUri null (the menu props carry
          // it at context.metadata.uri, which parseProps doesn't read), so fall
          // back to the page's collection. A track not in it still falls back
          // to a single-track session in the controller (AC37).
          if (uris[0]) deps.onPreviewFromHere(uris[0], contextUri ?? deps.currentCollectionUri() ?? undefined);
        },
        isSingleTrack,
        "play",
      );
      previewFromHere.register();
      registered.push(previewFromHere);
    },
    /** Unload: deregister every item and drop the relabel subscription (U14, U15). */
    dispose(): void {
      const items = registered;
      registered = [];
      unsubscribe?.();
      unsubscribe = null;
      for (const item of items) item.deregister();
    },
  };
}
