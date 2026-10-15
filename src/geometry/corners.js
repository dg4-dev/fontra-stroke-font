// Live corners: the corners of a centerline are rounded before it is
// stroked, without changing the centerline itself, so the radius can be
// changed at any time. No Fontra or DOM dependencies; both stroke methods use
// it (see stroke.js).
//
// A corner (an on-curve point that is not smooth, with a segment on each
// side) whose values have a cornerRadius gets an arc of that radius that
// touches the segments on both sides. They are cut where the arc touches
// them: for two lines meeting at a turn of φ, r · tan(φ / 2) from the corner
// (r / tan(θ / 2), with θ = π − φ the angle between the lines); along a
// curve, the place is found numerically (where the curves moved r towards
// the inside of the corner cross: the arc's center). The arc is drawn with
// two cubics, each over half the turn, through three new smooth on-curve
// points: where it starts, its middle and where it ends. They take the
// corner point's values, so the width or the nib there stays the point's.
//
// Where the cuts do not fit on the segments, the radius is made smaller until
// they do, and the corner is reported. A segment between two rounded corners
// is shared: the corner that needs less of it keeps what it needs, and the
// other gets the rest (each at least half). Every segment keeps MIN_CUT of
// its length, so that it never vanishes.
//
// A radius of 0 (in values handed to the stroke methods: stored values of 0
// count as none, see stroke-data.js) is for a corner rounded in another
// source of the glyph, so that the rounded centerlines of all sources have
// the same points (see matchRoundedCorners()). Its arc is cut MIN_CUT from
// the corner so that it has a length; stroked, its outer side is round, as
// the stroke of a point turning round would be.

import {
  EPSILON,
  add,
  cross,
  distance,
  dot,
  endTangent,
  isDegenerateSegment,
  leftNormal,
  lerp,
  normalize,
  pointAt,
  scale,
  startTangent,
  sub,
  tangentAt,
} from "./bezier.js";
import { centerlineSegments } from "./centerline.js";
import { offCurve } from "./shapes.js";
import { segmentLength } from "./widths.js";

/**
 * How far (font units) a corner of radius 0 is cut from its point, so that
 * its arc has a length; also the length every cut segment keeps.
 */
export const MIN_CUT = 0.01;

// Turns (radians) closer than this to a half turn are not rounded: the two
// segments run back along each other, and no arc touches both
const MAX_TURN = Math.PI - 1e-6;
// Turns (radians) smaller than this are straight
const MIN_TURN = 1e-9;
// Steps of the bisection that makes a radius smaller
const SHRINK_STEPS = 40;

/**
 * The centerline with its corners rounded.
 * @param {{points: object[], isClosed: boolean}} contour unpacked contour;
 *   on-curve points may have `values` with a cornerRadius
 * @returns {{contour: object, corners: {pointIndex: number, point: object,
 *   wanted: number, radius: number, shrunk: boolean}[],
 *   pointIndices: (number|undefined)[]|undefined}} the rounded contour (the
 *   same object when no corner is rounded); the rounded corners, with the
 *   radius asked for and the one used; for each point of the rounded
 *   contour, the index of the point of the contour it comes from (undefined
 *   for off-curve points and implied on-curve points), when it was rounded.
 *   The points of an arc are smooth and have cornerArc "start", "middle" or
 *   "end"; on-curve points implied by quadratic segments are written out,
 *   with implied: true (see centerlineSegments()).
 */
