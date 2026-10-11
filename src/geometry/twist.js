// Finding where a stroke twists. No Fontra or DOM dependencies.
//
// Where the centerline bends with a radius smaller than the distance to one
// edge, that edge runs backwards (between two cusps) and forms a loop. Filled
// as part of one band, the loop has the opposite direction and cancels the
// band out, leaving a hole. offset.js fills these "twist zones" with separate
// shapes instead.

import { curvatureAt, tangentAt } from "./bezier.js";

const SAMPLES = 64;
const BISECTION_STEPS = 40;

/**
 * The twist zones of a segment: parameter intervals where the edge on one
 * side runs backwards, sorted by t0.
 * @param {{type: string, points: object[]}} segment a "line" or "cubic" segment
 * @param {number} half the distance from the centerline to each edge
 * @returns {{side: "left"|"right", t0: number, t1: number}[]}
 */
export function findTwistZones(segment, half) {
  if (segment.type === "line" || !(half > 0)) {
    return [];
  }
  const zones = [];
  for (const side of ["left", "right"]) {
    // The edge on the left (d = +half) runs backwards where 1 - d·k < 0
    const d = side === "left" ? half : -half;
    const twists = (t) => d * curvatureAt(segment, t) > 1;
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
 */
export function sharpestBend(segment, side, a, b) {
  if (!(b > a)) {
    return a;
  }
  const sign = side === "left" ? 1 : -1;
  let best = a;
  let bestValue = -Infinity;
  for (let i = 0; i <= SAMPLES; i++) {
    const t = a + ((b - a) * i) / SAMPLES;
    const value = sign * curvatureAt(segment, t);
    if (value > bestValue) {
      best = t;
      bestValue = value;
    }
  }
  return best;
}

/**
 * How far the tangent turns between a and b, in radians (absolute).
 */
export function turning(segment, a, b) {
  return cumulativeTurning(segment, a, b).at(-1).angle;
}

/**
 * Parameters that split [a, b] into the given number of parts that turn by
 * the same angle. Returns parts + 1 values, from a to b.
 */
export function splitByTurning(segment, a, b, parts) {
  if (parts <= 1 || !(b > a)) {
    return Array.from({ length: parts + 1 }, (_, i) => (i === parts ? b : a));
  }
  const samples = cumulativeTurning(segment, a, b);
  const total = samples.at(-1).angle;
  const result = [a];
  for (let i = 1; i < parts; i++) {
    const target = (total * i) / parts;
    const k = samples.findIndex((sample) => sample.angle >= target);
    const before = samples[k - 1];
    const after = samples[k];
    const span = after.angle - before.angle;
    const f = span > 0 ? (target - before.angle) / span : 0;
    result.push(before.t + (after.t - before.t) * f);
  }
  result.push(b);
  return result;
}

function cumulativeTurning(segment, a, b) {
  const samples = [{ t: a, angle: 0 }];
  let previous = tangentAt(segment, a);
  let angle = 0;
  for (let i = 1; i <= SAMPLES; i++) {
    const t = a + ((b - a) * i) / SAMPLES;
    const tangent = tangentAt(segment, t);
    angle += Math.abs(
      Math.atan2(
        previous.x * tangent.y - previous.y * tangent.x,
        previous.x * tangent.x + previous.y * tangent.y
      )
    );
    samples.push({ t, angle });
    previous = tangent;
  }
  return samples;
}
