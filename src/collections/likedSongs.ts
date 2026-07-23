// Liked Songs (spotify:collection:tracks) answers LibraryAPI.getTracks, NOT
// PlaylistAPI (which errors "Invalid playlist response!" on that URI).
import type { TrackRef } from "../types/domain";
import { isEligibleTrack, toTrackRef, type RawTrackItem } from "./eligibility";

export interface LibraryApi {
  getTracks(options: { limit: number; offset: number }): Promise<{
    items: RawTrackItem[];
    totalLength?: number;
    unfilteredTotalLength?: number;
  }>;
}

const PAGE = 100;

export async function enumerateLikedSongs(api: LibraryApi): Promise<TrackRef[]> {
  const out: TrackRef[] = [];
  let offset = 0;
  for (;;) {
    const page = await api.getTracks({ limit: PAGE, offset });
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
