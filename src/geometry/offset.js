// The offset ("width") stroke method: the centerline is moved half the width
// to the left and to the right. No Fontra or DOM dependencies; the preview and
// the CLI both use this module.
//
// The width can change along the centerline and differ between the two sides
// (see widths.js); an edge is the centerline moved along its normal by the
// half width of its side at that place.
//
// The result is a set of closed contours that overlap and are meant to be
// filled together with the nonzero rule:
// - one band per run of segments between two corners (or ends),
// - one shape per corner (the join) and per end (the cap).
// Overlaps are not removed; fontmake / fontra-workflow do that after the CLI.
//
// Every contour is built counter-clockwise (in a y-up coordinate system), so
// that overlapping parts never cancel each other out. The direction comes
// from how a contour is built, not from measuring it, so that it is the same
// in every source of a glyph and the outlines stay compatible.
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
// The layout: per segment and side, the parameters where an edge is split
// (where it starts or stops following the evolute, and the cusps of the
// evolute) and the number of pieces each part is fitted with.
// strokeOffsetContour() returns the layout it used and can be given one.
// Stroking every source of a glyph with the same layout gives outlines with
// the same points, split at the same places (see compatible.js).

import {
  EPSILON,
  add,
  cross,
  curvatureAt,
  dot,
  isDegenerateSegment,
  leftNormal,
  lerp,
  pointAt,
  scale,
  startTangent,
  endTangent,
  sub,
  tangentAt,
} from "./bezier.js";
import { centerlineSegments } from "./centerline.js";
import { hermitePiece } from "./fit.js";
import { evoluteCusps, findTwistZones, sharpestBend } from "./twist.js";
import { widthProfile } from "./widths.js";

/** Largest distance (font units) between a fitted edge and the exact one. */
export const DEFAULT_TOLERANCE = 0.5;
/** Most pieces one part of an edge is fitted with. */
export const MAX_SUBDIVISIONS = 16;

// Handle length of a quarter circle drawn with one cubic, relative to the radius
const KAPPA = 0.5522847498307936;
// Split parameters closer than this are the same
const SAME_PARAMETER = 1e-9;

