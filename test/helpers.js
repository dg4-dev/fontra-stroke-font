// Helpers for checking stroked outlines in tests.

import { pointAt } from "../src/geometry/bezier.js";
import { centerlineSegments } from "../src/geometry/centerline.js";

/** Flatten a closed unpacked contour (lines and cubics) into a polygon. */
export function flattenContour(contour, steps = 32) {
  const points = contour.points;
  const start = points.findIndex((p) => !p.type);
  const polygon = [];
  let current = points[start];
  let controls = [];
  for (let step = 1; step <= points.length; step++) {
    const point = points[(start + step) % points.length];
    if (point.type) {
      controls.push(point);
      continue;
    }
    if (controls.length === 2) {
      const curve = { type: "cubic", points: [current, ...controls, point] };
      for (let i = 1; i < steps; i++) {
        polygon.push(pointAt(curve, i / steps));
      }
    }
    polygon.push(point);
    current = point;
    controls = [];
  }
  return polygon;
}

/** Nonzero winding number of a point for a set of contours. */
export function winding(point, contours) {
  let total = 0;
  for (const contour of contours) {
    const polygon = flattenContour(contour);
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];
      const side = (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y);
      if (a.y <= point.y) {
        if (b.y > point.y && side > 0) {
          total++;
        }
      } else if (b.y <= point.y && side < 0) {
        total--;
      }
    }
  }
  return total;
}

/**
 * Points along a centerline, densely sampled. The on-curve points at the ends
 * of segments are marked with isVertex.
 */
export function sampleCenterline(contour, steps = 200) {
  const samples = [];
  for (const segment of centerlineSegments(contour)) {
    for (let i = 0; i <= steps; i++) {
      const isVertex = i === 0 || i === steps;
      samples.push({ ...pointAt(segment, i / steps), isVertex });
    }
  }
  return samples;
}

export function nearestSample(point, samples) {
  let best = null;
  let bestDistance = Infinity;
  for (const s of samples) {
    const d = Math.hypot(point.x - s.x, point.y - s.y);
    if (d < bestDistance) {
      best = s;
      bestDistance = d;
    }
  }
  return { sample: best, distance: bestDistance };
}

export function distanceToSamples(point, samples) {
  return nearestSample(point, samples).distance;
}

export function bounds(contours) {
  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  for (const contour of contours) {
    for (const p of flattenContour(contour)) {
      xMin = Math.min(xMin, p.x);
      yMin = Math.min(yMin, p.y);
      xMax = Math.max(xMax, p.x);
      yMax = Math.max(yMax, p.y);
    }
  }
  return { xMin, yMin, xMax, yMax };
}

export function on(x, y, smooth = false) {
  return smooth ? { x, y, smooth } : { x, y };
}

export function off(x, y, type = "cubic") {
  return { x, y, type };
}
