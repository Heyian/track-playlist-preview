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
