import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkDist } from "./checkDist";

const SOURCE = {
  name: "track-playlist-preview",
  version: "0.1.0",
  entries: { js: "index.js", css: "index.css" },
};

let root: string;

async function fixture(
  folder = "track-playlist-preview@0.1.0",
  files: Record<string, string> = {},
): Promise<string> {
  root = await mkdtemp(join(tmpdir(), "check-dist-"));
  const dir = join(root, folder);
  await mkdir(dir);
  const all: Record<string, string> = {
    "index.js": 'import React from "/modules/stdlib/src/expose/react-shim.js";\n',
    "index.js.map": "{}",
    "index.css": ".tpp-previewing-row{}#tpp-preview-root{}",
    "metadata.json": JSON.stringify(SOURCE),
    "spicetify-module.json": "{}",
    ...files,
  };
  for (const [name, content] of Object.entries(all)) await writeFile(join(dir, name), content);
  return dir;
}

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("checkDist", () => {
  it("passes a well-formed folder", async () => {
    expect(checkDist(await fixture(), SOURCE)).toEqual([]);
  });

  it("reports each missing file", async () => {
    const dir = await fixture();
    await rm(join(dir, "index.js.map"));
    const problems = checkDist(dir, SOURCE);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("index.js.map");
  });

  it("reports metadata that differs from the source", async () => {
    const dir = await fixture(undefined, { "metadata.json": JSON.stringify({ ...SOURCE, version: "0.1.1" }) });
    expect(checkDist(dir, SOURCE)).not.toEqual([]);
  });

  it("reports a folder name that does not match name@version", async () => {
    expect(checkDist(await fixture("track-playlist-preview"), SOURCE)).not.toEqual([]);
  });

  it("reports css with the panel rules before the row rules", async () => {
    const dir = await fixture(undefined, { "index.css": "#tpp-preview-root{}.tpp-previewing-row{}" });
    expect(checkDist(dir, SOURCE)).not.toEqual([]);
  });

  it("reports css missing either rule set", async () => {
    const noRow = await fixture(undefined, { "index.css": "#tpp-preview-root{}" });
    expect(checkDist(noRow, SOURCE)).not.toEqual([]);
    await rm(root, { recursive: true, force: true });
    const noPanel = await fixture(undefined, { "index.css": ".tpp-previewing-row{}" });
    expect(checkDist(noPanel, SOURCE)).not.toEqual([]);
  });

  it("reports index.js without the react-shim import", async () => {
    const dir = await fixture(undefined, { "index.js": "const React = Spicetify.React;\n" });
    expect(checkDist(dir, SOURCE)).not.toEqual([]);
  });

  it("accepts a matching tag", async () => {
    expect(checkDist(await fixture(), SOURCE, "v0.1.0")).toEqual([]);
  });

  it("rejects a mismatched tag", async () => {
    const dir = await fixture();
    expect(checkDist(dir, SOURCE, "v0.1.1")).not.toEqual([]);
    expect(checkDist(dir, SOURCE, "0.1.0")).not.toEqual([]);
  });
});
