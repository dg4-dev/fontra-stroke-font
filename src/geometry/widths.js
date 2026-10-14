// The width of a stroke along its centerline, from the widths of its points.
// No Fontra or DOM dependencies.
//
// Each side (left and right of the direction of the centerline) has its own
// half width. Every on-curve point has one on each side: its own when it sets
// it (see pointHalfWidths() in stroke-data.js), otherwise the source's (half
// the source's width). Without any point widths, it is the source's width all
// along. A closed centerline goes round the loop.
//
// Between two points, the half width changes along the length of the
// centerline:
// - along a segment without handles (a line), evenly, so that its edges stay
//   straight;
// - along a segment with handles (even one that runs straight), smoothly: at a
//   point where it meets another segment with handles, both change at the
//   same rate (the rates of the two sides, combined so that a point where the
//   width is largest or smallest stays so: see knotSlope()); where it meets a
//   line, at the line's rate; at an end of the centerline, at its own average
//   rate. The width never goes beyond the widths of the points at its ends
//   (Fritsch and Carlson's condition for monotone cubic interpolation).

import { derivativeAt, distance } from "./bezier.js";

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
 * Numbers along a centerline, from the values of its points, each changing
 * evenly along the length of the centerline between two points, as the
 * widths do (see the top of this file).
 * @param {{points: object[], isClosed?: boolean}} contour unpacked contour
 * @param {object[]} segments centerlineSegments(contour)
 * @param {object} options
 * @param {string[]} options.keys the numbers
 * @param {(values: object|undefined, key: string) => number|undefined}
 *   [options.valueAt] the number a point sets; by default values[key]
 * @param {object} options.defaults the number of each key at a point that
 *   does not set it
 * @param {object} [options.periods] keys whose numbers repeat with a period
 *   (such as an angle of 180°): each value is moved by whole periods to be
 *   within half a period of the one before it, so that the number takes the
 *   short way round
 * @param {object} [options.references] per key with a period, a function
 *   giving for a point index the number to move that point's value closest
 *   to instead (for example the same point's number in another source, so
 *   that the numbers turn the same way round in all sources); points it
 *   gives no number for follow the one before them
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
  // Where each on-curve point is along the centerline, and whether the
  // segment that starts there has handles
  const positions = new Map();
  const curvedFrom = new Set();
  for (const [index, segment] of segments.entries()) {
    if (segment.startIndex !== undefined && !positions.has(segment.startIndex)) {
      positions.set(segment.startIndex, starts[index]);
    }
    if (segment.endIndex !== undefined) {
      positions.set(segment.endIndex, starts[index] + lengths[index].length);
    }
    if (segment.type !== "line" && lengths[index].length > 0) {
      curvedFrom.add(starts[index]);
    }
  }
  const curves = {};
  for (const key of keys) {
    const knots = [];
    for (const [pointIndex, position] of positions) {
      const value = valueAt(contour.points[pointIndex]?.values, key);
      knots.push({
        x: position,
        y: value ?? defaults[key],
        pointIndex,
        curved: curvedFrom.has(position),
      });
    }
    knots.sort((a, b) => a.x - b.x);
    const period = periods[key];
    let drift = 0;
    const reference = options.references?.[key];
    if (period && knots.length) {
      for (let k = 0; k < knots.length; k++) {
        const target = reference?.(knots[k].pointIndex) ?? knots[k - 1]?.y;
        if (target !== undefined) {
          knots[k].y = closestTurn(knots[k].y, target, period);
        }
      }
      // Round a loop, the first value may come back a whole period away
      drift = closestTurn(knots[0].y, knots.at(-1).y, period) - knots[0].y;
    }
    if (contour.isClosed && knots.length) {
      // Round the loop: the knots repeated a loop's length before and after
      knots.push(
        ...knots.map(({ x, y, curved }) => ({ x: x - total, y: y - drift, curved })),
        ...knots.map(({ x, y, curved }) => ({ x: x + total, y: y + drift, curved }))
      );
    }
    curves[key] = piecewiseCurve(knots, defaults[key]);
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
 * to its parameter t. Between the samples, the length follows the speed of
 * the segment (a cubic Hermite curve), so that its rate of change has no
 * jumps: the nib method looks at how fast the nib changes along a segment.
 */
export function segmentLength(segment) {
  if (segment.type === "line") {
    const length = distance(segment.points[0], segment.points[1]);
    return { length, at: (t) => length * t };
  }
  const h = 1 / LENGTH_SAMPLES;
  const speed = (t) => {
    const d = derivativeAt(segment, t);
    return Math.hypot(d.x, d.y);
  };
  const speeds = [speed(0)];
  const table = [0];
  for (let i = 1; i <= LENGTH_SAMPLES; i++) {
    speeds.push(speed(i * h));
    // Simpson's rule
    table.push(
      table[i - 1] + (h / 6) * (speeds[i - 1] + 4 * speed((i - 0.5) * h) + speeds[i])
    );
  }
  return {
    length: table[LENGTH_SAMPLES],
    at(t) {
      const position = Math.min(1, Math.max(0, t)) * LENGTH_SAMPLES;
      const i = Math.min(LENGTH_SAMPLES - 1, Math.floor(position));
      const u = position - i;
      const u2 = u * u;
      const u3 = u2 * u;
      return (
        table[i] * (2 * u3 - 3 * u2 + 1) +
        h * speeds[i] * (u3 - 2 * u2 + u) +
        table[i + 1] * (-2 * u3 + 3 * u2) +
        h * speeds[i + 1] * (u3 - u2)
      );
    },
  };
}

/**
 * The numbers between the knots: along straight lines, or along a smooth
 * curve from a knot with curved (see the top of this file); constant before
 * the first knot and after the last one; the fallback when there are no
 * knots.
 * @param {{x: number, y: number, curved?: boolean}[]} knots
 * @returns {((x: number) => number) & {max: number,
 *   isConstantBetween: (a: number, b: number) => boolean}}
 */
export function piecewiseCurve(knots, fallback = 0) {
  const sorted = [...knots].sort((a, b) => a.x - b.x);
  // Knots at the same place (zero-length segments): the first one's number
  // counts, and the last one's segment
  const xs = [];
  const ys = [];
  const curved = [];
  for (const knot of sorted) {
    if (xs.length && knot.x - xs.at(-1) <= SAME_WIDTH) {
      curved[curved.length - 1] = !!knot.curved;
      continue;
    }
    xs.push(knot.x);
    ys.push(knot.y);
    curved.push(!!knot.curved);
  }
  const n = xs.length;
  if (n < 2) {
    const value = n ? ys[0] : fallback;
    const constant = () => value;
    constant.max = value;
    constant.isConstantBetween = () => true;
    return constant;
  }
  // The average rate of each interval, and the rates at the ends of the
  // curved ones
  const rates = [];
  for (let k = 0; k < n - 1; k++) {
    rates.push((ys[k + 1] - ys[k]) / (xs[k + 1] - xs[k]));
  }
  const ends = rates.map((rate, k) => {
    if (!curved[k]) {
      return null;
    }
    const length = xs[k + 1] - xs[k];
    // Next to another curved interval, a rate shared with it; next to a
    // line, the line's; at an end, its own
    let start = rate;
    let end = rate;
    if (k > 0) {
      start = curved[k - 1]
        ? knotSlope(rates[k - 1], rate, xs[k] - xs[k - 1], length)
        : rates[k - 1];
    }
    if (k < n - 2) {
      end = curved[k + 1]
        ? knotSlope(rate, rates[k + 1], length, xs[k + 2] - xs[k + 1])
        : rates[k + 1];
    }
    return monotone(rate, start, end);
  });
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
    if (!ends[k]) {
      return ys[k] + (ys[k + 1] - ys[k]) * u;
    }
    // Cubic Hermite
    const u2 = u * u;
    const u3 = u2 * u;
    return (
      ys[k] * (2 * u3 - 3 * u2 + 1) +
      h * ends[k].start * (u3 - 2 * u2 + u) +
      ys[k + 1] * (-2 * u3 + 3 * u2) +
      h * ends[k].end * (u3 - u2)
    );
  };
  curve.max = Math.max(...ys);
  curve.isConstantBetween = (a, b) => {
    if (b <= xs[0] || a >= xs[n - 1]) {
      return true;
    }
    const from = interval(Math.max(a, xs[0]));
    const to = interval(Math.min(b, xs[n - 1]));
    for (let k = from; k <= to; k++) {
      // The part of the interval [xs[k], xs[k + 1]] inside [a, b]
      if (Math.min(b, xs[k + 1]) - Math.max(a, xs[k]) <= SAME_WIDTH) {
        continue;
      }
      // (Monotone: an interval with equal ends is constant)
      if (Math.abs(ys[k + 1] - ys[k]) > SAME_WIDTH) {
        return false;
      }
    }
    return true;
  };
  return curve;
}

