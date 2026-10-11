// The offset ("width") stroke method: the centerline is moved half the width
// to the left and to the right. No Fontra or DOM dependencies; the preview and
// the CLI both use this module.
//
// The result is a set of closed contours that overlap and are meant to be
// filled together with the nonzero rule:
// - one band per run of segments between two corners, ends or twist zones,
// - two shapes per part of a twist zone (see below),
// - one shape per corner (the join) and per end (the cap).
// Overlaps are not removed; fontmake / fontra-workflow do that after the CLI.
//
// Every contour is built counter-clockwise (in a y-up coordinate system), so
// that overlapping parts never cancel each other out. The direction comes
// from how a contour is built, not from measuring it, so that it is the same
// in every source of a glyph and the outlines stay compatible.
//
// Twist zones: where the centerline bends with a radius smaller than half the
// width, the inner edge runs backwards between two cusps. A band there would
// fold over itself and leave a hole, so each zone (split into parts that turn
// by less than 90°) is filled with two simple shapes that meet at X, where the
// normals at both ends of the part cross:
// - the outer lobe: the outer edge and the two normals down to X,
// - the inner lobe: X and the backwards-running inner edge.
//
// The layout: the number of pieces each edge is fitted with, and the zones
// with their parts, per segment. strokeOffsetContour() returns the layout it
// used and can be given one. Stroking every source of a glyph with the same
// layout gives outlines with the same points (see compatible.js).

import {
  EPSILON,
  add,
  cross,
  dot,
  isDegenerateSegment,
  leftNormal,
  lerp,
  lineIntersection,
  pointAt,
  scale,
  startTangent,
  endTangent,
  sub,
  tangentAt,
} from "./bezier.js";
import { centerlineSegments } from "./centerline.js";
import { fitCubic } from "./fit.js";
import { findTwistZones, sharpestBend, splitByTurning, turning } from "./twist.js";

/** Largest distance (font units) between a fitted edge and the exact one. */
export const DEFAULT_TOLERANCE = 0.5;
/** Most pieces an edge is split into within one span. */
export const MAX_SUBDIVISIONS = 16;

const SAMPLES_PER_PIECE = 8;
// Handle length of a quarter circle drawn with one cubic, relative to the radius
const KAPPA = 0.5522847498307936;
// The parts of a twist zone turn by less than this, so that the normals at
// both ends of a part cross on the inner side
const MAX_PART_TURNING = Math.PI / 2;

/**
 * Stroke an open centerline with a constant width.
 *
 * @param {{points: object[], isClosed: boolean}} contour unpacked contour; closed
 *   contours are not centerlines and give no result
 * @param {{width: number, cap: string, join: string, miterLimit: number}} style
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
  const half = style.width / 2;
  if (contour.isClosed || !(half > 0)) {
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
    const built = buildSegment(segment, half, forced?.segments[index], {
      tolerance,
      maxSubdivisions,
    });
    if (built.mismatch) {
      result.layoutMismatch = true;
    }
    result.layout.segments[index] = built.layout;
    for (const span of built.spans) {
      if (span.kind === "zone" && !span.degenerate) {
        result.twists.push({
          segmentIndex: index,
          side: span.side,
          t0: span.t0,
          t1: span.t1,
          point: pointAt(segment, sharpestBend(segment, span.side, span.t0, span.t1)),
        });
      }
    }
    usable.push({
      index,
      segment,
      spans: built.spans,
      startTangent: startTangent(segment),
      endTangent: endTangent(segment),
    });
  }

  if (!usable.length) {
    // A lone point (or points on top of each other): a dot, as in SVG
    const point = contour.points.find((p) => !p.type);
    if (point) {
      result.contours.push(...dotShapes(point, half, style.cap));
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
        half,
        style
      )
    );
    run = [current];
  }
  result.contours.push(...runContours(run));

  const first = usable[0];
  const last = usable.at(-1);
  result.contours.push(
    ...capShapes(
      first.segment.points[0],
      scale(first.startTangent, -1),
      half,
      style.cap
    ),
    ...capShapes(last.segment.points.at(-1), last.endTangent, half, style.cap)
  );
  return result;
}

// --- Segments: band spans and twist zones -------------------------------------

/**
 * The spans of one segment: band, zone, band, ..., band. Returns the spans
 * with their fitted edges, the layout used, and whether the forced layout
 * could not be followed.
 */
