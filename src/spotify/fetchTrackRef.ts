// src/spotify/fetchTrackRef.ts
// Fetches display metadata for a single track URI. Bare-track preview entry
// points (context menu) only receive a URI; the Snackbar (AC38) needs a name
// and artist. Falls back to a readable label if the lookup shape shifts.
import type { TrackRef } from "../types/domain";

export async function fetchTrackRef(uri: string): Promise<TrackRef> {
  try {
    const res = await Spicetify.GraphQL.Request(Spicetify.GraphQL.Definitions.trackPreview, { uris: [uri] });
    const entity: any = res?.data?.lookup?.[0]?.data;
    const name: string | undefined = entity?.name;
    const artist: string | undefined = entity?.artists?.items?.map((a: any) => a?.profile?.name).filter(Boolean).join(", ");
    if (name) return { uri, name, artist: artist ?? "" };
  } catch {
    // fall through to the label fallback
  }
  return { uri, name: uri.split(":").pop() ?? uri, artist: "" };
}
