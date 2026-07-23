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
