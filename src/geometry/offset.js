// The offset ("width") stroke method: the centerline is moved half the width
// to the left and to the right. No Fontra or DOM dependencies; the preview and
// the CLI both use this module.
//
// The width can change along the centerline and differ between the two sides
// (see widths.js); an edge is the centerline moved along its normal by the
// half width of its side at that place. The edges, joins and caps are put
// together into contours by sweep.js.
//
// Twists: where the centerline bends with a radius smaller than half the
// width, an edge at half the width would run backwards between two cusps and
// fold the band over itself, leaving a hole. Each edge is therefore kept no
// farther from the centerline than the radius of the bend towards that side:
// there it follows the centers of curvature (the evolute) instead. Nothing
// is lost: every point within half the width of the centerline lies on the
// normal of its nearest centerline point, at most the radius of the bend
// away from it. Where the stroke twists (see twist.js), the band does not
// fold, so it needs no other shapes.
//
// The layout (see sweep.js): an edge is split where it starts or stops
// following the evolute, and at the cusps of the evolute.

import {
  EPSILON,
  add,
  cross,
  curvatureAt,
  dot,
  leftNormal,
  lerp,
  pointAt,
  scale,
  startTangent,
  sub,
  tangentAt,
} from "./bezier.js";
import { centerlineSegments } from "./centerline.js";
import { fitCurve } from "./fit.js";
import { circleContour, offCurve, onCurve, polygonContour } from "./shapes.js";
import { innerBreaks, sweepContour, validBreaks } from "./sweep.js";
import { evoluteCusps, findTwistZones, sharpestBend } from "./twist.js";
import { pointHalfWidths } from "../stroke-data.js";
import { widthProfile } from "./widths.js";

export { circleContour, signedArea } from "./shapes.js";

/** Largest distance (font units) between a fitted edge and the exact one. */
export const DEFAULT_TOLERANCE = 0.5;
/** Most pieces one part of an edge is fitted with. */
export const MAX_SUBDIVISIONS = 16;

/**
 * Stroke a centerline.
 *
 * @param {{points: object[], isClosed: boolean}} contour unpacked contour; a
 *   closed one is stroked as a loop (the caller decides which closed contours
 *   are centerlines). On-curve points may have
 *   `values`: their own widths, join and miter limit (sanitized, see
 *   stroke-data.js)
 * @param {{width: number, cap: string, join: string, miterLimit: number}} style
 *   the source's values
 * @param {object} [options]
 * @param {number} [options.tolerance] see DEFAULT_TOLERANCE
 * @param {number} [options.maxSubdivisions] see MAX_SUBDIVISIONS
 * @param {object} [options.layout] a layout returned by an earlier call (or
 *   merged from several, see compatible.js) to follow instead of choosing one.
 *   Piece counts left undefined in it are chosen by the tolerance.
 * @returns {{contours: {points: object[], isClosed: true}[], layout: object,
 *   twists: object[], layoutMismatch: boolean}}
 *   contours in the same unpacked form (off-curve points have type "cubic");
 *   the layout used; the twist zones found ({segmentIndex, side, t0, t1,
 *   point}); and whether a given layout could not be followed
 */
export function strokeOffsetContour(contour, style, options = {}) {
  const fitOptions = {
    tolerance: options.tolerance ?? DEFAULT_TOLERANCE,
    maxSubdivisions: options.maxSubdivisions ?? MAX_SUBDIVISIONS,
  };
  const segments = centerlineSegments(contour);
  const profile = widthProfile(contour, segments, style);

  const method = {
    isEmpty: !(profile.max > 0),
    buildSegment(segment, index, forced) {
      const widths = profile.segments[index];
      const built = buildSegment(segment, widths, forced, fitOptions);
      return {
        parts: [{ left: built.left, right: built.right, t0: 0, t1: 1 }],
        layout: built.layout,
        mismatch: built.mismatch,
        twists: built.zones.map((zone) => ({
          segmentIndex: index,
          ...zone,
          point: pointAt(segment, sharpestBend(segment, zone.side, zone.t0, zone.t1)),
        })),
      };
    },
    cornerShape(previous, current) {
      const widths = profile.segments[current.index];
      return joinShape(
        current.segment.points[0],
        previous.endTangent,
        current.startTangent,
        { left: widths.left(0), right: widths.right(0) },
        cornerStyle(contour.points[current.segment.startIndex]?.values, style)
      );
    },
    capShapes(first, last) {
      const firstWidths = profile.segments[first.index];
      const lastWidths = profile.segments[last.index];
      // Looking outwards from the start, its left is the right of the centerline
      return [
        ...capShapes(
          first.segment.points[0],
          scale(first.startTangent, -1),
          { left: firstWidths.right(0), right: firstWidths.left(0) },
          style.cap
        ),
        ...capShapes(
          last.segment.points.at(-1),
          last.endTangent,
          { left: lastWidths.left(1), right: lastWidths.right(1) },
          style.cap
        ),
      ];
    },
    dotShapes(pointIndex) {
      // Without segments, the point's own widths (or the source's)
      const own = pointHalfWidths(contour.points[pointIndex].values);
      const left = own.left ?? style.width / 2;
      const right = own.right ?? style.width / 2;
      const radius = (left + right) / 2;
      return radius > 0 ? dotShapes(contour.points[pointIndex], radius, style.cap) : [];
    },
  };
  return sweepContour(contour, segments, method, options.layout);
}

