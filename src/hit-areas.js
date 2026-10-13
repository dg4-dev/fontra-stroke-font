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
//
// In the glyph being edited, Fontra finds the component under the pointer the
// same way (scene-model.js, componentSelectionAtPoint()): by the component's
// control bounds and by filling its path (both cached on Fontra's component
// controller). For a component whose glyph has centerlines, these are made
// from the stroked shapes instead (widenComponentHitAreas()), so that the
// component can be clicked anywhere on its strokes. Fontra also outlines the
// hovered and selected components with that path, which then follows the
// strokes.

import { glyphHasCenterlines } from "./glyph-strokes.js";
import { appendContour } from "./stroke-layer.js";

const WIDENED_WITH = Symbol("stroke-font component strokes");

/**
 * @param {object[]} positionedLines Fontra's sceneSettings.positionedLines,
 *   changed in place
 * @param {(positionedGlyph: object) => object[]} strokedOutlines the stroked
 *   shapes of a glyph (closed unpacked contours, in glyph coordinates)
 * @param {object} [componentGlyphs] see glyph-strokes.js
 * @returns {number} how many glyphs were changed
 */
export function widenHitAreas(positionedLines, strokedOutlines, componentGlyphs) {
  let count = 0;
  for (const line of positionedLines ?? []) {
    let changed = false;
    for (const item of line.glyphs ?? []) {
      const glyph = item.glyph;
      if (!glyph || item.isUndefined || !glyphHasCenterlines(item, componentGlyphs)) {
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

/**
 * Give the components of a glyph with centerlines the path and control bounds
 * of their stroked shapes (see the top of this file), in place.
 * @param {object} glyph Fontra's glyph controller of the glyph being edited
 * @param {{componentOutlines: Map<number, object[]>, strokedClosed: {components:
 *   Map<number, Set<number>>}}} stroked strokeGlyph() of the glyph
 * @returns {number} how many components were changed
 */
export function widenComponentHitAreas(glyph, stroked) {
  let count = 0;
  for (const [index, outlines] of stroked.componentOutlines ?? []) {
    const component = glyph?.components?.[index];
    // The strokes are cached, so the same outlines need no new path
    if (!component?.path || component[WIDENED_WITH] === outlines) {
      continue;
    }
    const strokedClosed = stroked.strokedClosed?.components?.get(index);
    const path2d = new Path2D();
    const path = component.path;
    // The closed contours that are outlines, and the strokes
    for (const [i, contour] of (path.contourInfo ?? []).entries()) {
      if (contour.isClosed && !strokedClosed?.has(i)) {
        path.drawContourToPath2d(path2d, i);
      }
    }
    for (const contour of outlines) {
      appendContour(path2d, contour);
    }
    const points = outlines.flatMap((contour) => contour.points);
    let bounds = points.length ? pointsRect(points) : undefined;
    const own = path.getControlBounds?.();
    if (own) {
      bounds = bounds ? unionRect(bounds, own) : own;
    }
    component._path2d = path2d;
    component._controlBounds = bounds;
    component[WIDENED_WITH] = outlines;
    count++;
  }
  return count;
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
