// Stroking the centerlines of one glyph in all its sources. The same for
// every input format: expand.js (designspace and UFOs) and expand-fontra.js
// (.fontra) read the glyphs and write the outlines back.

import { strokeCompatibly } from "../src/geometry/compatible.js";
import {
  SHARED_POINT_KEYS,
  getGlyphStroke,
  isCenterlineContour,
  nibStyleInGlyph,
  offsetStyleInGlyph,
  resolvePointValues,
} from "../src/stroke-data.js";

/**
 * Stroke the open contours of a glyph, and the closed ones marked as
 * centerlines, in all its sources.
 *
 * @param {string} glyphName
 * @param {{name: string, outline: object[], customData: object}[]} sources
 *   the glyph in each source: its outline, one entry per contour or
 *   component in order ({ contour }, with contour in Fontra's unpacked form,
 *   or null for a component), and the source's customData
 * @param {number} defaultIndex the source at the default location, whose
 *   cap, joins and marks of centerlines all sources use
 * @param {object} glyphCustomData customData of the glyph (the stroke method)
 * @param {{tolerance?: number}} options
 * @param {{warnings: string[], twists: string[]}} report problems found, and
 *   where strokes twist, are added to it
 * @returns {Map<number, object[]>[]|null} per source: outline index -> the
 *   closed contours to write in place of that centerline; null when the
 *   glyph has no centerlines
 */
export function strokeGlyph(
  glyphName,
  sources,
  defaultIndex,
  glyphCustomData,
  options,
  report
) {
  const shapes = sources.map((source) =>
    source.outline.map((item) =>
      item.contour ? (item.contour.isClosed ? "closed" : "open") : "component"
    )
  );
  const sameShape = shapes.every((shape) => shape.join() === shapes[0].join());

  // The values of the points, with the joins of the default source's points
  // and its marks of closed contours as centerlines
  const pointValues = sources.map((source) => outlinePointValues(source));
  if (sameShape) {
    const defaultValues = pointValues[defaultIndex];
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
  const isCenterlineAt = (sourceIndex, index) => {
    const item = sources[sourceIndex].outline[index];
    return (
      !!item.contour &&
      isCenterlineContour(item.contour.isClosed, pointValues[sourceIndex].get(index))
    );
  };
  if (
    !sources.some((source, i) =>
      source.outline.some((item, index) => isCenterlineAt(i, index))
    )
  ) {
    return null;
  }

  const method = getGlyphStroke(glyphCustomData).type;
  const styles = sources.map((source) =>
    method === "nib"
      ? nibStyleInGlyph(source.customData, glyphCustomData)
      : offsetStyleInGlyph(source.customData, sources[defaultIndex].customData)
  );

  if (!sameShape) {
    report.warnings.push(
      `${glyphName}: the sources have different contours; the outlines will not interpolate`
    );
  }

  const withValues = (source, i, index) => {
    const contour = source.outline[index].contour;
    const values = pointValues[i].get(index);
    return {
      ...contour,
      points: contour.points.map((point, k) =>
        values?.[k] ? { ...point, values: values[k] } : point
      ),
    };
  };

  const replacements = sources.map(() => new Map());
  if (sameShape) {
    for (const index of sources[0].outline.keys()) {
      if (!isCenterlineAt(0, index)) {
        continue;
      }
      const { results, compatible, problems } = strokeCompatibly(
        sources.map((source, i) => ({
          contour: withValues(source, i, index),
          style: styles[i],
        })),
        { ...options, referenceIndex: defaultIndex }
      );
      if (!compatible) {
        report.warnings.push(
          `${glyphName}, contour ${contourNumber(sources[0], index)}: ${problems.join("; ")}`
        );
      }
      const twisting = results.filter((result) => result.twists.length).length;
      if (twisting && twisting < results.length) {
        report.warnings.push(
          `${glyphName}, contour ${contourNumber(sources[0], index)}: twists in some ` +
            `sources only, so between those and the others the inside of the ` +
            `bend comes out thinner than the stroke would be`
        );
      }
      for (const [i, result] of results.entries()) {
        replacements[i].set(index, result.contours);
        for (const twist of result.twists) {
          report.twists.push(
            `${glyphName} (${sources[i].name}), contour ` +
              `${contourNumber(sources[i], index)}: twists around ` +
              `(${Math.round(twist.point.x)}, ${Math.round(twist.point.y)})`
          );
        }
      }
    }
  } else {
    // Stroke each source on its own
    for (const [i, source] of sources.entries()) {
      for (const index of source.outline.keys()) {
        if (isCenterlineAt(i, index)) {
          const { results } = strokeCompatibly(
            [{ contour: withValues(source, i, index), style: styles[i] }],
            options
          );
          replacements[i].set(index, results[0].contours);
        }
      }
    }
  }
  return replacements;
}

// The values of the points of a source's contours: outline index → values
// per point of that contour. Identifiers are looked up across the whole
// glyph, as Fontra does.
function outlinePointValues(source) {
  const items = source.outline.filter((item) => item.contour);
  const values = resolvePointValues(
    items.map((item) =>
      item.contour.points.map((point) => ({
        identifier: point.attrs?.identifier,
        onCurve: !point.type,
      }))
    ),
    source.customData
  );
  return new Map(items.map((item, k) => [source.outline.indexOf(item), values[k]]));
}

// 1-based number of a contour among the contours (not components) of a glyph
function contourNumber(source, index) {
  return source.outline.slice(0, index + 1).filter((item) => item.contour).length;
}
