// Derives the view options (saved sort + page filter) a preview should enumerate
// with. Pure: every client read arrives as an injected reader (V20).
import type { CollectionType, ViewOptions } from "../types/domain";

export interface ViewOrderDeps {
  /** The raw `sortedState` map `{ [uri]: { field, order } }`; may throw. */
  readSortedState(): unknown;
  /** Liked Songs' internal `spotify:playlist:` URI, or null. */
  likedSongsPlaylistUri(): string | null;
  /** The open page's collection URI, or null. */
  currentCollectionUri(): string | null;
  /** The open page's filter box text, or null when there is no box. */
  readFilterText(): string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function savedSort(deps: ViewOrderDeps, key: string): ViewOptions["sort"] {
  let map: unknown;
  try {
    map = deps.readSortedState();
  } catch {
    return undefined; // V4
  }
  if (!isRecord(map)) return undefined;
  const entry = map[key];
  if (!isRecord(entry) || typeof entry.field !== "string" || entry.field === "") return undefined;
  // V3: the field passes through unchanged; V5: only a valid order is kept.
  return entry.order === "ASC" || entry.order === "DESC" ? { field: entry.field, order: entry.order } : { field: entry.field };
}

export function createViewOrder(deps: ViewOrderDeps): {
  viewFor(uri: string, type: CollectionType | null): ViewOptions;
} {
  return {
    viewFor(uri, type) {
      if (type !== "playlist" && type !== "likedSongs") return {}; // V13
      // V10/V11: Liked Songs' saved sort is keyed by its internal playlist URI only.
      const sortKey = type === "likedSongs" ? deps.likedSongsPlaylistUri() : uri;
      const sort = sortKey === null ? undefined : savedSort(deps, sortKey);
      // V6/V7: the filter applies only to the collection whose page is open.
      const filter = deps.currentCollectionUri() === uri ? deps.readFilterText()?.trim() : undefined;
      return {
        ...(sort !== undefined && { sort }),
        ...(filter && { filter }),
      };
    },
  };
}
