// Finding the glyph files of a UFO layer, and making the file names of new
// layers and glyphs.
//
// Files are read through read(path), which returns the text of a file, or
// undefined when there is none, so that the same code reads a folder on disk
// (the CLI) and files held in memory (the download from the editor). Paths
// are joined with "/".

import { parseXMLPlist } from "./plist.js";

/**
 * The glyphs of one layer of a UFO.
 * @param {(path: string) => string|undefined} read
 * @param {string} ufoPath path of the .ufo directory
 * @param {string|null} layerName the layer, or null for the default layer
 * @returns {Map<string, string>} glyph name -> path of its .glif file
 */
export function layerGlyphFiles(read, ufoPath, layerName) {
  const directory = `${ufoPath}/${layerDirectory(read, ufoPath, layerName)}`;
  const text = read(`${directory}/contents.plist`);
  if (text === undefined) {
    return new Map();
  }
  const contents = parseXMLPlist(text) ?? {};
  return new Map(
    Object.entries(contents).map(([glyphName, fileName]) => [
      glyphName,
      `${directory}/${fileName}`,
    ])
  );
}

function layerDirectory(read, ufoPath, layerName) {
  const text = read(`${ufoPath}/layercontents.plist`);
  if (text === undefined) {
    // UFO 2 has only the default layer
    if (layerName) {
      throw new Error(`${ufoPath} has no layer "${layerName}"`);
    }
    return "glyphs";
  }
  const layers = parseXMLPlist(text) ?? [];
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

// As in ufoLib (fontTools.ufoLib.filenames)
const ILLEGAL_CHARACTERS = new Set('"*+/:<>?[\\]|'.split(""));
const RESERVED_NAMES = new Set(
  "CON PRN AUX CLOCK$ NUL A:-Z: COM1 LPT1 LPT2 LPT3 COM2 COM3 COM4".split(" ")
);
const MAX_FILE_NAME_LENGTH = 255;

/**
 * A file name for a glyph or layer name, as in the UFO specification ("user
 * name to file name convention"): illegal characters become "_", capitals
 * get a "_" after them, and names already taken (in any case) get a number.
 * @param {string} name
 * @param {Set<string>} taken lower-cased file names already used; the new
 *   one is added
 * @param {string} [prefix] e.g. "glyphs." for layer directories
 * @param {string} [suffix] e.g. ".glif"
 */
export function userNameToFileName(name, taken, prefix = "", suffix = "") {
  let body = [...name]
    .map((c) =>
      c.codePointAt(0) < 0x20 || c.codePointAt(0) === 0x7f || ILLEGAL_CHARACTERS.has(c)
        ? "_"
        : c !== c.toLowerCase()
          ? `${c}_`
          : c
    )
    .join("");
  if (body.startsWith(".")) {
    body = `_${body.slice(1)}`;
  }
  body = body
    .split(".")
    .map((part) => (RESERVED_NAMES.has(part.toUpperCase()) ? `_${part}` : part))
    .join(".");
  const room = MAX_FILE_NAME_LENGTH - prefix.length - suffix.length;
  body = body.slice(0, room);
  let fileName = `${prefix}${body}${suffix}`;
  for (let counter = 1; taken.has(fileName.toLowerCase()); counter++) {
    const number = String(counter).padStart(15, "0");
    fileName = `${prefix}${body.slice(0, room - number.length)}${number}${suffix}`;
  }
  taken.add(fileName.toLowerCase());
  return fileName;
}
