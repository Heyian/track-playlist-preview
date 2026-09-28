// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { rowHighlight } from "./rowHighlight";

beforeEach(() => {
  rowHighlight.clear();
  document.body.innerHTML = "";
});

function renderRow(trackId: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "main-trackList-trackListRow";
  const link = document.createElement("a");
  link.href = `/track/${trackId}`;
  row.appendChild(link);
  document.body.appendChild(row);
  return row;
}

describe("rowHighlight teardown", () => {
  it("U5: after clear, a matching row added later is not highlighted", async () => {
    rowHighlight.set("spotify:track:abc");
    rowHighlight.clear();
    renderRow("abc");
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector(".tpp-previewing-row")).toBeNull();
  });

  it("U30: clear disconnects the observer", () => {
    const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
    rowHighlight.set("spotify:track:abc");
    rowHighlight.clear();
    expect(disconnect).toHaveBeenCalled();
    disconnect.mockRestore();
  });
});