/**
 * Stroke an open centerline.
 *
 * @param {{points: object[], isClosed: boolean}} contour unpacked contour; closed
 *   contours are not centerlines and give no result. On-curve points may have
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
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const maxSubdivisions = options.maxSubdivisions ?? MAX_SUBDIVISIONS;
  const segments = contour.isClosed ? [] : centerlineSegments(contour);
  const result = {
    contours: [],
    layout: { segments: segments.map(() => null) },
    twists: [],
    layoutMismatch: false,
  };
  if (contour.isClosed) {
    return result;
  }
  const profile = widthProfile(contour, segments, style);
  if (!(profile.max > 0)) {
    return result;
  }
  let forced = options.layout;
  if (forced && forced.segments?.length !== segments.length) {
    result.layoutMismatch = true;
    forced = undefined;
  }

  const usable = [];
  for (const [index, segment] of segments.entries()) {
    if (isDegenerateSegment(segment)) {
      if (forced?.segments[index]) {
        result.layoutMismatch = true;
      }
      continue;
    }
    const built = buildSegment(
      segment,
      profile.segments[index],
      forced?.segments[index],
      {
        tolerance,
        maxSubdivisions,
      }
    );
    if (built.mismatch) {
      result.layoutMismatch = true;
    }
    result.layout.segments[index] = built.layout;
    for (const zone of built.zones) {
      result.twists.push({
        segmentIndex: index,
        ...zone,
        point: pointAt(segment, sharpestBend(segment, zone.side, zone.t0, zone.t1)),
      });
    }
    usable.push({
      index,
      segment,
      widths: profile.segments[index],
      left: built.left,
      right: built.right,
      startTangent: startTangent(segment),
      endTangent: endTangent(segment),
    });
  }

  if (!usable.length) {
    // A lone point (or points on top of each other): a dot, as in SVG
    const pointIndex = contour.points.findIndex((p) => !p.type);
    if (pointIndex >= 0) {
      const widths = profile.atPoint(pointIndex) ?? {
        left: style.width / 2,
        right: style.width / 2,
      };
      result.contours.push(
        ...dotShapes(
          contour.points[pointIndex],
          (widths.left + widths.right) / 2,
          style.cap
        )
      );
    }
    return result;
  }

  // Split into runs at the corners. A smooth point does not make a corner.
  let run = [usable[0]];
  for (let k = 1; k < usable.length; k++) {
    const previous = usable[k - 1];
    const current = usable[k];
    const isAdjacent = current.index === previous.index + 1;
    if (isAdjacent && previous.segment.endSmooth) {
      run.push(current);
      continue;
    }
    result.contours.push(...runContours(run));
    result.contours.push(
      joinShape(
        current.segment.points[0],
        previous.endTangent,
        current.startTangent,
        { left: current.widths.left(0), right: current.widths.right(0) },
        cornerStyle(contour.points[current.segment.startIndex]?.values, style)
      )
    );
    run = [current];
  }
  result.contours.push(...runContours(run));

  const first = usable[0];
  const last = usable.at(-1);
  // Looking outwards from the start, its left is the right of the centerline
  result.contours.push(
    ...capShapes(
      first.segment.points[0],
      scale(first.startTangent, -1),
      { left: first.widths.right(0), right: first.widths.left(0) },
      style.cap
    ),
    ...capShapes(
      last.segment.points.at(-1),
      last.endTangent,
      { left: last.widths.left(1), right: last.widths.right(1) },
      style.cap
    )
  );
  return result;
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
      // A line keeps straight edges while its width does not change. When it
      // changes in any source, all sources fit curves (see compatible.js).
      let straight = forced ? forced.line === true : widths.constant[side];
      if (straight && !widths.constant[side]) {
        result.mismatch = true;
        straight = false;
      }
      if (forced && forced.breaks.length) {
        result.mismatch = true;
        forced = { ...forced, breaks: [] };
      }
      if (straight) {
        const sign = side === "left" ? 1 : -1;
        const normal = leftNormal(startTangent(segment));
        const d = distance(0);
        result[side] = [
          {
            type: "line",
            points: segment.points.map((p) => add(p, scale(normal, sign * d))),
          },
        ];
        result.layout[side] = { breaks: [], pieces: [1], line: true };
        continue;
      }
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
    for (let i = 0; i < bounds.length - 1; i++) {
      const fit = fitEdge(
        segment,
        side,
        distance,
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

function validBreaks(breaks) {
  return (
    Array.isArray(breaks) &&
    breaks.every((t, i) => t >= 0 && t <= 1 && (i === 0 || t >= breaks[i - 1]))
  );
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
  return mergeBreaks(
    breaks.filter((t) => t > SAME_PARAMETER && t < 1 - SAME_PARAMETER)
  );
}

/** Sorted split parameters without (nearly) equal ones. */
export function mergeBreaks(breaks) {
  const sorted = [...breaks].sort((a, b) => a - b);
  return sorted.filter((t, i) => i === 0 || t - sorted[i - 1] > SAME_PARAMETER);
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

/**
 * Fit the edge over [a, b] with cubic pieces; without a given number of
 * pieces, the smallest number that keeps within the tolerance is used.
 */
function fitEdge(
  segment,
  side,
  half,
  a,
  b,
  forcedCount,
  { tolerance, maxSubdivisions }
) {
  if (forcedCount > 0 || !(b > a)) {
    const count = forcedCount > 0 ? Math.round(forcedCount) : 1;
    return { pieces: edgePieces(segment, side, half, a, b, count).pieces, count };
  }
  let result;
  for (let count = 1; count <= maxSubdivisions; count++) {
    const fitted = edgePieces(segment, side, half, a, b, count);
    result = { pieces: fitted.pieces, count };
    if (fitted.error <= tolerance) {
      break;
    }
  }
  return result;
}

function edgePieces(segment, side, half, a, b, count) {
  const edge = (t) => edgePoint(segment, side, half, t);
  const pieces = [];
  let error = 0;
  for (let i = 0; i < count; i++) {
    const ta = a + ((b - a) * i) / count;
    const tb = a + ((b - a) * (i + 1)) / count;
    if (!(tb > ta)) {
      const p = edge(ta);
      pieces.push({ type: "cubic", points: [p, p, p, p] });
      continue;
    }
    const fitted = hermitePiece(edge, ta, tb);
    pieces.push({ type: "cubic", points: fitted.points });
    error = Math.max(error, fitted.error);
  }
  return { pieces, error };
}

// --- Assembling contours ------------------------------------------------------

// The band of a run of segments joined by smooth points
function runContours(run) {
  const right = [];
  const left = [];
  const joints = [];
  for (const [k, item] of run.entries()) {
    if (k > 0) {
      // The band continues from the previous segment through a smooth point
      joints.push({ right: right.length, left: left.length });
    }
    right.push(...item.right.map(copyPiece));
    left.push(...item.left.map(copyPiece));
  }
  return [bandContour(right, left, joints)];
}

// Right edge forwards, then left edge backwards
function bandContour(right, left, joints) {
  // At smooth points the edges of the two segments meet only if the tangents
  // agree exactly; meet halfway so that the band stays closed.
  for (const joint of joints) {
    meetHalfway(right[joint.right - 1], right[joint.right]);
    meetHalfway(left[joint.left - 1], left[joint.left]);
  }
  const points = [onCurve(right[0].points[0])];
  for (const piece of right) {
    appendPiece(points, piece.points);
  }
  points.push(onCurve(left.at(-1).points.at(-1)));
  for (const piece of left.toReversed()) {
    appendPiece(points, piece.points.toReversed());
  }
  // The last point appended is the start of the left edge; the contour closes
  // with a line back to the start of the right edge.
  return { points, isClosed: true };
}

function copyPiece(piece) {
  return { type: piece.type, points: [...piece.points] };
}

function meetHalfway(before, after) {
  const middle = lerp(before.points.at(-1), after.points[0], 0.5);
  before.points[before.points.length - 1] = middle;
  after.points[0] = middle;
}

function appendPiece(points, piecePoints) {
  if (piecePoints.length === 4) {
    points.push(offCurve(piecePoints[1]), offCurve(piecePoints[2]));
  }
  points.push(onCurve(piecePoints.at(-1)));
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
  const side = turnsRight ? outer : -outer;
  const normalIn = leftNormal(tangentIn);
  const normalOut = leftNormal(tangentOut);
  const a = add(point, scale(normalIn, side));
  const b = add(point, scale(normalOut, side));
  // Counter-clockwise: from the corner to one edge end, around the outside to
  // the other
  const [from, to] = turnsRight ? [b, a] : [a, b];
  if (style.join === "round") {
    const turn = Math.acos(Math.min(1, Math.max(-1, dot(tangentIn, tangentOut))));
    return fanContour(point, from, to, turn, outer);
  }
  const cosTurn = dot(tangentIn, tangentOut);
  const tip =
    style.join === "miter" && miterRatio(tangentIn, tangentOut) <= style.miterLimit
      ? add(point, scale(add(normalIn, normalOut), side / (1 + cosTurn)))
      : lerp(a, b, 0.5);
  return polygonContour([point, from, tip, to]);
}

/**
 * The corner, and an arc around it from one point to another,
 * counter-clockwise over the given angle, drawn with two cubics.
 */
function fanContour(center, from, to, angle, radius) {
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
      onCurve(center),
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

/** Four cubic quarter circles, counter-clockwise from the rightmost point. */
export function circleContour(center, radius) {
  const k = radius * KAPPA;
  const { x, y } = center;
  const r = radius;
  return {
    points: [
      onCurve({ x: x + r, y }),
      offCurve({ x: x + r, y: y + k }),
      offCurve({ x: x + k, y: y + r }),
      onCurve({ x, y: y + r }),
      offCurve({ x: x - k, y: y + r }),
      offCurve({ x: x - r, y: y + k }),
      onCurve({ x: x - r, y }),
      offCurve({ x: x - r, y: y - k }),
      offCurve({ x: x - k, y: y - r }),
      onCurve({ x, y: y - r }),
      offCurve({ x: x + k, y: y - r }),
      offCurve({ x: x + r, y: y - k }),
    ],
    isClosed: true,
  };
}

function polygonContour(points) {
  return { points: points.map(onCurve), isClosed: true };
}

function onCurve({ x, y }) {
  return { x, y };
}

function offCurve({ x, y }) {
  return { x, y, type: "cubic" };
}

/**
 * Signed area of a closed contour made of lines and cubic curves (positive
 * when counter-clockwise in a y-up coordinate system). Curves are flattened,
 * which is precise enough to tell the direction.
 */
export function signedArea(contour) {
  const polygon = [];
  const points = contour.points;
  const start = points.findIndex((p) => !p.type);
  if (start < 0) {
    return 0;
  }
  const numPoints = points.length;
  let current = points[start];
  let controls = [];
  for (let step = 1; step <= numPoints; step++) {
    const point = points[(start + step) % numPoints];
    if (point.type) {
      controls.push(point);
      continue;
    }
    if (controls.length === 2) {
      const curve = { type: "cubic", points: [current, ...controls, point] };
      for (let i = 1; i < 8; i++) {
        polygon.push(pointAt(curve, i / 8));
      }
    }
    polygon.push(point);
    current = point;
    controls = [];
  }
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    area += cross(polygon[i], polygon[(i + 1) % polygon.length]);
  }
  return area / 2;
}
