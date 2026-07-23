// Artist top tracks come from the queryArtistOverview GraphQL operation
// (top-tracks only, ~10 entries). The caller supplies the request function so
// this module stays free of Spicetify.
import type { TrackRef } from "../types/domain";

export type ArtistOverviewApi = (uri: string) => Promise<unknown>;

interface OverviewShape {
  data?: {
    artistUnion?: {
      discography?: {
        topTracks?: {
          items?: {
            track?: {
              uri?: string;
              name?: string;
              artists?: { items?: { profile?: { name?: string } }[] };
              playability?: { playable?: boolean };
            };
          }[];
        };
      };
    };
  };
}

export async function enumerateArtist(uri: string, request: ArtistOverviewApi): Promise<TrackRef[]> {
  const raw = (await request(uri)) as OverviewShape;
  const items = raw.data?.artistUnion?.discography?.topTracks?.items ?? [];
  const out: TrackRef[] = [];
  for (const entry of items) {
    const track = entry.track;
    if (!track?.uri) continue;
    if (track.playability?.playable === false) continue;
    out.push({
      uri: track.uri,
      name: track.name ?? "",
      artist: track.artists?.items?.map((a) => a.profile?.name ?? "").filter(Boolean).join(", ") ?? "",
    });
  }
  return out;
}
