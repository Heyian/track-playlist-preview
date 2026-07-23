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
    const total = page.totalLength ?? Infinity;
    if (items.length === 0 || offset >= total) break;
  }
  return out;
}
