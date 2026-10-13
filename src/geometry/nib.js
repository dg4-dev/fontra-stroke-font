// The nib stroke method: a nib (an ellipse or a rectangle) is moved along the
// centerline, and what it covers is filled. No Fontra or DOM dependencies;
// the preview and the CLI both use this module.
//
// The nib at a place is the linear map M = rotation(angle) · scale(a, b),
// with a and b half the major and minor lengths, applied to the unit circle
// (an ellipse) or to the square with corners (±1, ±1) (a rectangle; a flat
// nib is one with b = 0). The numbers can change along the centerline (see
// valueProfile() in widths.js); at each place, the nib there is used, as if
// it stayed that size along the curve (as the offset method does with
// widths). The edges, corners and ends are put together by sweep.js.
//
// A point's angle is from horizontal, or, when the point's angleBase is
// "centerline", from across the direction of the centerline at the point
// (CENTERLINE_ZERO) (halfway
// between the directions in and out at a corner; see pointDirections()), so
// that the nib turns with the centerline. Along a segment, the nib's angle is
// a frame plus the angle values in between (see nibAlong()): the frame of an
// end measured from the centerline follows the segment's direction, and that
// of an end measured from horizontal is 0; in between, the two are blended.
//
// Elliptical nib: seen through M⁻¹, the nib is a unit circle and the
// centerline another curve c. The stroke of c with a circle of radius 1 is
// what the offset method draws for width 2, and M maps it back: the edge
// point at t is C(t) + M·ñ(t), with ñ the unit normal of c, and where c bends
// with a radius under 1 (twists, see twist.js), the edge follows the centers
// of curvature of c, as in offset.js. A linear map keeps lines, Bézier curves,
// insides and directions, so this keeps what the offset method guarantees.
//
// Rectangular nib: the edge on each side is drawn by the corner of the nib
// that is farthest out along the normal, and that corner changes where the
// centerline runs parallel to a side of the nib. Between those places, the
// band is the swept diagonal of the nib, from C + M·v to C − M·v (v one of
// (±1, ±1)), which never folds since the diagonal never lies along the
// centerline there. The band is cut where the corner changes, and at every
// smooth point, and the whole nib is placed there: it covers both ends of the
// bands that meet there. On the inner side of a bend the edge jumps back,
// which in a single band would fold it and leave a hole.
//
// Straight segments: the edges are the common tangents of the nibs at the
// two ends (see lineEdge()), so that they stay straight whatever the nib does
// along the segment.
//
// Corners and ends: the whole nib, placed at the point, which covers what
// sweeps around it there. The same points whatever the angle, so the sources
// of a glyph stay compatible.
//
// The layout (see sweep.js): an elliptical nib's edge is split where it
// starts or stops following the evolute, at the cusps of the evolute, and
// where fitting it needs more than the most pieces (see fitCurveSplitting());
// both edges of a rectangular nib are split where the corner can change
// (where the centerline runs parallel to a side of the nib), whatever the
// sizes of the sides.

import {
  EPSILON,
  add,
  cross,
  derivativeAt,
  dot,
  endTangent,
  isDegenerateSegment,
  leftNormal,
  normalize,
  pointAt,
  scale,
  secondDerivativeAt,
  startTangent,
  sub,
  tangentAt,
} from "./bezier.js";
import { centerlineSegments } from "./centerline.js";
import { fitCurve, fitCurveSplitting } from "./fit.js";
import { DEFAULT_TOLERANCE, MAX_SUBDIVISIONS } from "./offset.js";
import { circleContour, polygonContour } from "./shapes.js";
import { innerBreaks, mergeBreaks, sweepContour, validBreaks } from "./sweep.js";
import { evoluteCusps, findZones, sharpestBend, signChanges } from "./twist.js";
import { segmentLength, valueProfile } from "./widths.js";

