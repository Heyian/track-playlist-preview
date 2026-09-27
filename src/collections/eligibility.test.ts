import { describe, it, expect } from "vitest";
import { pickArtwork } from "./eligibility";

describe("pickArtwork", () => {
  it("AC59: picks the standard-labelled image", () => {
    expect(pickArtwork([{ url: "spotify:image:s", label: "small" }, { url: "spotify:image:std", label: "standard" }])).toBe("spotify:image:std");
  });

  it("AC59: falls back to the first image when none is labelled standard", () => {
    expect(pickArtwork([{ url: "https://i.scdn.co/image/a" }, { url: "https://i.scdn.co/image/b" }])).toBe("https://i.scdn.co/image/a");
  });

  it("AC59: absent or empty images give undefined", () => {
    expect(pickArtwork(undefined)).toBeUndefined();
    expect(pickArtwork([])).toBeUndefined();
  });
});
