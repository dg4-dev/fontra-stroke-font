// The offset ("width") stroke method: the centerline is moved half the width
// to the left and to the right. No Fontra or DOM dependencies; the preview and
// the CLI both use this module.
//
// The result is a set of closed contours that overlap and are meant to be
// filled together with the nonzero rule:
// - one band per run of segments between two corners (or ends),
// - one shape per corner (the join) and per end (the cap).
// Overlaps are not removed; fontmake / fontra-workflow do that after the CLI.
// All contours are counter-clockwise (in a y-up coordinate system), so that
// overlapping parts never cancel each other out.

import {
  EPSILON,
  add,
  cross,
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
import { fitCubic } from "./fit.js";

/** Largest distance (font units) between a fitted edge and the exact one. */
export const DEFAULT_TOLERANCE = 0.5;
/** Most pieces a centerline segment's edge is split into. */
export const MAX_SUBDIVISIONS = 16;

const SAMPLES_PER_PIECE = 8;
// Handle length of a quarter circle drawn with one cubic, relative to the radius
const KAPPA = 0.5522847498307936;

/**
 * Stroke an open centerline with a constant width.
 *
 * @param {{points: object[], isClosed: boolean}} contour unpacked contour; closed
 *   contours are not centerlines and give no result
 * @param {{width: number, cap: string, join: string, miterLimit: number}} style
 * @param {object} [options]
 * @param {number} [options.tolerance] see DEFAULT_TOLERANCE
 * @param {number} [options.maxSubdivisions] see MAX_SUBDIVISIONS
 * @param {number[]} [options.subdivisions] number of pieces per segment of
 *   centerlineSegments(contour), used instead of the tolerance. Pass the
 *   largest numbers of all sources of a glyph to get compatible outlines.
 * @returns {{contours: {points: object[], isClosed: true}[], subdivisions: number[]}}
 *   contours in the same unpacked form (off-curve points have type "cubic"),
 *   and the number of pieces used for each segment (0 for zero-length ones)
 */
export function strokeOffsetContour(contour, style, options = {}) {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const maxSubdivisions = options.maxSubdivisions ?? MAX_SUBDIVISIONS;
  const segments = contour.isClosed ? [] : centerlineSegments(contour);
  const subdivisions = segments.map(() => 0);
  const contours = [];
  const half = style.width / 2;
  if (contour.isClosed || !(half > 0)) {
    return { contours, subdivisions };
  }

  const usable = [];
  for (const [index, segment] of segments.entries()) {
    if (!isDegenerateSegment(segment)) {
      usable.push({
        index,
        segment,
        startTangent: startTangent(segment),
        endTangent: endTangent(segment),
      });
    }
  }

  if (!usable.length) {
    // A lone point (or points on top of each other): a dot, as in SVG
    const point = contour.points.find((p) => !p.type);
    if (point) {
      contours.push(...dotShapes(point, half, style.cap));
    }
    return { contours: contours.map(orientCounterClockwise), subdivisions };
  }

  for (const item of usable) {
    const edges = offsetSegment(
      item.segment,
      half,
      options.subdivisions?.[item.index],
      tolerance,
      maxSubdivisions
    );
    item.left = edges.left;
    item.right = edges.right;
    subdivisions[item.index] = edges.subdivisions;
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
    contours.push(bandContour(run));
    contours.push(
      ...joinShapes(
        current.segment.points[0],
        previous.endTangent,
        current.startTangent,
        half,
        style
      )
    );
    run = [current];
  }
  contours.push(bandContour(run));

  const first = usable[0];
  const last = usable.at(-1);
  contours.push(
    ...capShapes(
      first.segment.points[0],
      scale(first.startTangent, -1),
      half,
      style.cap
    ),
    ...capShapes(last.segment.points.at(-1), last.endTangent, half, style.cap)
  );

  return { contours: contours.map(orientCounterClockwise), subdivisions };
}

/**
 * The left and right edges of one segment, as lists of pieces
 * ({type: "line"|"cubic", points}). Without a given number of pieces, the
 * smallest number that keeps both edges within the tolerance is used.
 */
export function offsetSegment(segment, half, subdivisions, tolerance, maxSubdivisions) {
  if (segment.type === "line") {
    const normal = leftNormal(startTangent(segment));
    const edge = (d) => [
      { type: "line", points: segment.points.map((p) => add(p, scale(normal, d))) },
    ];
    return { left: edge(half), right: edge(-half), subdivisions: 1 };
  }
  if (subdivisions > 0) {
    const n = Math.round(subdivisions);
    return {
      left: offsetPieces(segment, half, n).pieces,
      right: offsetPieces(segment, -half, n).pieces,
      subdivisions: n,
    };
  }
  let result;
  for (let n = 1; n <= maxSubdivisions; n++) {
    const left = offsetPieces(segment, half, n);
    const right = offsetPieces(segment, -half, n);
    result = { left: left.pieces, right: right.pieces, subdivisions: n };
    if (Math.max(left.error, right.error) <= tolerance) {
      break;
    }
  }
  return result;
}

function offsetPieces(segment, d, n) {
  const pieces = [];
  let error = 0;
  for (let i = 0; i < n; i++) {
    const ta = i / n;
    const tb = (i + 1) / n;
    const samples = [];
    for (let j = 1; j < SAMPLES_PER_PIECE; j++) {
      const u = j / SAMPLES_PER_PIECE;
      samples.push({ u, ...offsetPoint(segment, ta + (tb - ta) * u, d) });
    }
    const fitted = fitCubic(
      offsetPoint(segment, ta, d),
      tangentAt(segment, ta),
      offsetPoint(segment, tb, d),
      tangentAt(segment, tb),
      samples
    );
    pieces.push({ type: "cubic", points: fitted.points });
    error = Math.max(error, fitted.error);
  }
  return { pieces, error };
}

function offsetPoint(segment, t, d) {
  return add(pointAt(segment, t), scale(leftNormal(tangentAt(segment, t)), d));
}

// Right edge forwards, then left edge backwards
function bandContour(run) {
  const right = run.flatMap((item) => item.right.map(copyPiece));
  const left = run.flatMap((item) => item.left.map(copyPiece));
  // At smooth points the edges of the two segments meet only if the tangents
  // agree exactly; meet halfway so that the band stays closed.
  let index = 0;
  for (const item of run.slice(0, -1)) {
    index += item.right.length;
    meetHalfway(right[index - 1], right[index]);
    meetHalfway(left[index - 1], left[index]);
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

/**
 * The shape that fills the outer side of a corner.
 * @param {{x: number, y: number}} point the corner
 * @param {{x: number, y: number}} tangentIn unit tangent arriving at the corner
 * @param {{x: number, y: number}} tangentOut unit tangent leaving the corner
 */
export function joinShapes(point, tangentIn, tangentOut, half, style) {
  const turn = cross(tangentIn, tangentOut);
  const cosTurn = dot(tangentIn, tangentOut);
  if (Math.abs(turn) < EPSILON) {
    // Straight on: nothing to fill. Turning back: the two bands end on the
    // same line, so there is no gap either (except for a round join).
    return cosTurn < 0 && style.join === "round" ? [circleContour(point, half)] : [];
  }
  if (style.join === "round") {
    return [circleContour(point, half)];
  }
  // The outer side is on the right when turning left, and on the left when
  // turning right.
  const side = turn > 0 ? -half : half;
  const normalIn = leftNormal(tangentIn);
  const normalOut = leftNormal(tangentOut);
  const a = add(point, scale(normalIn, side));
  const b = add(point, scale(normalOut, side));
  if (style.join === "miter" && miterRatio(tangentIn, tangentOut) <= style.miterLimit) {
    const tip = add(point, scale(add(normalIn, normalOut), side / (1 + cosTurn)));
    return [polygonContour([point, a, tip, b])];
  }
  return [polygonContour([point, a, b])];
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
 */
export function capShapes(point, outward, half, cap) {
  switch (cap) {
    case "round":
      return [circleContour(point, half)];
    case "square": {
      const normal = scale(leftNormal(outward), half);
      const ahead = scale(outward, half);
      return [
        polygonContour([
          add(point, normal),
          add(add(point, normal), ahead),
          add(sub(point, normal), ahead),
          sub(point, normal),
        ]),
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

function orientCounterClockwise(contour) {
  if (signedArea(contour) >= 0) {
    return contour;
  }
  const [first, ...rest] = contour.points;
  return { ...contour, points: [first, ...rest.toReversed()] };
}