function buildSegment(segment, half, forcedLayout, fitOptions) {
  let mismatch = false;
  let forcedSpans = forcedLayout?.spans;
  let zones = findTwistZones(segment, half);
  if (forcedSpans) {
    const forcedSides = forcedSpans
      .filter((span) => span.kind === "zone")
      .map((span) => span.side);
    const aligned = alignZones(segment, zones, forcedSides);
    if (aligned) {
      zones = aligned;
    } else {
      mismatch = true;
      forcedSpans = undefined;
    }
  }
  const forcedBands = forcedSpans?.filter((span) => span.kind === "band") ?? [];
  const forcedZones = forcedSpans?.filter((span) => span.kind === "zone") ?? [];

  const spans = [];
  const layoutSpans = [];
  let cursor = 0;
  for (let j = 0; j <= zones.length; j++) {
    const end = j < zones.length ? zones[j].t0 : 1;
    const band = bandSpan(
      segment,
      half,
      cursor,
      end,
      forcedBands[j]?.pieces,
      fitOptions
    );
    spans.push(band.span);
    layoutSpans.push({ kind: "band", pieces: band.pieces });
    if (j === zones.length) {
      break;
    }
    const zone = zones[j];
    const forcedParts = forcedZones[j]?.parts;
    const numParts =
      forcedParts?.length ??
      Math.max(1, Math.ceil(turning(segment, zone.t0, zone.t1) / MAX_PART_TURNING));
    const bounds = splitByTurning(segment, zone.t0, zone.t1, numParts);
    const parts = [];
    const layoutParts = [];
    for (let p = 0; p < numParts; p++) {
      const part = zonePart(
        segment,
        half,
        zone.side,
        bounds[p],
        bounds[p + 1],
        forcedParts?.[p],
        fitOptions
      );
      parts.push(part.part);
      layoutParts.push(part.layout);
    }
    spans.push({
      kind: "zone",
      side: zone.side,
      t0: zone.t0,
      t1: zone.t1,
      degenerate: !!zone.degenerate,
      parts,
    });
    layoutSpans.push({ kind: "zone", side: zone.side, parts: layoutParts });
    cursor = zone.t1;
  }
  return { spans, layout: { spans: layoutSpans }, mismatch };
}

/**
 * Match the zones found to the sides a layout asks for, in order. Where the
 * layout has a zone this source does not (it bends less here), an empty zone
 * is placed where the segment bends most to that side, so that the outlines
 * keep the same points. Returns null when the zones found do not fit.
 */
function alignZones(segment, zones, sides) {
  const result = [];
  let next = 0;
  for (const side of sides) {
    if (next < zones.length && zones[next].side === side) {
      result.push(zones[next++]);
      continue;
    }
    const lo = result.length ? result.at(-1).t1 : 0;
    const hi = next < zones.length ? zones[next].t0 : 1;
    const t = sharpestBend(segment, side, lo, hi);
    result.push({ side, t0: t, t1: t, degenerate: true });
  }
  return next === zones.length ? result : null;
}

function bandSpan(segment, half, a, b, forcedPieces, fitOptions) {
  if (segment.type === "line") {
    const normal = leftNormal(startTangent(segment));
    const edge = (d) => [
      {
        type: "line",
        points: [pointAt(segment, a), pointAt(segment, b)].map((p) =>
          add(p, scale(normal, d))
        ),
      },
    ];
    return { span: { kind: "band", left: edge(half), right: edge(-half) }, pieces: 1 };
  }
  const fit = fitEdges(
    [
      { d: half, sign: 1 },
      { d: -half, sign: 1 },
    ],
    segment,
    a,
    b,
    forcedPieces,
    fitOptions
  );
  return {
    span: { kind: "band", left: fit.edges[0], right: fit.edges[1] },
    pieces: fit.pieces,
  };
}

function zonePart(segment, half, side, a, b, forcedPart, fitOptions) {
  const inner = side === "left" ? half : -half;
  // The outer edge runs forwards; the inner edge runs backwards in a zone.
  const outerFit = fitEdges(
    [{ d: -inner, sign: 1 }],
    segment,
    a,
    b,
    forcedPart?.outer,
    fitOptions
  );
  const innerFit = fitEdges(
    [{ d: inner, sign: -1 }],
    segment,
    a,
    b,
    forcedPart?.inner,
    fitOptions
  );
  const startPoint = pointAt(segment, a);
  const crossing =
    b > a
      ? lineIntersection(
          startPoint,
          leftNormal(tangentAt(segment, a)),
          pointAt(segment, b),
          leftNormal(tangentAt(segment, b))
        )
      : null;
  return {
    part: {
      side,
      outer: outerFit.edges[0],
      inner: innerFit.edges[0],
      crossing: crossing ?? startPoint,
    },
    layout: { outer: outerFit.pieces, inner: innerFit.pieces },
  };
}

/**
 * Fit edges of a cubic segment over [a, b] with the same number of pieces.
 * Each edge is { d, sign }: the signed distance from the centerline (left is
 * positive) and the direction it runs in (-1 inside a twist zone).
 */
function fitEdges(edges, segment, a, b, forcedPieces, { tolerance, maxSubdivisions }) {
  if (forcedPieces > 0 || !(b > a)) {
    const n = forcedPieces > 0 ? Math.round(forcedPieces) : 1;
    return {
      edges: edges.map(({ d, sign }) => edgePieces(segment, d, sign, a, b, n).pieces),
      pieces: n,
    };
  }
  let result;
  for (let n = 1; n <= maxSubdivisions; n++) {
    const fitted = edges.map(({ d, sign }) => edgePieces(segment, d, sign, a, b, n));
    result = { edges: fitted.map((edge) => edge.pieces), pieces: n };
    if (fitted.every((edge) => edge.error <= tolerance)) {
      break;
    }
  }
  return result;
}

