// Reading and writing the glyphs of a .fontra folder (Fontra's own format):
// font-data.json holds the axes and the font sources, glyphs/ one JSON file
// per glyph with its sources and their layers.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { mapValue } from "./designspace.js";

/**
 * The glyph files of a .fontra folder.
 * @param {string} fontraPath path of the .fontra folder
 * @returns {Map<string, string>} glyph name (from the file name, as Fontra
 *   reads it) -> path of its .json file, by glyph name
 */
export function fontraGlyphFiles(fontraPath) {
  const directory = join(fontraPath, "glyphs");
  if (!existsSync(directory)) {
    return new Map();
  }
  const files = readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => [
      fileNameToGlyphName(name.slice(0, -".json".length)),
      join(directory, name),
    ]);
  return new Map(files.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

// As Fontra's fileNameToString(): the part before "^" (which tells upper
// from lower case), with %XX escapes decoded
function fileNameToGlyphName(stem) {
  return decodeURIComponent(stem.split("^")[0]);
}

/**
 * A JSON file of a .fontra folder. An error names the file.
 */
export function readJSON(path) {
  const text = readFileSync(path, "utf-8");
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${path}: ${e.message}`);
  }
}

/**
 * The index of the glyph's source at the default location, as Fontra finds
 * it: the first active source whose location (its font source's location,
 * then its own) has the default value on every axis, the glyph's own axes
 * before the font's. An axis missing from a location is at its default.
 * @param {object} glyph the glyph, as read from its .json file
 * @param {object} fontData font-data.json
 * @returns {number} the index in glyph.sources (0 when no source is there)
 */
export function defaultSourceIndex(glyph, fontData) {
  const defaults = {};
  for (const axis of fontData.axes?.axes ?? []) {
    // Font axes are in user space; sources are located in source space
    defaults[axis.name] = mapValue(axis.defaultValue, axis.mapping ?? []);
  }
  for (const axis of glyph.axes ?? []) {
    defaults[axis.name] = axis.defaultValue;
  }
  const index = (glyph.sources ?? []).findIndex((source) => {
    if (source.inactive) {
      return false;
    }
    const location = {
      ...fontData.sources?.[source.locationBase]?.location,
      ...source.location,
    };
    return Object.entries(defaults).every(
      ([name, value]) => Math.abs((location[name] ?? value) - value) < 1e-9
    );
  });
  return Math.max(index, 0);
}

/**
 * The name of a glyph source: its own, or its font source's.
 */
export function glyphSourceName(source, fontData) {
  return source.name || fontData.sources?.[source.locationBase]?.name || "";
}

/**
 * JSON as Fontra writes it (Python's json.dumps() with indent=0): one value
 * per line, without indentation, and a line break at the end.
 */
export function serializeFontraJSON(value) {
  return serialize(value) + "\n";
}

function serialize(value) {
  if (Array.isArray(value)) {
    return value.length ? `[\n${value.map(serialize).join(",\n")}\n]` : "[]";
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    return entries.length
      ? `{\n${entries.map(([k, v]) => `${JSON.stringify(k)}: ${serialize(v)}`).join(",\n")}\n}`
      : "{}";
  }
  return JSON.stringify(value);
}
