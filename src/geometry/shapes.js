// Building closed contours in Fontra's unpacked form. No Fontra or DOM
// dependencies.

import { cross, pointAt } from "./bezier.js";

// Handle length of a quarter circle drawn with one cubic, relative to the radius
export const KAPPA = 0.5522847498307936;

/**
 * Four cubic quarter circles, counter-clockwise from the rightmost point.
 * With a transform, each point is mapped by it (a linear map with a positive
 * determinant keeps the contour counter-clockwise).
 * @param {{x: number, y: number}} center
 * @param {number} radius
 * @param {(p: {x: number, y: number}) => {x: number, y: number}} [transform]
 *   applied to the points relative to the center
 */
export function circleContour(center, radius, transform = (p) => p) {
  const k = radius * KAPPA;
  const r = radius;
  const at = (dx, dy) => {
    const p = transform({ x: dx, y: dy });
    return { x: center.x + p.x, y: center.y + p.y };
  };
  return {
    points: [
      onCurve(at(r, 0)),
      offCurve(at(r, k)),
      offCurve(at(k, r)),
      onCurve(at(0, r)),
      offCurve(at(-k, r)),
      offCurve(at(-r, k)),
      onCurve(at(-r, 0)),
      offCurve(at(-r, -k)),
      offCurve(at(-k, -r)),
      onCurve(at(0, -r)),
      offCurve(at(k, -r)),
      offCurve(at(r, -k)),
    ],
    isClosed: true,
  };
}

export function polygonContour(points) {
  return { points: points.map(onCurve), isClosed: true };
}

export function onCurve({ x, y }) {
  return { x, y };
}

export function offCurve({ x, y }) {
  return { x, y, type: "cubic" };
}

/**
 * Signed area of a closed contour made of lines and cubic curves (positive
 * when counter-clockwise in a y-up coordinate system). Curves are flattened,
 * which is precise enough to tell the direction.
 */
export function signedArea(contour) {
  const polygon = [];
  const points = contour.points;
  const start = points.findIndex((p) => !p.type);
  if (start < 0) {
    return 0;
  }
  const numPoints = points.length;
  let current = points[start];
  let controls = [];
  for (let step = 1; step <= numPoints; step++) {
    const point = points[(start + step) % numPoints];
    if (point.type) {
      controls.push(point);
      continue;
    }
    if (controls.length === 2) {
      const curve = { type: "cubic", points: [current, ...controls, point] };
      for (let i = 1; i < 8; i++) {
        polygon.push(pointAt(curve, i / 8));
      }
    }
    polygon.push(point);
    current = point;
    controls = [];
  }
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    area += cross(polygon[i], polygon[(i + 1) % polygon.length]);
  }
  return area / 2;
}
