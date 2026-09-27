import type { TrackRef } from "../types/domain";

/** The subset of a Platform track item this extension reads. */
export interface RawTrackItem {
  uri: string;
  type?: string;
  name?: string;
  isLocal?: boolean;
  isPlayable?: boolean;
  artists?: { name: string }[];
  album?: { images?: { url?: string; label?: string }[] };
}

/** AC6: only playable, non-local, `track`-type entries are previewable. */
export function isEligibleTrack(item: RawTrackItem): boolean {
  if (!item?.uri) return false;
  if (item.type !== undefined && item.type !== "track") return false;
  if (item.isLocal === true) return false;
  if (item.isPlayable === false) return false;
  return item.uri.startsWith("spotify:track:");
}

/** AC59: pick the standard-labelled image, or the first image, or undefined. */
export function pickArtwork(images: { url?: string; label?: string }[] | undefined): string | undefined {
  if (!images || images.length === 0) return undefined;
  // Look for standard-labelled image
  const standard = images.find((img) => img.label === "standard");
  if (standard?.url) return standard.url;
  // Fall back to first image
  return images[0]?.url;
}

export function toTrackRef(item: RawTrackItem): TrackRef {
  return {
    uri: item.uri,
    name: item.name ?? "",
    artist: item.artists?.map((a) => a.name).join(", ") ?? "",
    artworkUrl: pickArtwork(item.album?.images),
  };
}
