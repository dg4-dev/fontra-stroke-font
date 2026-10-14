// The width of a stroke along its centerline, from the widths of its points.
// No Fontra or DOM dependencies.
//
// Each side (left and right of the direction of the centerline) has its own
// half width. Every on-curve point has one on each side: its own when it sets
// it (see pointHalfWidths() in stroke-data.js), otherwise the source's (half
// the source's width). Without any point widths, it is the source's width all
// along. A closed centerline goes round the loop.
//
// Between two points, the half width changes:
// - along a segment without handles (a line), evenly along its length, so
//   that its edges stay straight;
// - along a segment with handles (even one that runs straight), smoothly,
//   along the curve's own parameter: from one point to the other as the
//   curve goes from one end to the other, so its handles set the pace. With
//   both handles a third of the way, the width changes evenly; with longer
//   handles, it stays near the widths of the points for longer and changes
//   in the middle; with shorter ones, it changes near the points.
// Where a segment with handles meets another segment, the width goes on so
// that the edges have no kink. On a bend, the edge at the half width w from a
// centerline bending with curvature k towards it moves (1 − k·w) times as
// fast as the centerline (see widthProfile()), and turns towards w′ / (1 − k·w)
// from the centerline's direction; so on each side, the rate of the width
// divided by (1 − k·w) is the same on both sides of the point, even where
// the bend changes there (as it usually does where two Bézier curves meet):
// - next to another segment with handles, a rate shared between the two (see
//   knotSlope(); 0 where the width is largest or smallest, and between such
//   segments it never goes beyond the widths of their points: Fritsch and
//   Carlson's condition for monotone cubic interpolation);
// - next to a line, the line's; that can take the width a little beyond the
//   point's, but never below 0.

import { curvatureAt, derivativeAt, distance, isDegenerateSegment } from "./bezier.js";

