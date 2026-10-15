// Expanding the centerlines of a designspace font into outlines, in a copy of
// the font.

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

import { STROKE_KEY } from "../src/stroke-data.js";
import { parseDesignspace } from "./formats/designspace.js";
import {
  addOverlapFlag,
  readGlif,
  removeLibEntry,
  rewriteGlif,
} from "./formats/glif.js";
import { layerGlyphFiles } from "./formats/ufo.js";
import { escapeAttribute } from "./formats/xml.js";
import { strokeGlyph } from "./stroke-glyph.js";

const GLYPH_CUSTOM_DATA_KEY = "xyz.fontra.customData";
const SOURCE_CUSTOM_DATA_KEY = "xyz.fontra.glyph.source.customData";
const GLYPH_DESIGNSPACE_KEY = "com.black-foundry.glyph-designspace";

/**
 * Copy a designspace and its UFOs into outDir, with the open contours of
 * every glyph replaced by their stroked outlines. The input is not changed.
 *
 * @param {string} designspacePath the .designspace file
 * @param {string} outDir the folder to write the copy to
 * @param {{tolerance?: number, removeStrokeData?: boolean}} [options]
 *   removeStrokeData: also remove the stroke settings from the glyphs of the
 *   copy
 * @returns {{output: string, glyphs: number, warnings: string[],
 *   twists: string[]}} the path of the copied designspace, the number of
 *   glyphs expanded, problems found, and where strokes twist
 */
export function expandDesignspace(designspacePath, outDir, options = {}) {
  const { removeStrokeData: removeData = false, ...strokeOptions } = options;
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

  const layers = sources.map((source) => ({
    source,
    glyphFiles: layerGlyphFiles(
      join(outputDir, ufoCopies.get(source.filename)),
      source.layer
    ),
  }));
  const defaultLayer = layers.find((layer) => layer.source.isDefault) ?? layers[0];

  const report = {
    output: outputDesignspace,
    glyphs: 0,
    warnings: [],
    twists: [],
  };
  const glyphNames = new Set(layers.flatMap((layer) => [...layer.glyphFiles.keys()]));
  const expanded = new Set();
  for (const glyphName of [...glyphNames].sort()) {
    if (expandGlyph(glyphName, layers, defaultLayer, strokeOptions, report)) {
      expanded.add(glyphName);
    }
  }
  flagGlyphsUsingExpanded(layers, expanded);
  if (removeData) {
    removeStrokeData(layers);
  }
  return report;
}

// A glyph with an expanded glyph as a component, directly or through other
// components, has overlapping contours too once it is built. ufo2ft sets the
// overlap flag of a composite glyph (OVERLAP_COMPOUND), and of a glyph whose
// components it decomposes (one with contours as well), from that glyph's own
// lib only, so such glyphs get public.truetype.overlap as well.
function flagGlyphsUsingExpanded(layers, expanded) {
  const files = layers.flatMap((layer) =>
    [...layer.glyphFiles].map(([glyphName, path]) => {
      const text = readFileSync(path, "utf-8");
      const bases = readGlif(text)
        .outline.filter((item) => item.element.name === "component")
        .map((item) => item.element.attributes.base);
      return { glyphName, path, text, bases };
    })
  );
  const overlapping = new Set(expanded);
  for (let changed = true; changed; ) {
    changed = false;
    for (const file of files) {
      if (
        !overlapping.has(file.glyphName) &&
        file.bases.some((base) => overlapping.has(base))
      ) {
        overlapping.add(file.glyphName);
        changed = true;
      }
    }
  }
  for (const file of files) {
    if (file.bases.some((base) => overlapping.has(base))) {
      const text = addOverlapFlag(file.text);
      if (text !== file.text) {
        writeFileSync(file.path, text);
      }
    }
  }
}

function expandGlyph(glyphName, layers, defaultLayer, options, report) {
  const members = layers
    .filter((layer) => layer.glyphFiles.has(glyphName))
    .map((layer) => {
      const path = layer.glyphFiles.get(glyphName);
      const text = readFileSync(path, "utf-8");
      return { layer, path, text, glif: readGlif(text) };
    });
  const defaultMember =
    members.find((member) => member.layer === defaultLayer) ?? members[0];
  // Fontra keeps glyph-wide data (such as the stroke method) in the glyph of
  // the default source
  const glyphLib = defaultMember.layer === defaultLayer ? defaultMember.glif.lib : {};
  const replacements = strokeGlyph(
    glyphName,
    members.map((member) => ({
      name: member.layer.source.name,
      outline: member.glif.outline,
      customData: member.glif.lib[SOURCE_CUSTOM_DATA_KEY] ?? {},
    })),
    members.indexOf(defaultMember),
    glyphLib[GLYPH_CUSTOM_DATA_KEY],
    options,
    report
  );
  if (!replacements) {
    return false;
  }
  if (glyphLib[GLYPH_DESIGNSPACE_KEY]) {
    report.warnings.push(
      `${glyphName}: the glyph has axes or sources of its own, which are not expanded`
    );
  }
  for (const [i, member] of members.entries()) {
    if (replacements[i].size) {
      writeFileSync(
        member.path,
        rewriteGlif(member.text, replacements[i], { overlapFlag: true })
      );
    }
  }
  report.glyphs++;
  return true;
}

// Remove the stroke settings from the glyph and source customData that
// Fontra keeps in the libs of the glyphs
function removeStrokeData(layers) {
  const paths = new Set(layers.flatMap((layer) => [...layer.glyphFiles.values()]));
  for (const path of paths) {
    const text = readFileSync(path, "utf-8");
    if (!text.includes(STROKE_KEY)) {
      continue;
    }
    let result = text;
    for (const key of [GLYPH_CUSTOM_DATA_KEY, SOURCE_CUSTOM_DATA_KEY]) {
      result = removeLibEntry(result, [key, STROKE_KEY]);
    }
    if (result !== text) {
      writeFileSync(path, result);
    }
  }
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