/**
 * The smallest axis an ellipse is drawn with (font units): an ellipse with a
 * shorter axis has no inverse map. A flat nib is a rectangle with minor 0.
 */
export const MIN_ELLIPSE_AXIS = 1;

// Parameters closer than this to a change of corner count as on it
const SAME_SIGN = 1e-9;

/**
 * Stroke a centerline with a nib.
 *
 * @param {{points: object[], isClosed: boolean}} contour unpacked contour; a
 *   closed one is stroked as a loop. On-curve points may have `values`:
 *   their own major, minor and angle (sanitized, see stroke-data.js)
 * @param {{shape: "ellipse"|"rect", major: number, minor: number,
 *   angle: number}} style the glyph's nib shape and the source's numbers
 * @param {object} [options] tolerance, maxSubdivisions and layout, as for
 *   strokeOffsetContour() in offset.js
 * @returns {{contours: object[], layout: object, twists: object[],
 *   layoutMismatch: boolean}} as strokeOffsetContour() does
 */
export function strokeNibContour(contour, style, options = {}) {
  const fitOptions = {
    tolerance: options.tolerance ?? DEFAULT_TOLERANCE,
    maxSubdivisions: options.maxSubdivisions ?? MAX_SUBDIVISIONS,
  };
  const segments = centerlineSegments(contour);
  const { profile, at } = nibAlong(contour, style, segments);
  const isRect = style.shape === "rect";
  const minAxis = isRect ? 0 : MIN_ELLIPSE_AXIS;
  const nibAt = (index, t) => {
    const { major, minor, angle } = at(index, t);
    return makeNib(major, minor, angle, minAxis);
  };
  const shapeAt = (point, nib) =>
    isRect ? rectContour(point, nib) : ellipseContour(point, nib);

  const method = {
    isEmpty: !(profile.max.major > 0 || profile.max.minor > 0),
    cutsAtSmoothPoints: isRect,
    buildSegment(segment, index, forced) {
      const nib = (t) => nibAt(index, t);
      return isRect
        ? rectSegment(segment, index, nib, forced, fitOptions)
        : ellipseSegment(segment, index, nib, forced, fitOptions);
    },
    cornerShape(previous, current) {
      return shapeAt(
        pointAt(current.segment, current.t0),
        nibAt(current.index, current.t0)
      );
    },
    capShapes(first, last) {
      return [
        shapeAt(first.segment.points[0], nibAt(first.index, first.t0)),
        shapeAt(last.segment.points.at(-1), nibAt(last.index, last.t1)),
      ];
    },
    dotShapes(pointIndex) {
      const point = contour.points[pointIndex];
      const values = point.values;
      const major = values?.major ?? style.major;
      const minor = values?.minor ?? style.minor;
      if (!(major > 0 || minor > 0)) {
        return [];
      }
      return [
        shapeAt(point, makeNib(major, minor, values?.angle ?? style.angle, minAxis)),
      ];
    },
  };
  return sweepContour(contour, segments, method, options.layout);
}

/**
 * The nib along a centerline: its major and minor axes, and its angle from
 * horizontal.
 * @param {{points: object[], isClosed: boolean}} contour unpacked, with the
 *   points' values
 * @param {{major: number, minor: number, angle: number}} style
 * @returns {{profile: object, at: (index: number, t: number) =>
 *   {major: number, minor: number, angle: number}}} the numbers of the points
 *   along the centerline (see valueProfile()), and the nib on a segment
 */
export function nibAlong(contour, style, segments = centerlineSegments(contour)) {
  const profile = valueProfile(contour, segments, {
    keys: ["major", "minor", "angle"],
    defaults: { major: style.major, minor: style.minor, angle: style.angle },
    periods: { angle: 180 },
  });
  const frame = segmentFrames(contour, segments);
  return {
    profile,
    at(index, t) {
      const numbers = profile.segments[index];
      return {
        major: numbers.major(t),
        minor: numbers.minor(t),
        angle: numbers.angle(t) + frame(index, t),
      };
    },
  };
}