// Samples per curve for measuring its length
const LENGTH_SAMPLES = 32;
// Widths closer than this are the same
const SAME_WIDTH = 1e-9;
// The slowest an edge is taken to move (where the centerline bends as tight
// as the width, it stops)
const EDGE_SPEED = 1e-3;

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
export function widthProfile(contour, segments, style, { pointsOnly = false } = {}) {
  const defaultHalf = Math.max(0, style.width) / 2;
  const profile = valueProfile(contour, segments, {
    pointsOnly,
    keys: ["left", "right"],
    valueAt: pointHalfWidth,
    defaults: { left: defaultHalf, right: defaultHalf },
    // The left edge is on the inside where the centerline turns left
    edgeSpeed: (key, index, atEnd, half) => {
      const sign = key === "left" ? 1 : -1;
      const bend = sign * curvatureAt(segments[index], atEnd ? 1 : 0);
      return Math.max(0, 1 - bend * half);
    },
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
 * @param {boolean} [options.pointsOnly] only the numbers at the points are
 *   wanted (atPoint() and max): the segments are left out, and nothing is
 *   measured
 * @param {object} [options.references] per key with a period, a function
 *   giving for a point index the number to move that point's value closest
 *   to instead (for example the same point's number in another source, so
 *   that the numbers turn the same way round in all sources); points it
 *   gives no number for follow the one before them
 * @param {(key: string, segmentIndex: number, atEnd: boolean, value: number)
 *   => number} [options.edgeSpeed] how many times as fast as the centerline
 *   the edge that the number sets moves at the start (atEnd false) or end of
 *   a segment, given the number there (1 − k·w for a half width w, see the
 *   top of this file); 1 by default. Where segments meet, the rates of the
 *   number divided by it are the same on both sides
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
  // Only the numbers at the points: their order along the centerline is all
  // that counts, so the lengths are not measured
  const lengths = options.pointsOnly
    ? segments.map((segment) => {
        const length = isDegenerateSegment(segment) ? 0 : 1;
        return { length, at: (t) => length * t };
      })
    : segments.map(segmentLength);
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
  const curves = {};
  for (const key of keys) {
    const knots = [];
    for (const [pointIndex, position] of positions) {
      const value = valueAt(contour.points[pointIndex]?.values, key);
      knots.push({ x: position, y: value ?? defaults[key], pointIndex });
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
        ...knots.map(({ x, y }) => ({ x: x - total, y: y - drift })),
        ...knots.map(({ x, y }) => ({ x: x + total, y: y + drift }))
      );
    }
    curves[key] = piecewiseLinear(knots, defaults[key]);
  }

  if (options.pointsOnly) {
    return {
      segments: [],
      atPoint: (pointIndex) => {
        const position = positions.get(pointIndex);
        return position === undefined
          ? undefined
          : Object.fromEntries(keys.map((key) => [key, curves[key](position)]));
      },
      max: Object.fromEntries(keys.map((key) => [key, curves[key].max])),
    };
  }

  // Each segment: whether it has handles, its length and how fast the curve
  // leaves and reaches its ends (the handles), and the segments next to it
  const usable = segments.map((segment, index) => lengths[index].length > 0);
  const info = segments.map((segment, index) => {
    const speed = (t) => {
      const d = derivativeAt(segment, t);
      return Math.hypot(d.x, d.y);
    };
    return {
      curved: segment.type !== "line",
      length: lengths[index].length,
      speeds: [speed(0), speed(1)],
    };
  });
  const neighbor = (index, step) => {
    for (let k = 1; k < segments.length; k++) {
      let other = index + step * k;
      if (contour.isClosed) {
        other = (other + segments.length) % segments.length;
      } else if (other < 0 || other >= segments.length) {
        return undefined;
      }
      if (usable[other]) {
        return other;
      }
    }
    return undefined;
  };

  const profileSegments = segments.map((segment, index) => {
    const start = starts[index];
    const end = start + lengths[index].length;
    const along = lengths[index].at;
    const entry = { constant: {} };
    for (const key of keys) {
      const curve = curves[key];
      const { curved, length, speeds } = info[index];
      if (!curved || !usable[index]) {
        entry[key] = (t) => curve(start + along(t));
        entry.constant[key] = curve.isConstantBetween(start, end);
        continue;
      }
      const y0 = curve(start);
      const y1 = curve(end);
      const change = y1 - y0;
      // The rate along the centerline at an end of a segment, when the
      // number goes evenly along its parameter (a line: along its length)
      const own = (i, atEnd) => {
        const other = info[i];
        const d = curves[key](starts[i] + lengths[i].length) - curves[key](starts[i]);
        const speed = other.curved ? other.speeds[atEnd ? 1 : 0] : other.length;
        return speed > 0 ? d / speed : d / other.length;
      };
      // The rate (along the parameter) at each end: from the segment next to
      // it, or evenly along the parameter at an end of the centerline
      const endRate = (atEnd) => {
        const other = neighbor(index, atEnd ? 1 : -1);
        const speed = speeds[atEnd ? 1 : 0];
        if (other === undefined) {
          return { rate: change };
        }
        // Rates divided by how fast the edge moves on each side (see the top
        // of this file): equal ones make the edges meet without a kink
        const value = atEnd ? y1 : y0;
        const edge = (i, iAtEnd) =>
          Math.max(EDGE_SPEED, options.edgeSpeed?.(key, i, iAtEnd, value) ?? 1);
        const mineEdge = edge(index, atEnd);
        const theirs = own(other, !atEnd) / edge(other, !atEnd);
        if (!info[other].curved) {
          return { rate: theirs * mineEdge * speed, line: true };
        }
        const mine = own(index, atEnd) / mineEdge;
        let shared = atEnd
          ? knotSlope(mine, theirs, length, info[other].length)
          : knotSlope(theirs, mine, info[other].length, length);
        // At most 3 times the change of each of the two segments along its
        // parameter, so that neither goes beyond the numbers of its points
        // (Fritsch and Carlson); the same limit on both sides keeps them
        // meeting without a kink
        const limit = (i, iAtEnd, edgeSpeed) => {
          const d = curves[key](starts[i] + lengths[i].length) - curves[key](starts[i]);
          const along = edgeSpeed * info[i].speeds[iAtEnd ? 1 : 0];
          return along > 0 ? (3 * Math.abs(d)) / along : Infinity;
        };
        const most = Math.min(
          limit(index, atEnd, mineEdge),
          limit(other, !atEnd, edge(other, !atEnd))
        );
        shared = Math.sign(shared) * Math.min(Math.abs(shared), most);
        return { rate: shared * mineEdge * speed };
      };
      const m0 = endRate(false).rate;
      const m1 = endRate(true).rate;
      const floor = Math.min(y0, y1) >= 0 ? 0 : -Infinity;
      entry[key] = (t) => {
        const u = Math.min(1, Math.max(0, t));
        const u2 = u * u;
        const u3 = u2 * u;
        const value =
          y0 * (2 * u3 - 3 * u2 + 1) +
          m0 * (u3 - 2 * u2 + u) +
          y1 * (-2 * u3 + 3 * u2) +
          m1 * (u3 - u2);
        // Beyond the points (next to a line), never below 0 when they are not
        return Math.max(floor, value);
      };
      entry.constant[key] =
        Math.abs(change) <= SAME_WIDTH &&
        Math.abs(m0) <= SAME_WIDTH &&
        Math.abs(m1) <= SAME_WIDTH;
    }
    return entry;
  });
  // The largest numbers, also where a segment with handles goes beyond its
  // points
  const max = Object.fromEntries(keys.map((key) => [key, curves[key].max]));
  for (const [index, entry] of profileSegments.entries()) {
    if (info[index].curved && usable[index]) {
      for (const key of keys) {
        for (let i = 1; i < 32; i++) {
          max[key] = Math.max(max[key], entry[key](i / 32));
        }
      }
    }
  }
  return {
    segments: profileSegments,
    atPoint(pointIndex) {
      const position = positions.get(pointIndex);
      return position === undefined
        ? undefined
        : Object.fromEntries(keys.map((key) => [key, curves[key](position)]));
    },
    max,
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
 * The numbers along straight lines between the knots, constant before the
 * first and after the last one; the fallback when there are no knots.
 * @param {{x: number, y: number}[]} knots
 * @returns {((x: number) => number) & {max: number,
 *   isConstantBetween: (a: number, b: number) => boolean}}
 */
export function piecewiseLinear(knots, fallback = 0) {
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
  const line = (x) => {
    if (x <= xs[0]) {
      return ys[0];
    }
    if (x >= xs[n - 1]) {
      return ys[n - 1];
    }
    const k = interval(x);
    const u = (x - xs[k]) / (xs[k + 1] - xs[k]);
    return ys[k] + (ys[k + 1] - ys[k]) * u;
  };
  line.max = Math.max(...ys);
  line.isConstantBetween = (a, b) => {
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
      if (Math.abs(ys[k + 1] - ys[k]) > SAME_WIDTH) {
        return false;
      }
    }
    return true;
  };
  return line;
}

/**
 * The rate at a point between two segments with handles, from the rates the
 * two would have there on their own, and their lengths: 0 where the numbers turn back (the knot is a largest or
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
