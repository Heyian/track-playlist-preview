// src/ui/rowHighlight.ts
// Highlights the currently-previewing row wherever it is rendered. Rows
// virtualize, so a MutationObserver re-applies the class as they mount.

const CLASS = "tpp-previewing-row";
const ROW = ".main-trackList-trackListRow";

let currentUri: string | null = null;
let observer: MutationObserver | null = null;

/** True if `row` links to `uri` (row anchors carry /track/<id> hrefs). */
function rowMatches(row: Element, uri: string): boolean {
  const id = uri.split(":").pop();
  if (!id) return false;
  return row.querySelector(`a[href*="${id}"]`) !== null;
}

function apply(): void {
  for (const row of document.querySelectorAll(`.${CLASS}`)) row.classList.remove(CLASS);
  if (!currentUri) return;
  for (const row of document.querySelectorAll(ROW)) {
    if (rowMatches(row, currentUri)) row.classList.add(CLASS);
  }
}

function ensureObserver(): void {
  if (observer) return;
  observer = new MutationObserver(() => apply());
  observer.observe(document.body, { childList: true, subtree: true });
}

export const rowHighlight = {
  set(uri: string): void {
    currentUri = uri;
    ensureObserver();
    apply();
  },
  clear(): void {
    currentUri = null;
    apply();
    observer?.disconnect();
    observer = null;
  },
};