/** Whether a point's angle is measured from the centerline. */
export function fromCenterline(values) {
  return values?.angleBase === "centerline";
}

/**
 * Where 0° of an angle measured from the centerline lies, from the
 * centerline's direction: across it, so that the nib draws its widest there.
 */
export const CENTERLINE_ZERO = 90;

/**
 * The direction a point's angle is measured from, in degrees from
 * horizontal: 0, or for a point measured from the centerline, across the
 * centerline's direction there.
 * @param {object|undefined} values the point's values
 * @param {number|undefined} direction the centerline's direction at the point
 */
export function angleFrame(values, direction) {
  return fromCenterline(values) && direction !== undefined
    ? direction + CENTERLINE_ZERO
    : 0;
}

/**
 * The direction of the centerline at each on-curve point at the end of a
 * segment, in degrees from horizontal: the direction of the segments there,
 * halfway between the one arriving and the one leaving at a corner.
 * @returns {Map<number, number>} point index → degrees
 */
export function pointDirections(segments) {
  const arriving = new Map();
  const leaving = new Map();
  for (const segment of segments) {
    if (isDegenerateSegment(segment)) {
      continue;
    }
    if (segment.startIndex !== undefined && !leaving.has(segment.startIndex)) {
      leaving.set(segment.startIndex, startTangent(segment));
    }
    if (segment.endIndex !== undefined) {
      arriving.set(segment.endIndex, endTangent(segment));
    }
  }
  const directions = new Map();
  for (const index of new Set([...arriving.keys(), ...leaving.keys()])) {
    const a = arriving.get(index);
    const b = leaving.get(index);
    // Turning back on itself, the two directions cancel out: the arriving one
    const direction = (a && b && normalize(add(a, b))) || a || b;
    directions.set(index, degrees(direction));
  }
  return directions;
}

function degrees(v) {
  return (Math.atan2(v.y, v.x) * 180) / Math.PI;
}

// The difference of two angles, within half a turn
function turn(a, b) {
  return a - b - 360 * Math.round((a - b) / 360);
}

/**
 * The frame the angle values along each segment are measured from, in
 * degrees from horizontal (see the top of this file).
 * @returns {(index: number, t: number) => number}
 */
function segmentFrames(contour, segments) {
  const directions = pointDirections(segments);
  const frames = segments.map((segment) => {
    const startFrom = fromCenterline(contour.points[segment.startIndex]?.values);
    const endFrom = fromCenterline(contour.points[segment.endIndex]?.values);
    if ((!startFrom && !endFrom) || isDegenerateSegment(segment)) {
      return null;
    }
    // The segment's direction, without jumps of a whole turn along it
    const steps = 32;
    const samples = [degrees(tangentAt(segment, 0))];
    for (let i = 1; i <= steps; i++) {
      const previous = samples[i - 1];
      samples.push(previous + turn(degrees(tangentAt(segment, i / steps)), previous));
    }
    const direction = (t) => {
      const near = samples[Math.round(Math.min(1, Math.max(0, t)) * steps)];
      return near + turn(degrees(tangentAt(segment, t)), near);
    };
    // At an end measured from the centerline, the point's direction (halfway
    // at a corner) instead of the segment's own
    const correction = (index, t) => {
      const point = directions.get(index);
      return point === undefined ? 0 : turn(point, direction(t));
    };
    const along = segmentLength(segment);
    return {
      startFrom,
      endFrom,
      direction,
      startCorrection: correction(segment.startIndex, 0),
      endCorrection: correction(segment.endIndex, 1),
      along,
    };
  });
  return (index, t) => {
    const frame = frames[index];
    if (!frame) {
      return 0;
    }
    const s = frame.along.length > 0 ? frame.along.at(t) / frame.along.length : t;
    const own = frame.direction(t);
    const start = frame.startFrom ? own + frame.startCorrection + CENTERLINE_ZERO : 0;
    const end = frame.endFrom ? own + frame.endCorrection + CENTERLINE_ZERO : 0;
    return start + (end - start) * s;
  };
}

