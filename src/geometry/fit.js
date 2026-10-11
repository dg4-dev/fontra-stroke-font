// Fitting a cubic Bézier to sampled points. No Fontra or DOM dependencies.
//
// The end points and the end tangent directions are fixed, so that pieces
// fitted next to each other join smoothly; only the two handle lengths are
// fitted, by least squares (Schneider, "An Algorithm for Automatically
// Fitting Digitized Curves", Graphics Gems, 1990).

import {
  EPSILON,
  add,
  distance,
  dot,
  pointAt,
  derivativeAt,
  scale,
  sub,
} from "./bezier.js";

const REPARAMETERIZE_ITERATIONS = 4;

/**
 * @param {{x: number, y: number}} p0 start point
 * @param {{x: number, y: number}} t0 unit tangent at the start
 * @param {{x: number, y: number}} p3 end point
 * @param {{x: number, y: number}} t3 unit tangent at the end
 * @param {{u: number, x: number, y: number}[]} samples points the curve should
 *   pass near, with a first guess of their parameter u in (0, 1)
 * @returns {{points: {x: number, y: number}[], error: number}} the cubic's
 *   four control points and the largest distance from a sample to the curve
 */
export function fitCubic(p0, t0, p3, t3, samples) {
  let params = samples.map((sample) => sample.u);
  let points = fitHandles(p0, t0, p3, t3, samples, params);
  for (let i = 0; i < REPARAMETERIZE_ITERATIONS; i++) {
    params = reparameterize(points, samples, params);
    points = fitHandles(p0, t0, p3, t3, samples, params);
  }
  params = reparameterize(points, samples, params);
  const curve = { type: "cubic", points };
  let error = 0;
  for (const [i, sample] of samples.entries()) {
    error = Math.max(error, distance(pointAt(curve, params[i]), sample));
  }
  return { points, error };
}

function fitHandles(p0, t0, p3, t3, samples, params) {
  // Q(u) = (B0 + B1) p0 + (B2 + B3) p3 + alpha B1 t0 - beta B2 t3
  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x0 = 0;
  let x1 = 0;
  for (const [i, sample] of samples.entries()) {
    const u = params[i];
    const mu = 1 - u;
    const b0 = mu * mu * mu;
    const b1 = 3 * mu * mu * u;
    const b2 = 3 * mu * u * u;
    const b3 = u * u * u;
    const a1 = scale(t0, b1);
    const a2 = scale(t3, -b2);
    const rest = sub(sample, add(scale(p0, b0 + b1), scale(p3, b2 + b3)));
    c00 += dot(a1, a1);
    c01 += dot(a1, a2);
    c11 += dot(a2, a2);
    x0 += dot(a1, rest);
    x1 += dot(a2, rest);
  }
  const chord = distance(p0, p3);
  let alpha = chord / 3;
  let beta = chord / 3;
  const det = c00 * c11 - c01 * c01;
  if (Math.abs(det) > EPSILON * Math.max(1, c00 * c11)) {
    const a = (x0 * c11 - x1 * c01) / det;
    const b = (c00 * x1 - c01 * x0) / det;
    // Handles pointing backwards (or vanishing) make loops; fall back to the
    // usual guess in that case.
    const minimum = chord * 1e-6;
    if (a > minimum && b > minimum) {
      alpha = a;
      beta = b;
    }
  }
  return [p0, add(p0, scale(t0, alpha)), sub(p3, scale(t3, beta)), p3];
}

// One Newton step per sample towards the closest point on the curve
function reparameterize(points, samples, params) {
  const curve = { type: "cubic", points };
  return samples.map((sample, i) => {
    const u = params[i];
    const p = pointAt(curve, u);
    const d1 = derivativeAt(curve, u);
    const d2 = secondDerivativeAt(points, u);
    const diff = sub(p, sample);
    const numerator = dot(diff, d1);
    const denominator = dot(d1, d1) + dot(diff, d2);
    if (Math.abs(denominator) < EPSILON) {
      return u;
    }
    const next = u - numerator / denominator;
    return Math.min(1, Math.max(0, next));
  });
}

function secondDerivativeAt([p0, p1, p2, p3], u) {
  const mu = 1 - u;
  return {
    x: 6 * (mu * (p2.x - 2 * p1.x + p0.x) + u * (p3.x - 2 * p2.x + p1.x)),
    y: 6 * (mu * (p2.y - 2 * p1.y + p0.y) + u * (p3.y - 2 * p2.y + p1.y)),
  };
}
