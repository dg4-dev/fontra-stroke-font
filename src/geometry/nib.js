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
  leftNormal,
  normalize,
  pointAt,
  scale,
  secondDerivativeAt,
  sub,
  tangentAt,
} from "./bezier.js";
import { centerlineSegments } from "./centerline.js";
import { fitCurve, fitCurveSplitting } from "./fit.js";
import { DEFAULT_TOLERANCE, MAX_SUBDIVISIONS } from "./offset.js";
import { circleContour, polygonContour } from "./shapes.js";
import { innerBreaks, mergeBreaks, sweepContour, validBreaks } from "./sweep.js";
import { evoluteCusps, findZones, sharpestBend, signChanges } from "./twist.js";
import { valueProfile } from "./widths.js";

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
  const profile = valueProfile(contour, segments, {
    keys: ["major", "minor", "angle"],
    defaults: { major: style.major, minor: style.minor, angle: style.angle },
    periods: { angle: 180 },
  });
  const isRect = style.shape === "rect";
  const minAxis = isRect ? 0 : MIN_ELLIPSE_AXIS;
  const nibAt = (index, t) => {
    const numbers = profile.segments[index];
    return makeNib(numbers.major(t), numbers.minor(t), numbers.angle(t), minAxis);
  };
  const isConstant = (index) => {
    const { constant } = profile.segments[index];
    return constant.major && constant.minor && constant.angle;
  };
  const shapeAt = (point, nib) =>
    isRect ? rectContour(point, nib) : ellipseContour(point, nib);

  const method = {
    isEmpty: !(profile.max.major > 0 || profile.max.minor > 0),
    cutsAtSmoothPoints: isRect,
    buildSegment(segment, index, forced) {
      const nib = (t) => nibAt(index, t);
      return isRect
        ? rectSegment(segment, index, nib, isConstant(index), forced, fitOptions)
        : ellipseSegment(segment, index, nib, isConstant(index), forced, fitOptions);
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

function ellipseSegment(segment, index, nibAt, constant, forcedLayout, fitOptions) {
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
      // A line keeps straight edges while its nib does not change
      let straight = forced ? forced.line === true : constant;
      if (straight && !constant) {
        result.mismatch = true;
        straight = false;
      }
      if (forced && forced.breaks.length) {
        result.mismatch = true;
        forced = { ...forced, breaks: [] };
      }
      if (straight) {
        const offset = sub(edge(0), segment.points[0]);
        result.parts[0][side] = [
          { type: "line", points: segment.points.map((p) => add(p, offset)) },
        ];
        result.layout[side] = { breaks: [], pieces: [1], line: true };
        continue;
      }
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

function rectSegment(segment, index, nibAt, constant, forcedLayout, fitOptions) {
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
  // A line with an unchanging nib has straight edges and no changes of corner
  let straight = segment.type === "line" && constant;
  if (forced) {
    const line = forced.left.line === true && forced.right.line === true;
    if (line && !straight) {
      result.mismatch = true;
    }
    straight = line && straight;
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
        const offset = fromNib(nibAt(0), v);
        part[side] = [
          { type: "line", points: segment.points.map((p) => add(p, offset)) },
        ];
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
