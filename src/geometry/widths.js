// The width of a stroke along its centerline, from the widths of its points.
// No Fontra or DOM dependencies.
//
// Each side (left and right of the direction of the centerline) has its own
// half width. A point sets it on a side when it has a value for that side
// (see pointHalfWidths() in stroke-data.js). In between, the half width
// follows a curve through the points that set it, along the length of the
// centerline:
// - an end point of the centerline that does not set it uses the source's
//   default (half the source's width);
// - a point in the middle that does not set it takes the value of the curve,
//   so adding a point to a centerline does not change its stroke.
// The curve is a monotone cubic (Fritsch–Carlson): it is smooth, so the edges
// do not bend at smooth points, and between two points it never goes beyond
// their values. Without any point widths, it is the source's width all along.
// A closed centerline has no ends: its curve goes round the loop.

import { distance, pointAt } from "./bezier.js";

// Samples per curve for measuring its length
const LENGTH_SAMPLES = 32;
// Widths closer than this are the same
const SAME_WIDTH = 1e-9;

/**
 * @param {{points: object[]}} contour unpacked contour; points may have
 *   `values` (sanitized point values, see stroke-data.js)
 * @param {object[]} segments centerlineSegments(contour)
 * @param {{width: number}} style the source's values
 * @returns {{
 *   segments: {left: (t: number) => number, right: (t: number) => number,
 *     constant: {left: boolean, right: boolean}}[],
 *   atPoint: (pointIndex: number) => {left: number, right: number}|undefined,
 *   max: number,
 * }} half widths along each segment (by its parameter t) and at each
 *   on-curve point at the end of a segment; max is the largest half width
 */
export function widthProfile(contour, segments, style) {
  const defaultHalf = Math.max(0, style.width) / 2;
  const profile = valueProfile(contour, segments, {
    keys: ["left", "right"],
    valueAt: pointHalfWidth,
    defaults: { left: defaultHalf, right: defaultHalf },
  });
  return { ...profile, max: Math.max(profile.max.left, profile.max.right) };
}

/**
 * Numbers along a centerline, from the values of its points, each following
 * a monotone cubic along the length of the centerline as the widths do (see
 * the top of this file).
 * @param {{points: object[], isClosed?: boolean}} contour unpacked contour
 * @param {object[]} segments centerlineSegments(contour)
 * @param {object} options
 * @param {string[]} options.keys the numbers
 * @param {(values: object|undefined, key: string) => number|undefined}
 *   [options.valueAt] the number a point sets; by default values[key]
 * @param {object} options.defaults the number of each key at an end of an
 *   open centerline that does not set it, and all along one without values
 * @param {object} [options.periods] keys whose numbers repeat with a period
 *   (such as an angle of 180°): each value is moved by whole periods to be
 *   within half a period of the one before it, so that the number takes the
 *   short way round
 * @returns {{
 *   segments: (object & {constant: object})[],
 *   atPoint: (pointIndex: number) => object|undefined,
 *   max: object,
 * }} per segment, a function of t per key, and whether it is constant; the
 *   numbers at an on-curve point at the end of a segment; the largest number
 *   of each key
 */
export function valueProfile(contour, segments, options) {
  const { keys, defaults } = options;
  const valueAt = options.valueAt ?? ((values, key) => values?.[key]);
  const periods = options.periods ?? {};
  const lengths = segments.map(segmentLength);
  const starts = [];
  let total = 0;
  for (const measure of lengths) {
    starts.push(total);
    total += measure.length;
  }
  // Where each on-curve point is along the centerline
  const positions = new Map();
  for (const [index, segment] of segments.entries()) {
    if (segment.startIndex !== undefined && !positions.has(segment.startIndex)) {
      positions.set(segment.startIndex, starts[index]);
    }
    if (segment.endIndex !== undefined) {
      positions.set(segment.endIndex, starts[index] + lengths[index].length);
    }
  }
  const firstIndex = segments[0]?.startIndex;
  const lastIndex = segments.at(-1)?.endIndex;

  const curves = {};
  for (const key of keys) {
    const knots = [];
    for (const [pointIndex, position] of positions) {
      let value = valueAt(contour.points[pointIndex]?.values, key);
      if (
        value === undefined &&
        !contour.isClosed &&
        (pointIndex === firstIndex || pointIndex === lastIndex)
      ) {
        value = defaults[key];
      }
      if (value !== undefined) {
        knots.push({ x: position, y: value });
      }
    }
    knots.sort((a, b) => a.x - b.x);
    const period = periods[key];
    let drift = 0;
    if (period && knots.length) {
      for (let k = 1; k < knots.length; k++) {
        knots[k].y = closestTurn(knots[k].y, knots[k - 1].y, period);
      }
      // Round a loop, the first value may come back a whole period away
      drift = closestTurn(knots[0].y, knots.at(-1).y, period) - knots[0].y;
    }
    if (contour.isClosed && knots.length) {
      // Round the loop: the knots repeated a loop's length before and after
      knots.push(
        ...knots.map(({ x, y }) => ({ x: x - total, y: y - drift })),
        ...knots.map(({ x, y }) => ({ x: x + total, y: y + drift }))
      );
    }
    curves[key] = monotoneCubic(knots, defaults[key]);
  }

  const profileSegments = segments.map((segment, index) => {
    const start = starts[index];
    const end = start + lengths[index].length;
    const along = lengths[index].at;
    const entry = { constant: {} };
    for (const key of keys) {
      entry[key] = (t) => curves[key](start + along(t));
      entry.constant[key] = curves[key].isConstantBetween(start, end);
    }
    return entry;
  });
  return {
    segments: profileSegments,
    atPoint(pointIndex) {
      const position = positions.get(pointIndex);
      return position === undefined
        ? undefined
        : Object.fromEntries(keys.map((key) => [key, curves[key](position)]));
    },
    max: Object.fromEntries(keys.map((key) => [key, curves[key].max])),
  };
}

