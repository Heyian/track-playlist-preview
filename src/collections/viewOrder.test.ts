import { describe, it, expect } from "vitest";
import { createViewOrder, type ViewOrderDeps } from "./viewOrder";

const P = "spotify:playlist:P";
const Q = "spotify:playlist:Q";
const LIKED = "spotify:collection:tracks";

let state: unknown;
let page: string | null;
let text: string | null;

function setup(overrides: Partial<ViewOrderDeps> = {}) {
  return createViewOrder({
    readSortedState: () => state,
    likedSongsPlaylistUri: () => "spotify:playlist:liked",
    currentCollectionUri: () => page,
    readFilterText: () => text,
    ...overrides,
  });
}

function reset(s: unknown, p: string | null = null, t: string | null = null): void {
  state = s;
  page = p;
  text = t;
}

describe("viewOrder.viewFor", () => {
  it("V1: returns the saved sort for P", () => {
    reset({ [P]: { field: "ADDED_AT", order: "DESC" } });
    expect(setup().viewFor(P, "playlist")).toEqual({ sort: { field: "ADDED_AT", order: "DESC" } });
  });

  it("V2: no entry → no sort key", () => {
    reset({});
    const result = setup().viewFor(P, "playlist");
    expect(result).toEqual({});
    expect("sort" in result).toBe(false);
  });

  it("V3: passes an unknown non-empty field through", () => {
    reset({ [P]: { field: "MOOD", order: "ASC" } });
    expect(setup().viewFor(P, "playlist").sort).toEqual({ field: "MOOD", order: "ASC" });
  });

  it("V4: a malformed entry yields no sort", () => {
    for (const entry of [null, "TITLE", 3, { field: "" }, { field: 5 }, { order: "ASC" }]) {
      reset({ [P]: entry });
      expect(setup().viewFor(P, "playlist").sort).toBeUndefined();
    }
  });

  it("V4: a throwing read yields no sort", () => {
    reset({});
    const view = setup({
      readSortedState: () => {
        throw new Error("x");
      },
    });
    expect(view.viewFor(P, "playlist")).toEqual({});
  });

  it("V4: a non-object sortedState map yields no sort", () => {
    for (const s of [null, undefined, "{}", 7, []]) {
      reset(s);
      expect(setup().viewFor(P, "playlist")).toEqual({});
    }
  });

  it("V5: an invalid order keeps the field only", () => {
    reset({ [P]: { field: "TITLE", order: "UP" } });
    const sort = setup().viewFor(P, "playlist").sort;
    expect(sort).toEqual({ field: "TITLE" });
    expect(sort && "order" in sort).toBe(false);
  });

  it("V6: filter when the open page is P", () => {
    reset({}, P, "  live  ");
    expect(setup().viewFor(P, "playlist").filter).toBe("live");
  });

  it("V7: no filter when the open page is a different collection", () => {
    reset({ [Q]: { field: "TITLE", order: "ASC" } }, P, "live");
    expect(setup().viewFor(Q, "playlist")).toEqual({ sort: { field: "TITLE", order: "ASC" } });
  });

  it("V8: empty or absent box → no filter", () => {
    for (const t of [null, "", "   "]) {
      reset({}, P, t);
      expect("filter" in setup().viewFor(P, "playlist")).toBe(false);
    }
  });

  it("V10: Liked Songs sort is keyed by the internal playlist URI only", () => {
    reset({ "spotify:playlist:liked": { field: "TITLE", order: "ASC" }, [LIKED]: { field: "ARTIST", order: "ASC" } }, LIKED, "x");
    expect(setup().viewFor(LIKED, "likedSongs")).toEqual({ sort: { field: "TITLE", order: "ASC" }, filter: "x" });
  });

  it("V11: Liked Songs with no internal URI has no sort", () => {
    reset({ "spotify:playlist:liked": { field: "TITLE", order: "ASC" }, [LIKED]: { field: "ARTIST", order: "ASC" } }, LIKED, "x");
    expect(setup({ likedSongsPlaylistUri: () => null }).viewFor(LIKED, "likedSongs").sort).toBeUndefined();
  });

  it("V13: albums, artists and unknown types get {}", () => {
    const A = "spotify:album:A";
    const R = "spotify:artist:R";
    const T = "spotify:track:T";
    const entry = { field: "TITLE", order: "ASC" };
    for (const [uri, type] of [[A, "album"], [R, "artist"], [T, null]] as const) {
      reset({ [A]: entry, [R]: entry, [T]: entry }, uri, "x");
      expect(setup().viewFor(uri, type)).toEqual({});
    }
  });

  it("V14: each call reads the readers afresh and returns an independent object", () => {
    reset({ [P]: { field: "TITLE", order: "ASC" } }, P, "live");
    const view = setup();
    const first = view.viewFor(P, "playlist");
    state = { [P]: { field: "ARTIST", order: "DESC" } };
    text = "rock";
    expect(first).toEqual({ sort: { field: "TITLE", order: "ASC" }, filter: "live" });
    expect(view.viewFor(P, "playlist")).toEqual({ sort: { field: "ARTIST", order: "DESC" }, filter: "rock" });
  });
});
