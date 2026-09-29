import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));

describe("release-please", () => {
  it("config bumps src/metadata.json and stays on 0.x for breaking changes", () => {
    const config = read("release-please-config.json");
    const root = config.packages["."];
    expect(root["release-type"]).toBe("node");
    expect(root["bump-minor-pre-major"]).toBe(true);
    expect(root["extra-files"]).toEqual([{ type: "json", path: "src/metadata.json", jsonpath: "$.version" }]);
    expect(config["bootstrap-sha"]).toMatch(/^[0-9a-f]{40}$/);
  });

  it("manifest starts before the first release", () => {
    expect(read(".release-please-manifest.json")).toEqual({ ".": "0.0.0" });
  });
});