function edgePieces(segment, d, sign, a, b, n) {
  const pieces = [];
  let error = 0;
  for (let i = 0; i < n; i++) {
    const ta = a + ((b - a) * i) / n;
    const tb = a + ((b - a) * (i + 1)) / n;
    const p0 = offsetPoint(segment, ta, d);
    const p3 = offsetPoint(segment, tb, d);
    if (!(tb > ta)) {
      pieces.push({ type: "cubic", points: [p0, p0, p3, p3] });
      continue;
    }
    const samples = [];
    for (let j = 1; j < SAMPLES_PER_PIECE; j++) {
      const u = j / SAMPLES_PER_PIECE;
      samples.push({ u, ...offsetPoint(segment, ta + (tb - ta) * u, d) });
    }
    const fitted = fitCubic(
      p0,
      scale(tangentAt(segment, ta), sign),
      p3,
      scale(tangentAt(segment, tb), sign),
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

// --- Assembling contours ------------------------------------------------------

// The bands and zone shapes of a run of segments joined by smooth points
function runContours(run) {
  const contours = [];
  let band = newBand();
  for (const [k, item] of run.entries()) {
    for (const [s, span] of item.spans.entries()) {
      if (span.kind === "band") {
        if (s === 0 && k > 0) {
          // The band continues from the previous segment through a smooth point
          band.joints.push(band.right.length);
        }
        band.right.push(...span.right.map(copyPiece));
        band.left.push(...span.left.map(copyPiece));
        continue;
      }
      contours.push(bandContour(band));
      band = newBand();
      for (const part of span.parts) {
        contours.push(...zoneContours(part));
      }
    }
  }
  contours.push(bandContour(band));
  return contours;
}

function newBand() {
  return { right: [], left: [], joints: [] };
}

// Right edge forwards, then left edge backwards
function bandContour({ right, left, joints }) {
  // At smooth points the edges of the two segments meet only if the tangents
  // agree exactly; meet halfway so that the band stays closed.
  for (const index of joints) {
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

// The outer and inner lobes of one part of a twist zone, both counter-clockwise
function zoneContours({ side, outer, inner, crossing }) {
  const x = onCurve(crossing);
  if (side === "left") {
    // Outer edge on the right: forwards, then X
    const outerLobe = [onCurve(outer[0].points[0])];
    for (const piece of outer) {
      appendPiece(outerLobe, piece.points);
    }
    outerLobe.push(x);
    // X, then the inner (left) edge in the direction of the centerline
    const innerLobe = [x, onCurve(inner[0].points[0])];
    for (const piece of inner) {
      appendPiece(innerLobe, piece.points);
    }
    return [
      { points: outerLobe, isClosed: true },
      { points: innerLobe, isClosed: true },
    ];
  }
  // Outer edge on the left: X, then the outer edge backwards
  const outerLobe = [x, onCurve(outer.at(-1).points.at(-1))];
  for (const piece of outer.toReversed()) {
    appendPiece(outerLobe, piece.points.toReversed());
  }
  // The inner (right) edge against the direction of the centerline, then X
  const innerLobe = [onCurve(inner.at(-1).points.at(-1))];
  for (const piece of inner.toReversed()) {
    appendPiece(innerLobe, piece.points.toReversed());
  }
  innerLobe.push(x);
  return [
    { points: outerLobe, isClosed: true },
    { points: innerLobe, isClosed: true },
  ];
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
 * the same points whatever the angle, so that sources stay compatible: a
 * circle for round joins, otherwise four points (the corner, the two outer
 * edge ends and the miter tip, which is halfway between the edge ends when
 * the corner is beveled).
 * @param {{x: number, y: number}} point the corner
 * @param {{x: number, y: number}} tangentIn unit tangent arriving at the corner
 * @param {{x: number, y: number}} tangentOut unit tangent leaving the corner
 */
export function joinShape(point, tangentIn, tangentOut, half, style) {
  if (style.join === "round") {
    return circleContour(point, half);
  }
  const turnsRight = cross(tangentIn, tangentOut) < 0;
  // The outer side is on the right when turning left, and on the left when
  // turning right.
  const side = turnsRight ? half : -half;
  const normalIn = leftNormal(tangentIn);
  const normalOut = leftNormal(tangentOut);
  const a = add(point, scale(normalIn, side));
  const b = add(point, scale(normalOut, side));
  const cosTurn = dot(tangentIn, tangentOut);
  const tip =
    style.join === "miter" && miterRatio(tangentIn, tangentOut) <= style.miterLimit
      ? add(point, scale(add(normalIn, normalOut), side / (1 + cosTurn)))
      : lerp(a, b, 0.5);
  return polygonContour(turnsRight ? [point, b, tip, a] : [point, a, tip, b]);
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
          sub(point, normal),
          add(sub(point, normal), ahead),
          add(add(point, normal), ahead),
          add(point, normal),
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
