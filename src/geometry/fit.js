// Cubic Bézier pieces that follow a parametric curve. No Fontra or DOM
// dependencies.
//
// A piece from t = a to t = b gets the curve's points at a and b, and handles
// along the curve's derivative there, a third of (b - a) long (the Hermite
// form). The handles depend only on the curve, not on a best fit, so when
// two curves are cut at the same parameters, interpolating the control
// points of their pieces gives the pieces of the interpolated curve. That
// keeps the stroked outlines of different sources interpolating well.

import { add, distance, pointAt, scale, sub } from "./bezier.js";

const SAMPLES = 8;
// Step for the derivative, relative to the length of the piece
const DERIVATIVE_STEP = 1e-4;

/**
 * @param {(t: number) => {x: number, y: number}} curve
 * @param {number} a start parameter
 * @param {number} b end parameter (> a)
 * @returns {{points: {x: number, y: number}[], error: number}} the cubic's
 *   four control points and the largest distance between the cubic and the
 *   curve at the same parameters
 */
export function hermitePiece(curve, a, b) {
  const span = b - a;
  const p0 = curve(a);
  const p3 = curve(b);
  // One-sided derivatives, measured inside the piece: the curve may turn a
  // corner at a or b
  const step = span * DERIVATIVE_STEP;
  const d0 = scale(
    add(add(scale(p0, -3), scale(curve(a + step), 4)), scale(curve(a + 2 * step), -1)),
    1 / (2 * step)
  );
  const d3 = scale(
    add(add(scale(p3, 3), scale(curve(b - step), -4)), curve(b - 2 * step)),
    1 / (2 * step)
  );
  const points = [p0, add(p0, scale(d0, span / 3)), sub(p3, scale(d3, span / 3)), p3];
  const cubic = { type: "cubic", points };
  let error = 0;
  for (let j = 1; j < SAMPLES; j++) {
    const u = j / SAMPLES;
    error = Math.max(error, distance(pointAt(cubic, u), curve(a + span * u)));
  }
  return { points, error };
}

/**
 * Fit a curve over [a, b] with cubic pieces of equal parameter spans. With
 * forcedCount, that many pieces; otherwise the smallest number that keeps
 * within the tolerance, up to maxSubdivisions.
 * @param {(t: number) => {x: number, y: number}} curve
 * @returns {{pieces: {type: "cubic", points: object[]}[], count: number}}
 */
export function fitCurve(curve, a, b, forcedCount, { tolerance, maxSubdivisions }) {
  if (forcedCount > 0 || !(b > a)) {
    const count = forcedCount > 0 ? Math.round(forcedCount) : 1;
    return { pieces: curvePieces(curve, a, b, count).pieces, count };
  }
  let result;
  for (let count = 1; count <= maxSubdivisions; count++) {
    const fitted = curvePieces(curve, a, b, count);
    result = { pieces: fitted.pieces, count };
    if (fitted.error <= tolerance) {
      break;
    }
  }
  return result;
}

function curvePieces(curve, a, b, count) {
  const pieces = [];
  let error = 0;
  for (let i = 0; i < count; i++) {
    const ta = a + ((b - a) * i) / count;
    const tb = a + ((b - a) * (i + 1)) / count;
    if (!(tb > ta)) {
      const p = curve(ta);
      pieces.push({ type: "cubic", points: [p, p, p, p] });
      continue;
    }
    const fitted = hermitePiece(curve, ta, tb);
    pieces.push({ type: "cubic", points: fitted.points });
    error = Math.max(error, fitted.error);
  }
  return { pieces, error };
}
