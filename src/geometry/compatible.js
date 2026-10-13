// Stroking one centerline in every source of a glyph so that the outlines
// stay compatible: the same contours, with the same points in the same order,
// which a variable font needs. No Fontra or DOM dependencies.
//
// Each source alone may split an edge in other places (where it twists) or
// fit it with a different number of pieces. The layouts of all sources are
// merged: every edge is split at the places any source splits it, and each
// part gets the largest number of pieces any source needs. Every source is
// then stroked again with the merged layout. Since the edges are split at the
// same parameters in all sources, the points of different sources lie on the
// same normals of the centerline, and the outlines interpolate well.

import { strokeContour } from "./stroke.js";
import { mergeBreaks } from "./sweep.js";

/**
 * @param {{contour: object, style: object}[]} inputs the same centerline in
 *   each source, with that source's style (all of the same method, see
 *   stroke.js)
 * @param {object} [options] tolerance / maxSubdivisions, see offset.js
 * @returns {{results: {contours: object[], twists: object[]}[],
 *   compatible: boolean, problems: string[]}}
 */
export function strokeCompatibly(inputs, options = {}) {
  const stroke = (layout) =>
    inputs.map(({ contour, style }) =>
      strokeContour(contour, style, { ...options, layout })
    );
  const problems = [];

  // 1. Each source alone
  const first = stroke(undefined);
  // 2. The splits of all sources, with piece counts chosen per source
  const breakLayout = mergeBreakLayouts(
    first.map((result) => result.layout),
    problems
  );
  const second = breakLayout ? stroke(breakLayout) : first;
  // 3. The largest piece counts
  const pieceLayout = breakLayout
    ? mergePieceCounts(second.map((result) => result.layout))
    : null;
  const final = pieceLayout ? stroke(pieceLayout) : second;

  const signatures = final.map((result) => outlineSignature(result.contours));
  const compatible = signatures.every((signature) => signature === signatures[0]);
  if (!compatible && !problems.length) {
    problems.push("the stroked outlines have different points in some sources");
  }
  return {
    results: final.map(({ contours, twists }) => ({ contours, twists })),
    compatible,
    problems,
  };
}

/**
 * A string that is the same for two lists of contours exactly when they have
 * the same contours with the same kinds of points in the same order.
 */
export function outlineSignature(contours) {
  return contours
    .map((contour) => contour.points.map((p) => (p.type ? "c" : "o")).join(""))
    .join("|");
}

/**
 * The split parameters of all layouts, without piece counts. Returns null
 * when the layouts cannot be merged; the reason goes to problems.
 */
export function mergeBreakLayouts(layouts, problems = []) {
  const numSegments = layouts[0]?.segments.length ?? 0;
  if (layouts.some((layout) => layout.segments.length !== numSegments)) {
    problems.push("the centerline has a different number of segments in some sources");
    return null;
  }
  const segments = [];
  for (let i = 0; i < numSegments; i++) {
    const entries = layouts.map((layout) => layout.segments[i]);
    const present = entries.filter(Boolean);
    if (present.length !== entries.length) {
      if (present.length) {
        problems.push(`segment ${i + 1} has zero length in some sources`);
      }
      segments.push(present.length ? present[0] : null);
      continue;
    }
    const segment = {};
    for (const side of ["left", "right"]) {
      // A line keeps a straight edge only if it does in every source
      const line = present.every((entry) => entry[side].line === true);
      segment[side] = line
        ? { breaks: [], line }
        : { breaks: mergeBreaks(present.flatMap((entry) => entry[side].breaks)) };
    }
    segments.push(segment);
  }
  return { segments };
}

/**
 * The largest piece counts of layouts that split their edges at the same
 * places; null when they do not.
 */
export function mergePieceCounts(layouts) {
  const [first, ...rest] = layouts;
  if (!first) {
    return null;
  }
  const merged = structuredClone(first);
  for (const layout of rest) {
    if (layout.segments.length !== merged.segments.length) {
      return null;
    }
    for (const [i, segment] of layout.segments.entries()) {
      const target = merged.segments[i];
      if (!segment || !target) {
        if (segment !== target) {
          return null;
        }
        continue;
      }
      for (const side of ["left", "right"]) {
        const counts = segment[side].pieces;
        const targetCounts = target[side].pieces;
        if (counts.length !== targetCounts.length) {
          return null;
        }
        for (const [k, count] of counts.entries()) {
          targetCounts[k] = Math.max(targetCounts[k], count);
        }
      }
    }
  }
  return merged;
}
