// Expanding the centerlines of a .fontra font into outlines, in a copy of the
// font.
//
// A .fontra font has no place for TrueType's overlap flag (public.truetype.
// overlap in a UFO): see docs/building-fonts.md for building from the copy.

import {
  cpSync,
  existsSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { STROKE_KEY } from "../src/stroke-data.js";
import {
  defaultSourceIndex,
  fontraGlyphFiles,
  glyphSourceName,
  readJSON,
  serializeFontraJSON,
} from "./formats/fontra.js";
import { formatNumber } from "./formats/glif.js";
import { strokeGlyph } from "./stroke-glyph.js";

/**
 * Copy a .fontra folder into outDir, with the open contours of every glyph
 * replaced by their stroked outlines, in all the glyph's sources. The input
 * is not changed.
 *
 * @param {string} fontraPath the .fontra folder
 * @param {string} outDir the folder to write the copy to
 * @param {{tolerance?: number, removeStrokeData?: boolean}} [options]
 *   removeStrokeData: also remove the stroke settings from the glyphs of the
 *   copy
 * @returns {{output: string, glyphs: number, warnings: string[],
 *   twists: string[]}} the path of the copy, the number of glyphs expanded,
 *   problems found, and where strokes twist
 */
export function expandFontra(fontraPath, outDir, options = {}) {
  const { removeStrokeData: removeData = false, ...strokeOptions } = options;
  const inputPath = resolve(fontraPath);
  const outputDir = resolve(outDir);
  if (
    existsSync(outputDir) &&
    realpathSync(outputDir) === realpathSync(dirname(inputPath))
  ) {
    throw new Error("the output folder must not be the folder of the input");
  }
  const fontData = readJSON(join(inputPath, "font-data.json"));
  mkdirSync(outputDir, { recursive: true });
  const output = join(outputDir, basename(inputPath));
  rmSync(output, { recursive: true, force: true });
  cpSync(inputPath, output, { recursive: true });

  const report = { output, glyphs: 0, warnings: [], twists: [] };
  for (const [glyphName, path] of fontraGlyphFiles(output)) {
    const glyph = readJSON(path);
    let changed = expandGlyph(glyphName, glyph, fontData, strokeOptions, report);
    if (changed) {
      report.glyphs++;
    }
    if (removeData) {
      changed = removeStrokeData(glyph) || changed;
    }
    if (changed) {
      writeFileSync(path, serializeFontraJSON(glyph));
    }
  }
  return report;
}

// Stroke the centerlines of a glyph in its layers, in place. The active
// sources are stroked together, so that their outlines interpolate; an
// inactive source (not part of the font's design space) on its own.
function expandGlyph(glyphName, glyph, fontData, options, report) {
  const sources = (glyph.sources ?? []).filter(
    (source) => glyph.layers?.[source.layerName]?.glyph
  );
  const active = sources.filter((source) => !source.inactive);
  const defaultSource = glyph.sources?.[defaultSourceIndex(glyph, fontData)];
  const groups = [
    { sources: active, defaultIndex: Math.max(active.indexOf(defaultSource), 0) },
    ...sources
      .filter((source) => source.inactive)
      .map((source) => ({ sources: [source], defaultIndex: 0 })),
  ];
  const strokedLayers = new Set();
  for (const group of groups) {
    if (!group.sources.length) {
      continue;
    }
    const layers = group.sources.map((source) => glyph.layers[source.layerName].glyph);
    const replacements = strokeGlyph(
      glyphName,
      group.sources.map((source, i) => ({
        name: glyphSourceName(source, fontData),
        outline: layerOutline(layers[i]),
        customData: source.customData ?? {},
      })),
      group.defaultIndex,
      glyph.customData,
      options,
      report
    );
    if (!replacements) {
      continue;
    }
    for (const [i, layer] of layers.entries()) {
      // Sources can share a layer: it is stroked once
      if (!replacements[i].size || strokedLayers.has(layer)) {
        continue;
      }
      strokedLayers.add(layer);
      layer.path = {
        ...layer.path,
        contours: layer.path.contours.flatMap(
          (contour, index) => replacements[i].get(index)?.map(roundContour) ?? [contour]
        ),
      };
    }
  }
  return strokedLayers.size > 0;
}

// Fontra keeps the contours of a layer in its path, and the components apart
// from them; components come after the contours here
function layerOutline(layer) {
  return [
    ...(layer.path?.contours ?? []).map((contour) => ({ contour })),
    ...(layer.components ?? []).map(() => ({ contour: null })),
  ];
}

function roundContour(contour) {
  return {
    points: contour.points.map((point) => {
      const rounded = {
        x: Number(formatNumber(point.x)),
        y: Number(formatNumber(point.y)),
      };
      return point.type ? { ...rounded, type: point.type } : rounded;
    }),
    isClosed: true,
  };
}

// Remove the stroke settings from the glyph's customData and its sources'
function removeStrokeData(glyph) {
  let changed = false;
  for (const owner of [glyph, ...(glyph.sources ?? [])]) {
    if (owner.customData && STROKE_KEY in owner.customData) {
      delete owner.customData[STROKE_KEY];
      // Fontra leaves out empty customData
      if (!Object.keys(owner.customData).length) {
        delete owner.customData;
      }
      changed = true;
    }
  }
  return changed;
}
