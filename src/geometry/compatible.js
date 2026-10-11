// Stroking one centerline in every source of a glyph so that the outlines
// stay compatible: the same contours, with the same points in the same order,
// which a variable font needs. No Fontra or DOM dependencies.
//
// Each source alone may choose a different number of pieces for an edge, or
// twist in one source and not in another. The layouts of all sources are
// merged (the zones of all sources, the largest piece counts), and every
// source is stroked again with the merged layout.

import { strokeOffsetContour } from "./offset.js";

/**
 * @param {{contour: object, style: object}[]} inputs the same centerline in
 *   each source, with that source's style
 * @param {object} [options] tolerance / maxSubdivisions, see offset.js
 * @returns {{results: {contours: object[], twists: object[]}[],
 *   compatible: boolean, problems: string[]}}
 */
export function strokeCompatibly(inputs, options = {}) {
  const stroke = (layouts) =>
    inputs.map(({ contour, style }, i) =>
      strokeOffsetContour(contour, style, { ...options, layout: layouts?.[i] })
    );
  const problems = [];

  // 1. Each source alone
  const first = stroke(null);
  // 2. The zones of all sources, with piece counts chosen per source
  const zoneLayout = mergeZones(
    first.map((result) => result.layout),
    problems
  );
  const second = zoneLayout ? stroke(inputs.map(() => zoneLayout)) : first;
  // 3. The largest piece counts
  const pieceLayout = mergePieceCounts(second.map((result) => result.layout));
  const final = pieceLayout ? stroke(inputs.map(() => pieceLayout)) : second;

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
 * The zones of all layouts, without piece counts. Returns null when the
 * layouts cannot be merged; the reason goes to problems.
 */
export function mergeZones(layouts, problems = []) {
  const numSegments = layouts[0]?.segments.length ?? 0;
  if (layouts.some((layout) => layout.segments.length !== numSegments)) {
    problems.push("the centerline has a different number of segments in some sources");
    return null;
  }
  const segments = [];
  for (let i = 0; i < numSegments; i++) {
    const entries = layouts.map((layout) => layout.segments[i]);
    const present = entries.filter(Boolean);
    if (!present.length) {
      segments.push(null);
      continue;
    }
    if (present.length !== entries.length) {
      problems.push(`segment ${i + 1} has zero length in some sources`);
    }
    const zoneLists = present.map((entry) =>
      entry.spans.filter((span) => span.kind === "zone")
    );
    const longest = zoneLists.reduce((a, b) => (b.length > a.length ? b : a));
    const sides = longest.map((zone) => zone.side);
    const parts = sides.map(() => 1);
    for (const zones of zoneLists) {
      const mapping = subsequenceMapping(
        zones.map((zone) => zone.side),
        sides
      );
      if (!mapping) {
        problems.push(
          `segment ${i + 1} twists to different sides in a different order in some sources`
        );
        return null;
      }
      for (const [k, zone] of zones.entries()) {
        parts[mapping[k]] = Math.max(parts[mapping[k]], zone.parts.length);
      }
    }
    const spans = [{ kind: "band" }];
    for (const [k, side] of sides.entries()) {
      spans.push({
        kind: "zone",
        side,
        parts: Array.from({ length: parts[k] }, () => ({})),
      });
      spans.push({ kind: "band" });
    }
    segments.push({ spans });
  }
  return { segments };
}

// For each item of short, its index in long, keeping the order; null when
// short is not a subsequence of long
function subsequenceMapping(short, long) {
  const mapping = [];
  let j = 0;
  for (const item of short) {
    while (j < long.length && long[j] !== item) {
      j++;
    }
    if (j === long.length) {
      return null;
    }
    mapping.push(j++);
  }
  return mapping;
}

/**
 * The largest piece counts of layouts that have the same spans; null when
 * their spans differ.
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
      if (segment.spans.length !== target.spans.length) {
        return null;
      }
      for (const [s, span] of segment.spans.entries()) {
        const targetSpan = target.spans[s];
        if (span.kind !== targetSpan.kind) {
          return null;
        }
        if (span.kind === "band") {
          targetSpan.pieces = Math.max(targetSpan.pieces, span.pieces);
          continue;
        }
        if (
          span.side !== targetSpan.side ||
          span.parts.length !== targetSpan.parts.length
        ) {
          return null;
        }
        for (const [p, part] of span.parts.entries()) {
          const targetPart = targetSpan.parts[p];
          targetPart.outer = Math.max(targetPart.outer, part.outer);
          targetPart.inner = Math.max(targetPart.inner, part.inner);
        }
      }
    }
  }
  return merged;
}