export function roundCorners(contour) {
  const segments = centerlineSegments(contour);
  const corners = findCorners(contour, segments);
  if (!corners.length) {
    return { contour, corners: [], pointIndices: undefined };
  }
  const lengths = segments.map((segment) => segmentLength(segment));
  for (const corner of corners) {
    const touch = touchAt(corner, segments, lengths, corner.wanted);
    corner.want = touch
      ? { in: touch.cutIn, out: touch.cutOut }
      : { in: Infinity, out: Infinity };
  }
  // What each segment allows at its start and at its end
  const atStart = new Map(corners.map((corner) => [corner.after, corner]));
  const atEnd = new Map(corners.map((corner) => [corner.before, corner]));
  const allowed = lengths.map((measure, index) =>
    share(
      atStart.get(index)?.want.out ?? 0,
      atEnd.get(index)?.want.in ?? 0,
      Math.max(0, measure.length - MIN_CUT)
    )
  );
  for (const corner of corners) {
    const radius = fitRadius(
      corner,
      segments,
      lengths,
      allowed[corner.before].end,
      allowed[corner.after].start
    );
    corner.radius = radius;
    corner.arc = arcAt(corner, segments, lengths, radius);
  }
  return {
    ...rebuild(contour, segments, corners),
    corners: corners.map((corner) => ({
      pointIndex: corner.pointIndex,
      point: { x: corner.point.x, y: corner.point.y },
      wanted: corner.wanted,
      radius: corner.radius,
      shrunk: corner.radius < corner.wanted - 1e-9,
    })),
  };
}

/**
 * The contours of the same centerline in several sources, with a
 * cornerRadius of 0 on the points that have none where a point with the
 * same index has one larger than 0 in another source: rounded in some
 * sources, a corner gets an arc in all of them, so that the rounded
 * centerlines have the same points. Contours with different numbers of
 * points are returned as they are.
 * @param {{points: object[], isClosed: boolean}[]} contours
 */
export function matchRoundedCorners(contours) {
  const count = contours[0]?.points.length;
  if (contours.some((contour) => contour.points.length !== count)) {
    return contours;
  }
  const rounded = new Set();
  for (const contour of contours) {
    for (const [index, point] of contour.points.entries()) {
      if (point.values?.cornerRadius > 0) {
        rounded.add(index);
      }
    }
  }
  if (!rounded.size) {
    return contours;
  }
  return contours.map((contour) => {
    if (
      [...rounded].every((index) => contour.points[index].values?.cornerRadius >= 0)
    ) {
      return contour;
    }
    return {
      ...contour,
      points: contour.points.map((point, index) =>
        rounded.has(index) && !(point.values?.cornerRadius >= 0)
          ? { ...point, values: { ...point.values, cornerRadius: 0 } }
          : point
      ),
    };
  });
}

/** Whether a segment of a rounded centerline (see roundCorners()) is an arc. */
export function isCornerArc(contour, segment) {
  const part = contour.points[segment.startIndex]?.cornerArc;
  return part === "start" || part === "middle";
}

// --- Finding the corners ------------------------------------------------------

/**
 * The corners of a centerline that can be rounded: on-curve points that are
 * not smooth, with a segment of some length on each side that does not run
 * straight back.
 * @param {{points: object[], isClosed: boolean}} contour unpacked contour
 * @param {object[]} [segments] centerlineSegments(contour)
 * @returns {{pointIndex: number, before: number, after: number,
 *   point: object, tangentIn: object, tangentOut: object, turn: number,
 *   sign: number}[]} the indices of the segments arriving and leaving, the
 *   directions there, how far the centerline turns (radians, 0 straight on)
 *   and which way (1 to the left, −1 to the right)
 */
export function centerlineCorners(contour, segments = centerlineSegments(contour)) {
  const corners = [];
  const count = segments.length;
  for (let before = 0; before < count; before++) {
    const after = before + 1 < count ? before + 1 : contour.isClosed ? 0 : -1;
    if (after < 0) {
      continue;
    }
    const segmentIn = segments[before];
    const segmentOut = segments[after];
    const pointIndex = segmentIn.endIndex;
    if (
      pointIndex === undefined ||
      segmentOut.startIndex !== pointIndex ||
      segmentIn.endSmooth ||
      isDegenerateSegment(segmentIn) ||
      isDegenerateSegment(segmentOut)
    ) {
      continue;
    }
    const tangentIn = endTangent(segmentIn);
    const tangentOut = startTangent(segmentOut);
    const turn = Math.acos(Math.min(1, Math.max(-1, dot(tangentIn, tangentOut))));
    if (turn > MAX_TURN) {
      continue;
    }
    corners.push({
      pointIndex,
      before,
      after,
      point: segmentIn.points.at(-1),
      tangentIn,
      tangentOut,
      turn,
      sign: cross(tangentIn, tangentOut) < 0 ? -1 : 1,
    });
  }
  return corners;
}

