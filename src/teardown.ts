// Runs teardown steps in order, each isolated from the others' errors (U23),
// and only once (U24). Pure: no Spicetify access.

export function createDisposer(steps: readonly (() => void)[]): () => void {
  const pending = [...steps];
  let done = false;
  return () => {
    if (done) return;
    done = true;
    let first: { error: unknown } | null = null;
    for (const step of pending) {
      try {
        step();
      } catch (error) {
        first ??= { error };
      }
    }
    if (first) throw first.error;
  };
}