// --- The nib as a linear map --------------------------------------------------

/**
 * @returns {{a: number, b: number, cos: number, sin: number}} the half axes
 *   and the direction of the major axis
 */
export function makeNib(major, minor, angle, minAxis = 0) {
  const radians = (angle * Math.PI) / 180;
  return {
    a: Math.max(major, minAxis) / 2,
    b: Math.max(minor, minAxis) / 2,
    cos: Math.cos(radians),
    sin: Math.sin(radians),
  };
}

/** M·p: from the nib's own coordinates (unit circle or square) to the font's. */
export function fromNib(nib, p) {
  const x = nib.a * p.x;
  const y = nib.b * p.y;
  return { x: x * nib.cos - y * nib.sin, y: x * nib.sin + y * nib.cos };
}

/** M⁻¹·p, for an ellipse (a, b > 0). */
function toNib(nib, p) {
  const x = p.x * nib.cos + p.y * nib.sin;
  const y = -p.x * nib.sin + p.y * nib.cos;
  return { x: x / nib.a, y: y / nib.b };
}

export function ellipseContour(center, nib) {
  return circleContour(center, 1, (p) => fromNib(nib, p));
}

/** The rectangle, counter-clockwise. A flat nib gives a contour without area. */
export function rectContour(center, nib) {
  return polygonContour(
    [
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
      { x: -1, y: -1 },
    ].map((p) => add(center, fromNib(nib, p)))
  );
}

// --- Elliptical nib -----------------------------------------------------------

/**
 * The curvature, at t, of the centerline seen through the nib there (where
 * the nib is a unit circle): positive where it turns left.
 */
function nibCurvature(segment, nib, t) {
  for (const u of [t, Math.min(1, t + 1e-4), Math.max(0, t - 1e-4)]) {
    const d1 = toNib(nib, derivativeAt(segment, u));
    const speedSquared = dot(d1, d1);
    if (speedSquared > EPSILON) {
      const d2 = toNib(nib, secondDerivativeAt(segment, u));
      return cross(d1, d2) / (speedSquared * Math.sqrt(speedSquared));
    }
  }
  return 0;
}

/**
 * A point on an edge of an elliptical nib: the point of the nib farthest out
 * towards the side, or, where the centerline seen through the nib bends with
 * a radius under 1, that far along the same direction as the radius.
 */
export function ellipseEdgePoint(segment, side, nib, t) {
  const sign = side === "left" ? 1 : -1;
  const bend = sign * nibCurvature(segment, nib, t);
  const distance = bend > 1 ? 1 / bend : 1;
  const direction = normalize(toNib(nib, tangentAt(segment, t))) ?? { x: 1, y: 0 };
  const normal = scale(leftNormal(direction), sign * distance);
  return add(pointAt(segment, t), fromNib(nib, normal));
}

