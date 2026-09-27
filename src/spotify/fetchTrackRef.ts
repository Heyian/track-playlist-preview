// src/spotify/fetchTrackRef.ts
// Fetches display metadata for a single track URI. Bare-track preview entry
// points (context menu) only receive a URI; the panel (AC69) needs a name,
// artists and artwork. Falls back to a readable label if the lookup fails.
import type { TrackRef } from "../types/domain";

/** Parses the response from getTrack GraphQL operation into a TrackRef. */
export function parseGetTrack(uri: string, res: unknown): TrackRef | null {
  const trackUnion = (res as any)?.data?.trackUnion;
  if (!trackUnion?.name) return null;

  const name = trackUnion.name;

  // Collect first artist and other artists, join with ", "
  const firstArtistNames =
    trackUnion.firstArtist?.items?.map?.((a: any) => a?.profile?.name).filter(Boolean) ?? [];
  const otherArtistNames =
    trackUnion.otherArtists?.items?.map?.((a: any) => a?.profile?.name).filter(Boolean) ?? [];
  const allArtists = [...firstArtistNames, ...otherArtistNames];
  const artist = allArtists.join(", ");

  // Pick artwork from coverArt.sources: prefer 300px (standard), fall back to first
  const sources = trackUnion.albumOfTrack?.coverArt?.sources;
  let artworkUrl: string | undefined;
  if (sources && Array.isArray(sources)) {
    const standard = sources.find((img: any) => img.width === 300);
    artworkUrl = standard?.url ?? sources[0]?.url;
  }

  const result: TrackRef = { uri, name, artist };
  if (artworkUrl) {
    result.artworkUrl = artworkUrl;
  }
  return result;
}

export async function fetchTrackRef(uri: string): Promise<TrackRef> {
  try {
    const res = await Spicetify.GraphQL.Request(Spicetify.GraphQL.Definitions.getTrack, { uri });
    const result = parseGetTrack(uri, res);
    if (result) return result;
  } catch {
    // fall through to the label fallback
  }
  return { uri, name: uri.split(":").pop() ?? uri, artist: "" };
}
