// Finding where a stroke twists. No Fontra or DOM dependencies.
//
// Where the centerline bends with a radius smaller than the distance to one
// edge, an edge at that distance would run backwards (between two cusps) and
// form a loop, which cancels the band out and leaves a hole. In these "twist
// zones" offset.js keeps the edge on the evolute instead.
//
// The nib method (nib.js) has the same problem with an elliptical nib, with
// the curvature of the centerline as seen from the nib (where the nib is a
// circle): the functions below that take a "bend" work with either.

import { curvatureAt } from "./bezier.js";

const SAMPLES = 64;
const BISECTION_STEPS = 40;

/**
 * The twist zones of a segment: parameter intervals where the edge on one
 * side runs backwards, sorted by t0.
 * @param {{type: string, points: object[]}} segment a "line" or "cubic" segment
 * @param {number | ((side: string, t: number) => number)} half the distance
 *   from the centerline to each edge, or a function giving it per side along
 *   the segment
 * @returns {{side: "left"|"right", t0: number, t1: number}[]}
 */
export function findTwistZones(segment, half) {
  if (segment.type === "line") {
    return [];
  }
  const distanceAt = typeof half === "function" ? half : () => half;
  // The edge on the left (d = +half) runs backwards where 1 - d·k < 0
  return findZones((side, t) => {
    const sign = side === "left" ? 1 : -1;
    return sign * distanceAt(side, t) * curvatureAt(segment, t);
  });
}

/**
 * The parameter intervals where bend(side, t) > 1, per side, sorted by t0.
 * @param {(side: "left"|"right", t: number) => number} bend how far the edge
 *   on a side is from running backwards: 1 or less where it runs forwards
 * @returns {{side: "left"|"right", t0: number, t1: number}[]}
 */
export function findZones(bend) {
  const zones = [];
  for (const side of ["left", "right"]) {
    const twists = (t) => bend(side, t) > 1;
    let start = null;
    let previous = twists(0);
    if (previous) {
      start = 0;
    }
    for (let i = 1; i <= SAMPLES; i++) {
      const t = i / SAMPLES;
      const current = twists(t);
      if (current !== previous) {
        const edge = bisect(twists, (i - 1) / SAMPLES, t, previous);
        if (current) {
          start = edge;
        } else {
          zones.push({ side, t0: start, t1: edge });
          start = null;
        }
      }
      previous = current;
    }
    if (start !== null) {
      zones.push({ side, t0: start, t1: 1 });
    }
  }
  return zones.sort((a, b) => a.t0 - b.t0);
}

/**
 * The parameters in [0, 1] where a function changes sign, sorted.
 * @param {(t: number) => number} f
 */
export function signChanges(f) {
  const changes = [];
  const positive = (t) => f(t) > 0;
  let previous = positive(0);
  for (let i = 1; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const current = positive(t);
    if (current !== previous) {
      changes.push(bisect(positive, (i - 1) / SAMPLES, t, previous));
    }
    previous = current;
  }
  return changes;
}

// The parameter where test() changes from its value at a to the other value
function bisect(test, a, b, valueAtA) {
  for (let i = 0; i < BISECTION_STEPS; i++) {
    const mid = (a + b) / 2;
    if (test(mid) === valueAtA) {
      a = mid;
    } else {
      b = mid;
    }
  }
  return (a + b) / 2;
}

/**
 * The parameter in [a, b] where the segment bends most towards the given side.
 * @param {(t: number) => number} [bend] how much it bends there; by default
 *   its curvature towards the side
 */
export function sharpestBend(
  segment,
  side,
  a,
  b,
  bend = curvatureTowards(segment, side)
) {
  if (!(b > a)) {
    return a;
  }
  let best = a;
  let bestValue = -Infinity;
  for (let i = 0; i <= SAMPLES; i++) {
    const t = a + ((b - a) * i) / SAMPLES;
    const value = bend(t);
    if (value > bestValue) {
      best = t;
      bestValue = value;
    }
  }
  return best;
}

/**
 * The cusps of the evolute (the curve of the centers of curvature) between a
 * and b: where the curvature stops growing and starts shrinking or the other
 * way round.
 * @param {(t: number) => number} [bend] the curvature to use; by default the
 *   segment's, towards the side
 */
export function evoluteCusps(
  segment,
  side,
  a,
  b,
  bend = curvatureTowards(segment, side)
) {
  if (!(b > a)) {
    return [];
  }
  const step = (b - a) / SAMPLES;
  const cusps = [];
  let previous = bend(a + step) - bend(a);
  for (let i = 1; i < SAMPLES; i++) {
    const t = a + step * i;
    const slope = bend(t + step) - bend(t);
    if (Math.sign(slope) !== Math.sign(previous) && slope !== 0 && previous !== 0) {
      cusps.push(extremum(bend, t - step, t + step, previous > 0));
    }
    previous = slope;
  }
  return cusps;
}

function curvatureTowards(segment, side) {
  const sign = side === "left" ? 1 : -1;
  return (t) => sign * curvatureAt(segment, t);
}

// Golden-section search for the maximum (or minimum) of f in [a, b]
function extremum(f, a, b, findMaximum) {
  const g = (t) => (findMaximum ? f(t) : -f(t));
  const ratio = (Math.sqrt(5) - 1) / 2;
  let c = b - ratio * (b - a);
  let d = a + ratio * (b - a);
  for (let i = 0; i < BISECTION_STEPS; i++) {
    if (g(c) > g(d)) {
      b = d;
    } else {
      a = c;
    }
    c = b - ratio * (b - a);
    d = a + ratio * (b - a);
  }
  return (a + b) / 2;
}