function ellipseSegment(segment, index, nibAt, forcedLayout, fitOptions) {
  const bend = (side, t) =>
    (side === "left" ? 1 : -1) * nibCurvature(segment, nibAt(t), t);
  const zones = segment.type === "line" ? [] : findZones(bend);
  const result = {
    parts: [{ t0: 0, t1: 1 }],
    layout: {},
    mismatch: false,
    twists: zones.map((zone) => ({
      segmentIndex: index,
      ...zone,
      point: pointAt(
        segment,
        sharpestBend(segment, zone.side, zone.t0, zone.t1, (t) => bend(zone.side, t))
      ),
    })),
  };
  for (const side of ["left", "right"]) {
    let forced = forcedLayout?.[side];
    if (forced && !validBreaks(forced.breaks)) {
      result.mismatch = true;
      forced = undefined;
    }
    const edge = (t) => ellipseEdgePoint(segment, side, nibAt(t), t);
    if (segment.type === "line") {
      if (forced && (forced.line !== true || forced.breaks.length)) {
        result.mismatch = true;
      }
      result.parts[0][side] = [lineEdge(segment, side, nibAt, ellipseSupport)];
      result.layout[side] = { breaks: [], pieces: [1], line: true };
      continue;
    }
    const breaks =
      forced?.breaks ??
      innerBreaks(
        zones
          .filter((zone) => zone.side === side)
          .flatMap((zone) => [
            zone.t0,
            ...evoluteCusps(segment, side, zone.t0, zone.t1, (t) => bend(side, t)),
            zone.t1,
          ])
      );
    // Near a twist, the edge of a thin nib moves fast along the centerline;
    // where the most pieces are not enough, the part is split
    const bounds = [0, ...breaks, 1];
    const pieces = [];
    const counts = [];
    const allBreaks = [];
    for (let i = 0; i < bounds.length - 1; i++) {
      if (i > 0) {
        allBreaks.push(bounds[i]);
      }
      if (forced) {
        const fit = fitCurve(
          edge,
          bounds[i],
          bounds[i + 1],
          forced.pieces?.[i],
          fitOptions
        );
        pieces.push(...fit.pieces);
        counts.push(fit.count);
      } else {
        const fit = fitCurveSplitting(edge, bounds[i], bounds[i + 1], fitOptions);
        pieces.push(...fit.pieces);
        allBreaks.push(...fit.breaks);
        counts.push(...fit.counts);
      }
    }
    result.parts[0][side] = pieces;
    result.layout[side] = { breaks: allBreaks, pieces: counts };
  }
  return result;
}

// --- Lines --------------------------------------------------------------------

/**
 * The edge of a straight segment on one side: the line that touches the nibs
 * at both ends from outside (their common tangent), so that the edges of a
 * straight segment stay straight whatever the nib does along it. With the
 * nibs placed at the ends, the stroke of the segment is the convex hull of
 * the two nibs. Where one nib holds the other (there is no such line), the
 * points of the nibs farthest out along the normal of the segment.
 * @param {(nib: object, direction: object) => object} support the point of a
 *   nib (relative to its center) farthest out in a direction
 */
export function lineEdge(segment, side, nibAt, support) {
  const [p0, p1] = segment.points;
  const tangent = startTangent(segment);
  const sign = side === "left" ? 1 : -1;
  const normal = scale(leftNormal(tangent), sign);
  const nib0 = nibAt(0);
  const nib1 = nibAt(1);
  const along = sub(p1, p0);
  // The directions out of the segment's side: cos(s)·normal + sin(s)·tangent
  const direction = (s) => add(scale(normal, Math.cos(s)), scale(tangent, Math.sin(s)));
  // How far the far nib's support line is beyond the near one's
  const gap = (s) => {
    const n = direction(s);
    return dot(along, n) + dot(support(nib1, n), n) - dot(support(nib0, n), n);
  };
  let n = normal;
  let low = -Math.PI / 2 + 1e-9;
  let high = Math.PI / 2 - 1e-9;
  if (gap(low) < 0 && gap(high) > 0) {
    for (let i = 0; i < 60; i++) {
      const middle = (low + high) / 2;
      if (gap(middle) > 0) {
        high = middle;
      } else {
        low = middle;
      }
    }
    n = direction((low + high) / 2);
  }
  const from = add(p0, support(nib0, n));
  const to = add(p1, support(nib1, n));
  return { type: "line", points: [from, to] };
}

/** The point of an ellipse (relative to its center) farthest out in a direction. */
function ellipseSupport(nib, direction) {
  // M·u, with u the unit vector along Mᵀ·direction
  const x = nib.a * (direction.x * nib.cos + direction.y * nib.sin);
  const y = nib.b * (-direction.x * nib.sin + direction.y * nib.cos);
  const length = Math.hypot(x, y);
  return length > 0 ? fromNib(nib, { x: x / length, y: y / length }) : { x: 0, y: 0 };
}

