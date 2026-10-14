// Expanding the centerlines of a font into outlines, in a copy of the font.

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

import { strokeCompatibly } from "../src/geometry/compatible.js";
import {
  SHARED_POINT_KEYS,
  getGlyphStroke,
  isCenterlineContour,
  nibStyleInGlyph,
  offsetStyleInGlyph,
  resolvePointValues,
} from "../src/stroke-data.js";
import { parseDesignspace } from "./formats/designspace.js";
import { readGlif, rewriteGlif } from "./formats/glif.js";
import { layerGlyphFiles } from "./formats/ufo.js";
import { escapeAttribute } from "./formats/xml.js";

const GLYPH_CUSTOM_DATA_KEY = "xyz.fontra.customData";
const SOURCE_CUSTOM_DATA_KEY = "xyz.fontra.glyph.source.customData";
const GLYPH_DESIGNSPACE_KEY = "com.black-foundry.glyph-designspace";

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

  const layers = sources.map((source) => ({
    source,
    glyphFiles: layerGlyphFiles(
      join(outputDir, ufoCopies.get(source.filename)),
      source.layer
    ),
  }));
  // Fontra keeps glyph-wide data (such as the stroke method) in the glyph of
  // the default source
  const defaultLayer = layers.find((layer) => layer.source.isDefault) ?? layers[0];
  const glyphDataFiles = defaultLayer.glyphFiles;

  const report = {
    designspace: outputDesignspace,
    glyphs: 0,
    warnings: [],
    twists: [],
  };
  const glyphNames = new Set(layers.flatMap((layer) => [...layer.glyphFiles.keys()]));
  for (const glyphName of [...glyphNames].sort()) {
    expandGlyph(glyphName, layers, defaultLayer, glyphDataFiles, options, report);
  }
  return report;
}

function expandGlyph(glyphName, layers, defaultLayer, glyphDataFiles, options, report) {
  const members = layers
    .filter((layer) => layer.glyphFiles.has(glyphName))
    .map((layer) => {
      const path = layer.glyphFiles.get(glyphName);
      const text = readFileSync(path, "utf-8");
      return { layer, path, text, glif: readGlif(text) };
    });
  const defaultMember =
    members.find((member) => member.layer === defaultLayer) ?? members[0];
  const shapes = members.map((member) =>
    member.glif.outline.map((item) =>
      item.contour ? (item.contour.isClosed ? "closed" : "open") : item.element.name
    )
  );
  const sameShape = shapes.every((shape) => shape.join() === shapes[0].join());

  // The values of the points, with the joins of the default source's points
  // and its marks of closed contours as centerlines
  const pointValues = members.map((member) => outlinePointValues(member));
  if (sameShape) {
    const defaultValues = pointValues[members.indexOf(defaultMember)];
    for (const values of pointValues) {
      for (const [index, contourValues] of values) {
        for (const [i, own] of contourValues.entries()) {
          const shared = defaultValues.get(index)?.[i];
          if (SHARED_POINT_KEYS.every((key) => own?.[key] === shared?.[key])) {
            continue;
          }
          const next = { ...own };
          for (const key of SHARED_POINT_KEYS) {
            if (shared?.[key] === undefined) {
              delete next[key];
            } else {
              next[key] = shared[key];
            }
          }
          contourValues[i] = Object.keys(next).length ? next : undefined;
        }
      }
    }
  }
  // Open contours, and closed ones marked as centerlines
  const isCenterlineAt = (memberIndex, index) => {
    const item = members[memberIndex].glif.outline[index];
    return (
      !!item.contour &&
      isCenterlineContour(item.contour.isClosed, pointValues[memberIndex].get(index))
    );
  };
  if (
    !members.some((member, i) =>
      member.glif.outline.some((item, index) => isCenterlineAt(i, index))
    )
  ) {
    return;
  }

  const glyphDataPath = glyphDataFiles.get(glyphName);
  const glyphLib = glyphDataPath
    ? readGlif(readFileSync(glyphDataPath, "utf-8")).lib
    : {};
  if (glyphLib[GLYPH_DESIGNSPACE_KEY]) {
    report.warnings.push(
      `${glyphName}: the glyph has axes or sources of its own, which are not expanded`
    );
  }
  const method = getGlyphStroke(glyphLib[GLYPH_CUSTOM_DATA_KEY]).type;
  const sourceData = (member) => member.glif.lib[SOURCE_CUSTOM_DATA_KEY] ?? {};
  const styles = members.map((member) =>
    method === "nib"
      ? nibStyleInGlyph(sourceData(member), glyphLib[GLYPH_CUSTOM_DATA_KEY])
      : offsetStyleInGlyph(sourceData(member), sourceData(defaultMember))
  );

  if (!sameShape) {
    report.warnings.push(
      `${glyphName}: the sources have different contours; the outlines will not interpolate`
    );
  }

  const withValues = (member, i, index) => {
    const contour = member.glif.outline[index].contour;
    const values = pointValues[i].get(index);
    return {
      ...contour,
      points: contour.points.map((point, k) =>
        values?.[k] ? { ...point, values: values[k] } : point
      ),
    };
  };

  const replacements = members.map(() => new Map());
  if (sameShape) {
    for (const [index, item] of members[0].glif.outline.entries()) {
      if (!isCenterlineAt(0, index)) {
        continue;
      }
      const { results, compatible, problems } = strokeCompatibly(
        members.map((member, i) => ({
          contour: withValues(member, i, index),
          style: styles[i],
        })),
        { ...options, referenceIndex: members.indexOf(defaultMember) }
      );
      if (!compatible) {
        report.warnings.push(
          `${glyphName}, contour ${contourNumber(members[0], index)}: ${problems.join("; ")}`
        );
      }
      const twisting = results.filter((result) => result.twists.length).length;
      if (twisting && twisting < results.length) {
        report.warnings.push(
          `${glyphName}, contour ${contourNumber(members[0], index)}: twists in some ` +
            `sources only, so between those and the others the inside of the ` +
            `bend comes out thinner than the stroke would be`
        );
      }
      for (const [i, result] of results.entries()) {
        replacements[i].set(index, result.contours);
        for (const twist of result.twists) {
          report.twists.push(
            `${glyphName} (${members[i].layer.source.name}), contour ` +
              `${contourNumber(members[i], index)}: twists around ` +
              `(${Math.round(twist.point.x)}, ${Math.round(twist.point.y)})`
          );
        }
      }
    }
  } else {
    // Stroke each source on its own
    for (const [i, member] of members.entries()) {
      for (const [index, item] of member.glif.outline.entries()) {
        if (isCenterlineAt(i, index)) {
          const { results } = strokeCompatibly(
            [{ contour: withValues(member, i, index), style: styles[i] }],
            options
          );
          replacements[i].set(index, results[0].contours);
        }
      }
    }
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
}

// The values of the points of a glif's contours: outline index → values per
// point of that contour. Identifiers are looked up across the whole glyph,
// as Fontra does.
function outlinePointValues(member) {
  const items = member.glif.outline.filter((item) => item.contour);
  const values = resolvePointValues(
    items.map((item) =>
      item.contour.points.map((point) => ({
        identifier: point.attrs?.identifier,
        onCurve: !point.type,
      }))
    ),
    member.glif.lib[SOURCE_CUSTOM_DATA_KEY] ?? {}
  );
  return new Map(
    items.map((item, k) => [member.glif.outline.indexOf(item), values[k]])
  );
}

// 1-based number of a contour among the contours (not components) of a glyph
function contourNumber(member, index) {
  return member.glif.outline.slice(0, index + 1).filter((item) => item.contour).length;
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