/** The join and miter limit of a corner: the point's own, or the source's. */
export function cornerStyle(values, style) {
  return {
    join: values?.join ?? style.join,
    miterLimit: values?.miterLimit ?? style.miterLimit,
  };
}

// --- Segments: the two edges ----------------------------------------------------

/**
 * The left and right edges of one segment, as lists of pieces, with the
 * layout used, the twist zones found, and whether a given layout could not be
 * followed.
 * @param {object} widths the half widths along the segment (see widths.js)
 */
function buildSegment(segment, widths, forcedLayout, fitOptions) {
  const zones =
    segment.type === "line"
      ? []
      : findTwistZones(segment, (side, t) => widths[side](t));
  const result = { layout: {}, zones, mismatch: false };
  for (const side of ["left", "right"]) {
    const distance = widths[side];
    let forced = forcedLayout?.[side];
    if (forced && !validBreaks(forced.breaks)) {
      result.mismatch = true;
      forced = undefined;
    }
    if (segment.type === "line") {
      // The width of a line changes evenly along it, so its edges are straight
      if (forced && (forced.line !== true || forced.breaks.length)) {
        result.mismatch = true;
      }
      const sign = side === "left" ? 1 : -1;
      const normal = leftNormal(startTangent(segment));
      result[side] = [
        {
          type: "line",
          points: [
            add(segment.points[0], scale(normal, sign * distance(0))),
            add(segment.points[1], scale(normal, sign * distance(1))),
          ],
        },
      ];
      result.layout[side] = { breaks: [], pieces: [1], line: true };
      continue;
    }
    const breaks =
      forced?.breaks ??
      naturalBreaks(
        segment,
        zones.filter((zone) => zone.side === side)
      );
    const bounds = [0, ...breaks, 1];
    const pieces = [];
    const counts = [];
    const edge = (t) => edgePoint(segment, side, distance, t);
    for (let i = 0; i < bounds.length - 1; i++) {
      const fit = fitCurve(
        edge,
        bounds[i],
        bounds[i + 1],
        forced?.pieces?.[i],
        fitOptions
      );
      pieces.push(...fit.pieces);
      counts.push(fit.count);
    }
    result[side] = pieces;
    result.layout[side] = { breaks, pieces: counts };
  }
  return result;
}

/**
 * Where an edge has to be split: where it starts and stops following the
 * evolute (the ends of the twist zones on its side), and the cusps of the
 * evolute in between.
 */
function naturalBreaks(segment, zones) {
  const breaks = [];
  for (const zone of zones) {
    breaks.push(
      zone.t0,
      ...evoluteCusps(segment, zone.side, zone.t0, zone.t1),
      zone.t1
    );
  }
  return innerBreaks(breaks);
}

/**
 * A point on the edge: half the width from the centerline, but no farther
 * than the radius of the bend towards that side.
 * @param {number | ((t: number) => number)} half the half width of the side,
 *   or a function giving it along the segment
 */
export function edgePoint(segment, side, half, t) {
  const sign = side === "left" ? 1 : -1;
  const bend = sign * curvatureAt(segment, t);
  const d = typeof half === "function" ? half(t) : half;
  const distance = bend * d > 1 ? 1 / bend : d;
  return add(
    pointAt(segment, t),
    scale(leftNormal(tangentAt(segment, t)), sign * distance)
  );
}

// --- Joins and caps -----------------------------------------------------------

/**
 * The shape that fills the outer side of a corner. Every corner gets one, with
 * the same points whatever the angle, so that sources stay compatible: a fan
 * of two quarter-circle-like arcs for round joins, otherwise four points (the
 * corner, the two outer edge ends and the miter tip, which is halfway between
 * the edge ends when the corner is beveled).
 * @param {{x: number, y: number}} point the corner
 * @param {{x: number, y: number}} tangentIn unit tangent arriving at the corner
 * @param {{x: number, y: number}} tangentOut unit tangent leaving the corner
 * @param {number | {left: number, right: number}} half the half widths at the
 *   corner (left and right of the centerline)
 * @param {{join: string, miterLimit: number}} style
 */
