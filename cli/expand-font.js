// Expanding the centerlines of a font held as files (a designspace and its
// UFOs) into outlines, in place. Files are read and written through an
// object, without node:fs, so that the CLI (on a copy on disk) and the
// download from the editor (on files in memory) run the same code.

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
import { addOverlapFlag, readGlif, rewriteGlif } from "./formats/glif.js";
import { layerGlyphFiles } from "./formats/ufo.js";

export const GLYPH_CUSTOM_DATA_KEY = "xyz.fontra.customData";
export const SOURCE_CUSTOM_DATA_KEY = "xyz.fontra.glyph.source.customData";
export const GLYPH_DESIGNSPACE_KEY = "com.black-foundry.glyph-designspace";

/**
 * Expand the font, one glyph at a time: yields after each glyph, so that the
 * editor can show progress and let the page respond in between.
 *
 * @param {{read: (path: string) => string|undefined,
 *   write: (path: string, text: string) => void}} files the font's files, by
 *   paths joined with "/"; read returns undefined for a missing file
 * @param {string} designspacePath the .designspace file; the sources' UFOs
 *   are found relative to its folder
 * @param {{tolerance?: number}} [options]
 * @yields {{done: number, total: number}} glyphs looked at so far
 * @returns {{glyphs: number, warnings: string[], twists: string[]}} the
 *   number of glyphs expanded, problems found, and where strokes twist
 */
export function* expandFontSteps(files, designspacePath, options = {}) {
  const text = files.read(designspacePath);
  if (text === undefined) {
    throw new Error(`${designspacePath} is missing`);
  }
  const { sources } = parseDesignspace(text);
  if (!sources.length) {
    throw new Error("the designspace has no sources");
  }
  const folder = designspacePath.includes("/")
    ? designspacePath.slice(0, designspacePath.lastIndexOf("/"))
    : "";
  const read = (path) => files.read(path);
  const layers = sources.map((source) => ({
    source,
    glyphFiles: layerGlyphFiles(read, joinPath(folder, source.filename), source.layer),
  }));
  // Fontra keeps glyph-wide data (such as the stroke method) in the glyph of
  // the default source
  const defaultLayer = layers.find((layer) => layer.source.isDefault) ?? layers[0];
  const glyphDataFiles = defaultLayer.glyphFiles;

  const report = { glyphs: 0, warnings: [], twists: [] };
  const glyphNames = [
    ...new Set(layers.flatMap((layer) => [...layer.glyphFiles.keys()])),
  ].sort();
  const expanded = new Set();
  for (const [i, glyphName] of glyphNames.entries()) {
    if (
      expandGlyph(
        files,
        glyphName,
        layers,
        defaultLayer,
        glyphDataFiles,
        options,
        report
      )
    ) {
      expanded.add(glyphName);
    }
    yield { done: i + 1, total: glyphNames.length };
  }
  flagGlyphsUsingExpanded(files, layers, expanded);
  return report;
}

/** expandFontSteps() run to the end at once. */
export function expandFont(files, designspacePath, options = {}) {
  const steps = expandFontSteps(files, designspacePath, options);
  for (;;) {
    const step = steps.next();
    if (step.done) {
      return step.value;
    }
  }
}

// A relative path inside a folder (both relative), with "." and ".." resolved
// where they can be
export function joinPath(folder, relative) {
  const parts = [];
  for (const part of `${folder}/${relative}`.split("/")) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === ".." && parts.length && parts.at(-1) !== "..") {
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

// A glyph with an expanded glyph as a component, directly or through other
// components, has overlapping contours too once it is built. ufo2ft sets the
// overlap flag of a composite glyph (OVERLAP_COMPOUND), and of a glyph whose
// components it decomposes (one with contours as well), from that glyph's own
// lib only, so such glyphs get public.truetype.overlap as well.
function flagGlyphsUsingExpanded(files, layers, expanded) {
  const glyphs = layers.flatMap((layer) =>
    [...layer.glyphFiles].map(([glyphName, path]) => {
      const text = files.read(path);
      const bases = readGlif(text)
        .outline.filter((item) => item.element.name === "component")
        .map((item) => item.element.attributes.base);
      return { glyphName, path, text, bases };
    })
  );
  const overlapping = new Set(expanded);
  for (let changed = true; changed; ) {
    changed = false;
    for (const glyph of glyphs) {
      if (
        !overlapping.has(glyph.glyphName) &&
        glyph.bases.some((base) => overlapping.has(base))
      ) {
        overlapping.add(glyph.glyphName);
        changed = true;
      }
    }
  }
  for (const glyph of glyphs) {
    if (glyph.bases.some((base) => overlapping.has(base))) {
      const text = addOverlapFlag(glyph.text);
      if (text !== glyph.text) {
        files.write(glyph.path, text);
      }
    }
  }
}

function expandGlyph(
  files,
  glyphName,
  layers,
  defaultLayer,
  glyphDataFiles,
  options,
  report
) {
  const members = layers
    .filter((layer) => layer.glyphFiles.has(glyphName))
    .map((layer) => {
      const path = layer.glyphFiles.get(glyphName);
      const text = files.read(path);
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
  const glyphLib = glyphDataPath ? readGlif(files.read(glyphDataPath)).lib : {};
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
      files.write(
        member.path,
        rewriteGlif(member.text, replacements[i], { overlapFlag: true })
      );
    }
  }
  report.glyphs++;
  return true;
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