// The corners with a radius
function findCorners(contour, segments) {
  return centerlineCorners(contour, segments)
    .filter((corner) => contour.points[corner.pointIndex].values?.cornerRadius >= 0)
    .map((corner) => {
      const values = contour.points[corner.pointIndex].values;
      return {
        ...corner,
        values,
        wanted: values.cornerRadius,
        lines:
          segments[corner.before].type === "line" &&
          segments[corner.after].type === "line",
      };
    });
}

// What a segment allows the corners at its two ends to cut: what they want
// when it fits; otherwise the one that wants less keeps it, and the other
// gets the rest, each at least half
function share(start, end, length) {
  if (start + end <= length) {
    return { start, end };
  }
  const half = length / 2;
  if (start <= half) {
    return { start, end: length - start };
  }
  if (end <= half) {
    return { start: length - end, end };
  }
  return { start: half, end: half };
}

// The largest radius up to the one asked for whose cuts fit
function fitRadius(corner, segments, lengths, allowedIn, allowedOut) {
  const fits = (touch) =>
    !!touch && touch.cutIn <= allowedIn + 1e-9 && touch.cutOut <= allowedOut + 1e-9;
  if (
    corner.turn < MIN_TURN ||
    fits(touchAt(corner, segments, lengths, corner.wanted))
  ) {
    return corner.wanted;
  }
  if (corner.lines) {
    return Math.min(allowedIn, allowedOut) / Math.tan(corner.turn / 2);
  }
  let low = 0;
  let high = corner.wanted;
  for (let i = 0; i < SHRINK_STEPS; i++) {
    const middle = (low + high) / 2;
    if (fits(touchAt(corner, segments, lengths, middle))) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return low;
}

// --- Where an arc touches the segments ------------------------------------------

/**
 * Where an arc of a radius touches the segments on both sides of a corner:
 * the parameters a (on the segment arriving) and b (on the one leaving), the
 * points and directions there, the turn between them, and the lengths cut
 * from each segment. Null when no such arc is found along curves.
 */
function touchAt(corner, segments, lengths, radius) {
  const segmentIn = segments[corner.before];
  const segmentOut = segments[corner.after];
  const lengthIn = lengths[corner.before];
  const lengthOut = lengths[corner.after];
  const point = corner.point;
  const cut = radius * Math.tan(corner.turn / 2);
  if (corner.lines) {
    return {
      a: 1 - cut / lengthIn.length,
      b: cut / lengthOut.length,
      start: sub(point, scale(corner.tangentIn, cut)),
      end: add(point, scale(corner.tangentOut, cut)),
      tangentStart: corner.tangentIn,
      tangentEnd: corner.tangentOut,
      turn: corner.turn,
      cutIn: cut,
      cutOut: cut,
    };
  }
  const solved = solveTouch(segmentIn, segmentOut, point, corner.sign, radius, cut);
  if (!solved) {
    return null;
  }
  const { a, b } = solved;
  const tangentStart = tangentAt(segmentIn, a);
  const tangentEnd = tangentAt(segmentOut, b);
  const across = corner.sign * cross(tangentStart, tangentEnd);
  if (across < -1e-6) {
    return null;
  }
  return {
    a,
    b,
    start: pointAt(segmentIn, a),
    end: pointAt(segmentOut, b),
    tangentStart,
    tangentEnd,
    turn: Math.atan2(Math.max(0, across), dot(tangentStart, tangentEnd)),
    cutIn: lengthIn.length - lengthIn.at(a),
    cutOut: lengthOut.at(b),
  };
}

// The parameters a and b where the two segments, moved by the radius towards
// the inside of the corner, meet (Newton's method, from where lines along
// the directions at the corner would be cut); null when they do not
function solveTouch(segmentIn, segmentOut, point, sign, radius, cut) {
  const moved = (segment, t) =>
    add(pointAt(segment, t), scale(leftNormal(tangentAt(segment, t)), sign * radius));
  let a = parameterAtDistance(segmentIn, point, cut, true);
  let b = parameterAtDistance(segmentOut, point, cut, false);
  const h = 1e-7;
  for (let i = 0; i < 60; i++) {
    const f = sub(moved(segmentIn, a), moved(segmentOut, b));
    if (Math.hypot(f.x, f.y) <= 1e-9 * (1 + radius)) {
      return { a, b };
    }
    // One-sided derivatives, inside the segments
    const da = scale(sub(moved(segmentIn, a), moved(segmentIn, a - h)), 1 / h);
    const db = scale(sub(moved(segmentOut, b + h), moved(segmentOut, b)), 1 / h);
    // f + da·x − db·y = 0
    const det = -cross(da, db);
    if (!(Math.abs(det) > EPSILON)) {
      return null;
    }
    a = Math.min(1, Math.max(0, a + cross(f, db) / det));
    b = Math.min(1, Math.max(0, b + cross(f, da) / det));
  }
  return null;
}

// The parameter of the point of a segment at a distance from its end point
// (atEnd) or start point, found from that end
function parameterAtDistance(segment, point, length, atEnd) {
  let near = atEnd ? 1 : 0;
  let far = atEnd ? 0 : 1;
  if (distance(pointAt(segment, far), point) <= length) {
    return far;
  }
  for (let i = 0; i < 50; i++) {
    const middle = (near + far) / 2;
    if (distance(pointAt(segment, middle), point) < length) {
      near = middle;
    } else {
      far = middle;
    }
  }
  return (near + far) / 2;
}

// --- The arc ----------------------------------------------------------------------

// Where the arc of a corner starts and ends, and its points. A radius too
// small to cut MIN_CUT is made that large.
function arcAt(corner, segments, lengths, radius) {
  const segmentIn = segments[corner.before];
  const segmentOut = segments[corner.after];
  if (corner.turn < MIN_TURN) {
    // Straight on: a short straight piece through the point
    const a = parameterAtDistance(segmentIn, corner.point, MIN_CUT, true);
    const b = parameterAtDistance(segmentOut, corner.point, MIN_CUT, false);
    const start = pointAt(segmentIn, a);
    const end = pointAt(segmentOut, b);
    const middle = corner.point;
    const direction =
      normalize(add(corner.tangentIn, corner.tangentOut)) ?? corner.tangentIn;
    return {
      a,
      b,
      start,
      middle,
      end,
      cubics: [
        [
          start,
          lerp(start, middle, 1 / 3),
          sub(middle, scale(direction, distance(start, middle) / 3)),
          middle,
        ],
        [
          middle,
          add(middle, scale(direction, distance(middle, end) / 3)),
          lerp(middle, end, 2 / 3),
          end,
        ],
      ],
    };
  }
  const used = Math.max(radius, MIN_CUT / Math.tan(corner.turn / 2));
  let touch = touchAt(corner, segments, lengths, used);
  let arcRadius = used;
  if (!touch) {
    // Along curves where no arc of that radius touches both (only for a
    // radius too small to see): cut both at the line's distance
    const cut = used * Math.tan(corner.turn / 2);
    const a = parameterAtDistance(segmentIn, corner.point, cut, true);
    const b = parameterAtDistance(segmentOut, corner.point, cut, false);
    const tangentStart = tangentAt(segmentIn, a);
    const tangentEnd = tangentAt(segmentOut, b);
    const turn = Math.acos(Math.min(1, Math.max(-1, dot(tangentStart, tangentEnd))));
    touch = {
      a,
      b,
      start: pointAt(segmentIn, a),
      end: pointAt(segmentOut, b),
      tangentStart,
      tangentEnd,
      turn,
    };
    const chord = distance(touch.start, touch.end);
    arcRadius = turn > MIN_TURN ? chord / (2 * Math.sin(turn / 2)) : used;
  }
  const { start, end, tangentStart, tangentEnd, turn } = touch;
  const sign = corner.sign;
  const center = add(start, scale(leftNormal(tangentStart), sign * arcRadius));
  const middle = add(center, rotate(sub(start, center), (sign * turn) / 2));
  const tangentMiddle = rotate(tangentStart, (sign * turn) / 2);
  // Handle length of a cubic arc over half the turn
  const k = (4 / 3) * Math.tan(turn / 8) * arcRadius;
  return {
    a: touch.a,
    b: touch.b,
    start,
    middle,
    end,
    cubics: [
      [
        start,
        add(start, scale(tangentStart, k)),
        sub(middle, scale(tangentMiddle, k)),
        middle,
      ],
      [
        middle,
        add(middle, scale(tangentMiddle, k)),
        sub(end, scale(tangentEnd, k)),
        end,
      ],
    ],
  };
}

function rotate(v, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

// --- The rounded contour ----------------------------------------------------------

// The contour again, from its segments: cut where the arcs touch them, with
// the arcs in between
function rebuild(contour, segments, corners) {
  const atStart = new Map(corners.map((corner) => [corner.after, corner]));
  const atEnd = new Map(corners.map((corner) => [corner.before, corner]));
  const points = [];
  const pointIndices = [];
  const push = (point, index) => {
    points.push(point);
    pointIndices.push(index);
  };
  const ownPoint = (index, p) =>
    index === undefined
      ? { x: p.x, y: p.y, smooth: true, implied: true }
      : { ...contour.points[index], x: p.x, y: p.y };
  const arcPoint = (corner, p, part) => ({
    x: p.x,
    y: p.y,
    smooth: true,
    values: corner.values ? { ...corner.values } : undefined,
    cornerArc: part,
  });
  const first = atStart.get(0);
  if (first) {
    push(arcPoint(first, first.arc.end, "end"), first.pointIndex);
  } else {
    push(
      ownPoint(segments[0].startIndex, segments[0].points[0]),
      segments[0].startIndex
    );
  }
  for (const [index, segment] of segments.entries()) {
    const startCorner = atStart.get(index);
    const endCorner = atEnd.get(index);
    const closing = contour.isClosed && index === segments.length - 1;
    if (segment.type === "cubic") {
      const t0 = startCorner ? startCorner.arc.b : 0;
      const t1 = endCorner ? endCorner.arc.a : 1;
      const [, c1, c2] = subCubic(segment.points, Math.min(t0, t1), t1);
      push(offCurve(c1));
      push(offCurve(c2));
    }
    if (!endCorner) {
      if (!closing) {
        push(ownPoint(segment.endIndex, segment.points.at(-1)), segment.endIndex);
      }
      continue;
    }
    const { arc, pointIndex } = endCorner;
    push(arcPoint(endCorner, arc.start, "start"), pointIndex);
    push(offCurve(arc.cubics[0][1]));
    push(offCurve(arc.cubics[0][2]));
    push(arcPoint(endCorner, arc.middle, "middle"), pointIndex);
    push(offCurve(arc.cubics[1][1]));
    push(offCurve(arc.cubics[1][2]));
    if (!closing) {
      push(arcPoint(endCorner, arc.end, "end"), pointIndex);
    }
  }
  return { contour: { points, isClosed: contour.isClosed }, pointIndices };
}

// The part of a cubic between two parameters
function subCubic(points, t0, t1) {
  let part = points;
  if (t1 < 1) {
    part = splitCubic(part, t1)[0];
  }
  if (t0 > 0) {
    part = splitCubic(part, t1 > 0 ? t0 / t1 : 0)[1];
  }
  return part;
}

function splitCubic([p0, p1, p2, p3], t) {
  const p01 = lerp(p0, p1, t);
  const p12 = lerp(p1, p2, t);
  const p23 = lerp(p2, p3, t);
  const p012 = lerp(p01, p12, t);
  const p123 = lerp(p12, p23, t);
  const p = lerp(p012, p123, t);
  return [
    [p0, p01, p012, p],
    [p, p123, p23, p3],
  ];
}