export function joinShape(point, tangentIn, tangentOut, half, style) {
  const turnsRight = cross(tangentIn, tangentOut) < 0;
  // The outer side is on the right when turning left, and on the left when
  // turning right.
  const outer = typeof half === "number" ? half : turnsRight ? half.left : half.right;
  const inner = typeof half === "number" ? half : turnsRight ? half.right : half.left;
  const side = turnsRight ? outer : -outer;
  const normalIn = leftNormal(tangentIn);
  const normalOut = leftNormal(tangentOut);
  const a = add(point, scale(normalIn, side));
  const b = add(point, scale(normalOut, side));
  // The shape starts a little inside the corner, where both bands cover it.
  // Starting at the corner itself, its sides would lie exactly on the ends of
  // the bands, and a canvas shows a faint seam along edges that only touch.
  const start = insideCorner(point, normalIn, normalOut, side, inner);
  // Counter-clockwise: from inside the corner to one edge end, around the
  // outside to the other
  const [from, to] = turnsRight ? [b, a] : [a, b];
  if (style.join === "round") {
    const turn = Math.acos(Math.min(1, Math.max(-1, dot(tangentIn, tangentOut))));
    return fanContour(point, start, from, to, turn);
  }
  const cosTurn = dot(tangentIn, tangentOut);
  const tip =
    style.join === "miter" && miterRatio(tangentIn, tangentOut) <= style.miterLimit
      ? add(point, scale(add(normalIn, normalOut), side / (1 + cosTurn)))
      : lerp(a, b, 0.5);
  return polygonContour([start, from, tip, to]);
}

// A point on the inner side of a corner, half the inner width away from it
// along the bisector of the two normals; the corner itself when they cancel
// out (a stroke turning back on itself)
function insideCorner(point, normalIn, normalOut, side, inner) {
  const bisector = add(normalIn, normalOut);
  const length = Math.hypot(bisector.x, bisector.y);
  if (!(length > EPSILON) || !(inner > 0)) {
    return point;
  }
  return add(point, scale(bisector, (-Math.sign(side) * inner) / 2 / length));
}

/**
 * A point near the corner, then an arc around the corner from one point to
 * another, counter-clockwise over the given angle, drawn with two cubics.
 */
function fanContour(center, start, from, to, angle) {
  const middle = add(center, rotate(sub(from, center), angle / 2));
  // Handle length of a cubic arc over half the angle
  const k = (4 / 3) * Math.tan(angle / 8);
  // Counter-clockwise tangent at a point of the arc, as long as the radius
  const tangent = (p) => {
    const r = sub(p, center);
    return { x: -r.y, y: r.x };
  };
  return {
    points: [
      onCurve(start),
      onCurve(from),
      offCurve(add(from, scale(tangent(from), k))),
      offCurve(sub(middle, scale(tangent(middle), k))),
      onCurve(middle),
      offCurve(add(middle, scale(tangent(middle), k))),
      offCurve(sub(to, scale(tangent(to), k))),
      onCurve(to),
    ],
    isClosed: true,
  };
}

function rotate(v, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/**
 * Length of the miter (from the corner point to its tip, doubled) divided by
 * the stroke width, as in SVG: 1 / sin(θ / 2), where θ is the angle between
 * the two lines meeting at the corner.
 */
export function miterRatio(tangentIn, tangentOut) {
  const cosTurn = Math.min(1, Math.max(-1, dot(tangentIn, tangentOut)));
  // θ = π - turn, so sin(θ / 2) = cos(turn / 2) = sqrt((1 + cos(turn)) / 2)
  const sinHalfTheta = Math.sqrt((1 + cosTurn) / 2);
  return sinHalfTheta > EPSILON ? 1 / sinHalfTheta : Infinity;
}

/**
 * The shape added at an end of the centerline.
 * @param {{x: number, y: number}} point the end point
 * @param {{x: number, y: number}} outward unit vector pointing away from the line
 * @param {number | {left: number, right: number}} half the half widths at the
 *   end, left and right as seen looking outwards
 */
export function capShapes(point, outward, half, cap) {
  const left = typeof half === "number" ? half : half.left;
  const right = typeof half === "number" ? half : half.right;
  const normal = leftNormal(outward);
  switch (cap) {
    case "round":
      // Through both edge ends: centered between them
      return [
        circleContour(
          add(point, scale(normal, (left - right) / 2)),
          (left + right) / 2
        ),
      ];
    case "square": {
      const ahead = scale(outward, (left + right) / 2);
      const leftEnd = add(point, scale(normal, left));
      const rightEnd = sub(point, scale(normal, right));
      return [
        polygonContour([rightEnd, add(rightEnd, ahead), add(leftEnd, ahead), leftEnd]),
      ];
    }
    default:
      return [];
  }
}

function dotShapes(point, half, cap) {
  if (cap === "round") {
    return [circleContour(point, half)];
  }
  if (cap === "square") {
    const { x, y } = point;
    return [
      polygonContour([
        { x: x - half, y: y - half },
        { x: x + half, y: y - half },
        { x: x + half, y: y + half },
        { x: x - half, y: y + half },
      ]),
    ];
  }
  return [];
}
