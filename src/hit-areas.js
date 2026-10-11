// Making the glyphs of the text clickable by their stroked shapes.
//
// Fontra finds the glyph under the pointer by its bounds and its convex hull
// (scene-model.js, glyphAtPoint()), both made from the glyph's outlines. For a
// glyph with centerlines these cover the centerlines only, so most of a
// stroke cannot be clicked, and a glyph of straight centerlines has a hull of
// no area at all. A glyph whose contours all have two points or less counts as
// empty, and is clicked by a box over its advance width instead, which can be
// narrower than its strokes.
//
// After Fontra lays out the text, the glyphs with centerlines get bounds and a
// convex hull that include their stroked shapes. The hull is a representation
// cached on Fontra's glyph controller (_representationCache.convexHull), used
// for nothing but finding the glyph under the pointer.

import { hasOpenContours } from "./glyph-strokes.js";

/**
 * @param {object[]} positionedLines Fontra's sceneSettings.positionedLines,
 *   changed in place
 * @param {(positionedGlyph: object) => object[]} strokedOutlines the stroked
 *   shapes of a glyph (closed unpacked contours, in glyph coordinates)
 * @returns {number} how many glyphs were changed
 */
export function widenHitAreas(positionedLines, strokedOutlines) {
  let count = 0;
  for (const line of positionedLines ?? []) {
    let changed = false;
    for (const item of line.glyphs ?? []) {
      const glyph = item.glyph;
      if (!glyph || item.isUndefined || !hasCenterlines(glyph)) {
        continue;
      }
      let outlines;
      try {
        outlines = strokedOutlines(item);
      } catch (e) {
        console.error("[stroke-font] could not stroke a glyph", e);
        continue;
      }
      const points = outlines.flatMap((contour) => contour.points);
      const coordinates = glyph.flattenedPath?.coordinates ?? [];
      for (let i = 0; i + 1 < coordinates.length; i += 2) {
        points.push({ x: coordinates[i], y: coordinates[i + 1] });
      }
      const hull = convexHull(points);
      if (hull.length < 3) {
        continue;
      }
      if (!glyph._representationCache) {
        glyph._representationCache = {};
      }
      glyph._representationCache.convexHull = hull;
      const bounds = offsetRect(pointsRect(hull), item.x ?? 0, item.y ?? 0);
      item.bounds = item.bounds ? unionRect(item.bounds, bounds) : bounds;
      // Not empty: so that Fontra tests the hull rather than the advance box
      item.isEmpty = false;
      changed = true;
      count++;
    }
    if (changed) {
      for (const item of line.glyphs) {
        if (item.bounds) {
          line.bounds = line.bounds ? unionRect(line.bounds, item.bounds) : item.bounds;
        }
      }
    }
  }
  return count;
}

function hasCenterlines(glyph) {
  return (
    hasOpenContours(glyph.path) ||
    (glyph.components ?? []).some((component) => hasOpenContours(component.path))
  );
}

/** The convex hull of points, counter-clockwise (monotone chain). */
export function convexHull(points) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 3) {
    return sorted;
  }
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper = [];
  for (const point of sorted.toReversed()) {
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)].map(({ x, y }) => ({ x, y }));
}

function pointsRect(points) {
  return {
    xMin: Math.min(...points.map((p) => p.x)),
    yMin: Math.min(...points.map((p) => p.y)),
    xMax: Math.max(...points.map((p) => p.x)),
    yMax: Math.max(...points.map((p) => p.y)),
  };
}

function offsetRect(rect, dx, dy) {
  return {
    xMin: rect.xMin + dx,
    yMin: rect.yMin + dy,
    xMax: rect.xMax + dx,
    yMax: rect.yMax + dy,
  };
}

function unionRect(a, b) {
  return {
    xMin: Math.min(a.xMin, b.xMin),
    yMin: Math.min(a.yMin, b.yMin),
    xMax: Math.max(a.xMax, b.xMax),
    yMax: Math.max(a.yMax, b.yMax),
  };
}
