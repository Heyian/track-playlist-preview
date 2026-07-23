// Resolves track URIs to preview-clip URLs. Batches ≤100 per operation,
// caches by URI, and de-duplicates in-flight requests. Pure given `request`.

export type TrackPreviewRequest = (uris: string[]) => Promise<Map<string, string | null>>;

const BATCH_SIZE = 100;

export function createPreviewSource(request: TrackPreviewRequest) {
  const cache = new Map<string, string | null>();
  const inflight = new Map<string, Promise<void>>();

  async function fetchChunk(uris: string[]): Promise<void> {
    const result = await request(uris);
    for (const uri of uris) cache.set(uri, result.get(uri) ?? null);
  }

  async function resolveBatch(uris: string[]): Promise<(string | null)[]> {
    const toFetch = uris.filter((u) => !cache.has(u) && !inflight.has(u));
    for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
      const chunk = toFetch.slice(i, i + BATCH_SIZE);
      const p = fetchChunk(chunk).finally(() => {
        for (const u of chunk) inflight.delete(u);
      });
      for (const u of chunk) inflight.set(u, p);
    }
    await Promise.all(uris.map((u) => inflight.get(u)).filter((p): p is Promise<void> => Boolean(p)));
    return uris.map((u) => cache.get(u) ?? null);
  }

  return {
    resolveBatch,
    resolve: async (uri: string): Promise<string | null> => (await resolveBatch([uri]))[0] ?? null,
    prefetch: (uris: string[]): void => void resolveBatch(uris),
    clearCache: (): void => cache.clear(),
  };
}

export type PreviewSource = ReturnType<typeof createPreviewSource>;
