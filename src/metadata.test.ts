import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const meta = JSON.parse(read("src/metadata.json"));
const pkg = JSON.parse(read("package.json"));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("src/metadata.json", () => {
  it("metadata carries the store fields", () => {
    expect(meta.name).toBe("track-playlist-preview");
    expect(meta.version).toBe(pkg.version);
    expect(meta.description).toBe(
      "Brings back Spotify's removed track preview and extends it to whole playlists, albums, artists and Liked Songs.",
    );
    expect(meta.hasMixins).toBe(false);
    expect(meta.preview).toBe("https://raw.githubusercontent.com/Heyian/track-playlist-preview/main/docs/preview.png");
    expect(meta.repository).toBe("https://github.com/Heyian/track-playlist-preview");
    expect(meta.license).toBe("MIT");
    // CLI 3.0.0-beta.19 parses authors as strings and skips a module whose authors are objects.
    expect(meta.authors).toEqual(["Heyian"]);
    expect(meta.dependencies).toEqual({ stdlib: "^1.13.0" });
    expect(meta.entries).toEqual({ js: "index.js", css: "index.css" });
    expect("tags" in meta).toBe(false);
    expect("kind" in meta).toBe(false);
  });

  it("package.json has no spicetify key and pins kit", () => {
    expect("spicetify" in pkg).toBe(false);
    expect(pkg.devDependencies["@spicetify/kit"]).toBe("0.3.1");
  });
});

describe("styles", () => {
  it("no source file imports css", () => {
    const importers = sourceFiles("src").filter((file) => /import\s+["'][^"']+\.css["']/.test(read(file)));
    expect(importers).toEqual([]);
  });

  it("index.scss uses row highlight before the panel", () => {
    expect(read("src/index.scss")).toBe('@use "ui/rowHighlight";\n@use "ui/previewPanel";\n');
  });
});