// value moved by whole periods to be within half a period of reference
function closestTurn(value, reference, period) {
  return value - period * Math.round((value - reference) / period);
}

function pointHalfWidth(values, side) {
  if (!values) {
    return undefined;
  }
  if (values[side] !== undefined) {
    return values[side];
  }
  return values.width !== undefined ? values.width / 2 : undefined;
}

/**
 * The length of a segment, and a function giving the length from its start
 * to its parameter t.
 */
export function segmentLength(segment) {
  if (segment.type === "line") {
    const length = distance(segment.points[0], segment.points[1]);
    return { length, at: (t) => length * t };
  }
  const table = [0];
  let previous = segment.points[0];
  for (let i = 1; i <= LENGTH_SAMPLES; i++) {
    const point = pointAt(segment, i / LENGTH_SAMPLES);
    table.push(table[i - 1] + distance(previous, point));
    previous = point;
  }
  return {
    length: table[LENGTH_SAMPLES],
    at(t) {
      const position = Math.min(1, Math.max(0, t)) * LENGTH_SAMPLES;
      const i = Math.min(LENGTH_SAMPLES - 1, Math.floor(position));
      return table[i] + (table[i + 1] - table[i]) * (position - i);
    },
  };
}

/**
 * A monotone cubic through the knots (Fritsch–Carlson), constant before the
 * first and after the last one; the fallback when there are no knots.
 * @param {{x: number, y: number}[]} knots
 * @returns {((x: number) => number) & {max: number,
 *   isConstantBetween: (a: number, b: number) => boolean}}
 */
export function monotoneCubic(knots, fallback = 0) {
  const sorted = [...knots].sort((a, b) => a.x - b.x);
  // Knots at the same place (zero-length segments): the first one counts
  const xs = [];
  const ys = [];
  for (const { x, y } of sorted) {
    if (xs.length && x - xs.at(-1) <= SAME_WIDTH) {
      continue;
    }
    xs.push(x);
    ys.push(y);
  }
  const n = xs.length;
  if (n < 2) {
    const value = n ? ys[0] : fallback;
    const constant = () => value;
    constant.max = value;
    constant.isConstantBetween = () => true;
    return constant;
  }
  const deltas = [];
  for (let k = 0; k < n - 1; k++) {
    deltas.push((ys[k + 1] - ys[k]) / (xs[k + 1] - xs[k]));
  }
  const slopes = [deltas[0]];
  for (let k = 1; k < n - 1; k++) {
    slopes.push(deltas[k - 1] * deltas[k] <= 0 ? 0 : (deltas[k - 1] + deltas[k]) / 2);
  }
  slopes.push(deltas[n - 2]);
  for (let k = 0; k < n - 1; k++) {
    if (Math.abs(deltas[k]) <= SAME_WIDTH) {
      slopes[k] = 0;
      slopes[k + 1] = 0;
      continue;
    }
    const a = slopes[k] / deltas[k];
    const b = slopes[k + 1] / deltas[k];
    const sum = a * a + b * b;
    if (sum > 9) {
      const tau = 3 / Math.sqrt(sum);
      slopes[k] = tau * a * deltas[k];
      slopes[k + 1] = tau * b * deltas[k];
    }
  }
  const interval = (x) => {
    let low = 0;
    let high = n - 2;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (xs[mid] <= x) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    return low;
  };
  const curve = (x) => {
    if (x <= xs[0]) {
      return ys[0];
    }
    if (x >= xs[n - 1]) {
      return ys[n - 1];
    }
    const k = interval(x);
    const h = xs[k + 1] - xs[k];
    const u = (x - xs[k]) / h;
    const u2 = u * u;
    const u3 = u2 * u;
    return (
      (2 * u3 - 3 * u2 + 1) * ys[k] +
      (u3 - 2 * u2 + u) * h * slopes[k] +
      (-2 * u3 + 3 * u2) * ys[k + 1] +
      (u3 - u2) * h * slopes[k + 1]
    );
  };
  // Monotone between knots, so the largest value is at a knot
  curve.max = Math.max(...ys);
  curve.isConstantBetween = (a, b) => {
    const from = interval(Math.max(a, xs[0]));
    const to = interval(Math.min(b, xs[n - 1]));
    if (b <= xs[0] || a >= xs[n - 1]) {
      return true;
    }
    for (let k = from; k <= to; k++) {
      // The part of the interval [xs[k], xs[k + 1]] inside [a, b]
      if (Math.min(b, xs[k + 1]) - Math.max(a, xs[k]) <= SAME_WIDTH) {
        continue;
      }
      if (Math.abs(ys[k + 1] - ys[k]) > SAME_WIDTH) {
        return false;
      }
    }
    return true;
  };
  return curve;
}
