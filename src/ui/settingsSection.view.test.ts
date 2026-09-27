import { describe, it, expect } from "vitest";
import { formatSeconds, parseSeconds } from "./settingsSection.view";

describe("formatSeconds (S7)", () => {
  it.each([
    [15000, "15"],
    [500, "0.5"],
    [1250, "1.25"],
    [0, "0"],
  ])("%d ms → %s", (ms, text) => {
    expect(formatSeconds(ms)).toBe(text);
  });
});

describe("parseSeconds with a 1000 ms minimum (S8)", () => {
  it.each([
    ["15", 15000],
    [" 2 ", 2000],
    ["1.5", 1500],
    ["1.2345", 1235],
    ["0.9996", 1000],
    ["007", 7000],
    ["1.50", 1500],
  ])("%j → %d", (text, ms) => {
    expect(parseSeconds(text, 1000)).toBe(ms);
  });

  it.each(["0.9", "", "abc", "-1", "1e3", "Infinity", ".5"])("%j → null", (text) => {
    expect(parseSeconds(text, 1000)).toBeNull();
  });
});

describe("parseSeconds with a 0 ms minimum (S8)", () => {
  it.each([
    ["0,5", 500],
    [" 0,5 ", 500],
    ["0", 0],
  ])("%j → %d", (text, ms) => {
    expect(parseSeconds(text, 0)).toBe(ms);
  });
});