/**
 * The rate at a knot between two curved intervals with the given average
 * rates and lengths: 0 where the numbers turn back (the knot is a largest or
 * smallest number), otherwise the weighted harmonic mean of the two rates
 * (Fritsch and Butland), which lies between them.
 */
function knotSlope(before, after, lengthBefore, lengthAfter) {
  if (before * after <= 0) {
    return 0;
  }
  const sum = lengthBefore + lengthAfter;
  return (
    (3 * sum) /
    ((2 * lengthAfter + lengthBefore) / before +
      (lengthAfter + 2 * lengthBefore) / after)
  );
}

// The rates at the ends of a curved interval, limited so that the numbers in
// between stay between those at its ends
function monotone(rate, start, end) {
  if (Math.abs(rate) <= SAME_WIDTH) {
    return { start: 0, end: 0 };
  }
  let alpha = Math.max(0, start / rate);
  let beta = Math.max(0, end / rate);
  const size = Math.hypot(alpha, beta);
  if (size > 3) {
    alpha *= 3 / size;
    beta *= 3 / size;
  }
  return { start: alpha * rate, end: beta * rate };
}

/** The numbers along straight lines between the knots (see piecewiseCurve()). */
export function piecewiseLinear(knots, fallback = 0) {
  return piecewiseCurve(
    knots.map(({ x, y }) => ({ x, y })),
    fallback
  );
}
