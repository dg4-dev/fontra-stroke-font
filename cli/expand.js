// Expanding the centerlines of a font into outlines, in a copy of the font:
// copying the files on disk. The expanding itself is in expand-font.js.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { parseDesignspace } from "./formats/designspace.js";
import { escapeAttribute } from "./formats/xml.js";
import { expandFont } from "./expand-font.js";

/**
 * Copy a designspace and its UFOs into outDir, with the open contours of
 * every glyph replaced by their stroked outlines. The input is not changed.
 *
 * @param {string} designspacePath the .designspace file
 * @param {string} outDir the folder to write the copy to
 * @param {{tolerance?: number}} [options]
 * @returns {{designspace: string, glyphs: number, warnings: string[],
 *   twists: string[]}} the path of the copy, the number of glyphs expanded,
 *   problems found, and where strokes twist
 */
export function expandDesignspace(designspacePath, outDir, options = {}) {
  const inputPath = resolve(designspacePath);
  const outputDir = resolve(outDir);
  const inputDir = dirname(inputPath);
  if (existsSync(outputDir) && realpathSync(outputDir) === realpathSync(inputDir)) {
    throw new Error("the output folder must not be the folder of the input");
  }
  const text = readFileSync(inputPath, "utf-8");
  const { sources } = parseDesignspace(text);
  if (!sources.length) {
    throw new Error("the designspace has no sources");
  }

  // Each UFO is copied into outDir under its own file name
  const ufoCopies = new Map();
  for (const source of sources) {
    if (ufoCopies.has(source.filename)) {
      continue;
    }
    const name = basename(source.filename);
    if ([...ufoCopies.values()].includes(name)) {
      throw new Error(`two sources use different UFOs named ${name}`);
    }
    ufoCopies.set(source.filename, name);
  }
  mkdirSync(outputDir, { recursive: true });
  for (const [filename, name] of ufoCopies) {
    const target = join(outputDir, name);
    if (resolve(inputDir, filename) === target) {
      throw new Error(`${name} would be overwritten`);
    }
    rmSync(target, { recursive: true, force: true });
    cpSync(resolve(inputDir, filename), target, { recursive: true });
  }
  const outputDesignspace = join(outputDir, basename(inputPath));
  writeFileSync(outputDesignspace, renameSourceFiles(text, ufoCopies));

  // The copy is read and written by paths relative to outDir
  const at = (path) => join(outputDir, ...path.split("/"));
  const files = {
    read: (path) =>
      existsSync(at(path)) ? readFileSync(at(path), "utf-8") : undefined,
    write: (path, content) => writeFileSync(at(path), content),
  };
  const report = expandFont(files, basename(inputPath), options);
  return { designspace: outputDesignspace, ...report };
}

// Point the sources' filename attributes at the copies
function renameSourceFiles(text, ufoCopies) {
  return text.replace(/<source\b[^>]*>/g, (tag) =>
    tag.replace(/\bfilename="([^"]*)"/, (whole, value) => {
      const decoded = value
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
      const copy = ufoCopies.get(decoded);
      return copy === undefined ? whole : `filename="${escapeAttribute(copy)}"`;
    })
  );
}
