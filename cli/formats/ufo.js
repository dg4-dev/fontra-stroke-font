// Finding the glyph files of a UFO layer.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parseXMLPlist } from "./plist.js";

/**
 * The glyphs of one layer of a UFO.
 * @param {string} ufoPath path of the .ufo directory
 * @param {string|null} layerName the layer, or null for the default layer
 * @returns {Map<string, string>} glyph name -> path of its .glif file
 */
export function layerGlyphFiles(ufoPath, layerName) {
  const directory = join(ufoPath, layerDirectory(ufoPath, layerName));
  const contentsPath = join(directory, "contents.plist");
  if (!existsSync(contentsPath)) {
    return new Map();
  }
  const contents = parseXMLPlist(readFileSync(contentsPath, "utf-8")) ?? {};
  return new Map(
    Object.entries(contents).map(([glyphName, fileName]) => [
      glyphName,
      join(directory, fileName),
    ])
  );
}

function layerDirectory(ufoPath, layerName) {
  const layerContentsPath = join(ufoPath, "layercontents.plist");
  if (!existsSync(layerContentsPath)) {
    // UFO 2 has only the default layer
    if (layerName) {
      throw new Error(`${ufoPath} has no layer "${layerName}"`);
    }
    return "glyphs";
  }
  const layers = parseXMLPlist(readFileSync(layerContentsPath, "utf-8")) ?? [];
  if (!layerName) {
    // The default layer is stored in "glyphs"
    return "glyphs";
  }
  const entry = layers.find(([name]) => name === layerName);
  if (!entry) {
    throw new Error(`${ufoPath} has no layer "${layerName}"`);
  }
  return entry[1];
}