/** The corner of a rectangle (relative to its center) farthest out in a direction. */
function rectSupport(nib, direction) {
  const along = direction.x * nib.cos + direction.y * nib.sin;
  const across = -direction.x * nib.sin + direction.y * nib.cos;
  return fromNib(nib, {
    x: along < -SAME_SIGN ? -1 : 1,
    y: across < -SAME_SIGN ? -1 : 1,
  });
}

// --- Rectangular nib ----------------------------------------------------------

/**
 * The corner of a rectangular nib farthest out to the left of a direction,
 * in the nib's own coordinates: (±1, ±1). The one farthest out to the right
 * is the opposite corner.
 */
export function rectCorner(nib, tangent) {
  const normal = leftNormal(tangent);
  // The normal along the nib's major and minor axes
  const along = normal.x * nib.cos + normal.y * nib.sin;
  const across = -normal.x * nib.sin + normal.y * nib.cos;
  return { x: along < -SAME_SIGN ? -1 : 1, y: across < -SAME_SIGN ? -1 : 1 };
}

/**
 * Where the corner of a rectangular nib that draws an edge can change: where
 * the centerline runs parallel to a side of the nib.
 */
function rectBreaks(segment, nibAt) {
  const sides = (t) => {
    const nib = nibAt(t);
    const normal = leftNormal(tangentAt(segment, t));
    return {
      along: normal.x * nib.cos + normal.y * nib.sin,
      across: -normal.x * nib.sin + normal.y * nib.cos,
    };
  };
  return innerBreaks([
    ...signChanges((t) => sides(t).along),
    ...signChanges((t) => sides(t).across),
  ]);
}

function rectSegment(segment, index, nibAt, forcedLayout, fitOptions) {
  const result = { parts: [], layout: {}, mismatch: false, twists: [] };
  let forced = forcedLayout;
  if (
    forced &&
    !(
      forced.left &&
      forced.right &&
      validBreaks(forced.left.breaks) &&
      validBreaks(forced.right.breaks)
    )
  ) {
    result.mismatch = true;
    forced = undefined;
  }
  // A line has straight edges (see lineEdge()) and no changes of corner
  const straight = segment.type === "line";
  if (forced) {
    const line = forced.left.line === true && forced.right.line === true;
    if (line !== straight) {
      result.mismatch = true;
    }
  }
  const breaks = straight
    ? []
    : forced
      ? mergeBreaks([...forced.left.breaks, ...forced.right.breaks])
      : rectBreaks(segment, nibAt);
  if (straight && forced && (forced.left.breaks.length || forced.right.breaks.length)) {
    result.mismatch = true;
  }
  const bounds = [0, ...breaks, 1];
  const counts = { left: [], right: [] };
  for (let i = 0; i < bounds.length - 1; i++) {
    const t0 = bounds[i];
    const t1 = bounds[i + 1];
    const middle = (t0 + t1) / 2;
    const corner = rectCorner(nibAt(middle), tangentAt(segment, middle));
    const part = { t0, t1, cut: i > 0 };
    for (const side of ["left", "right"]) {
      const v = side === "left" ? corner : scale(corner, -1);
      const edge = (t) => add(pointAt(segment, t), fromNib(nibAt(t), v));
      if (straight) {
        part[side] = [lineEdge(segment, side, nibAt, rectSupport)];
        counts[side].push(1);
        continue;
      }
      const fit = fitCurve(edge, t0, t1, forced?.[side]?.pieces?.[i], fitOptions);
      part[side] = fit.pieces;
      counts[side].push(fit.count);
    }
    result.parts.push(part);
  }
  for (const side of ["left", "right"]) {
    result.layout[side] = straight
      ? { breaks: [], pieces: counts[side], line: true }
      : { breaks, pieces: counts[side] };
  }
  return result;
}
