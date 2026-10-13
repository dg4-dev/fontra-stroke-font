// What the stroke methods share: putting the edges of the segments of a
// centerline together into closed contours. No Fontra or DOM dependencies.
//
// A method (offset.js, nib.js) gives the left and right edges of each segment
// as cubic pieces, and the shapes at the corners and ends. The result is a
// set of closed contours that overlap and are meant to be filled together
// with the nonzero rule:
// - one band per run of segments between two corners (or ends): the right
//   edge forwards, then the left edge backwards,
// - one shape per corner (the join) and per end (the cap), from the method.
// Overlaps are not removed; fontmake / fontra-workflow do that after the CLI.
//
// Every contour is built counter-clockwise (in a y-up coordinate system), so
// that overlapping parts never cancel each other out. The direction comes
// from how a contour is built, not from measuring it, so that it is the same
// in every source of a glyph and the outlines stay compatible.
//
// A closed centerline (a loop, as in o or D) has no caps, and a join at its
// start when that is a corner. A loop without any corner is stroked as two
// closed edges running in opposite directions (the outer one and the hole);
// those are the only contours not built counter-clockwise, and since the hole
// lies inside the outer edge, the loop never cancels anything out.
//
// A method may also cut a band inside a segment (a "cut"), or at every smooth
// point: the band ends there, and the method's corner shape covers the place
// where the next band starts. The nib method does that where the corner of a
// rectangular nib that draws an edge changes.
//
// The layout: per segment and side, the parameters where an edge is split and
// the number of pieces each part is fitted with. sweepContour() returns the
// layout used and can be given one; stroking every source of a glyph with the
// same layout gives outlines with the same points (see compatible.js).

import {
  endTangent,
  isDegenerateSegment,
  lerp,
  startTangent,
  tangentAt,
} from "./bezier.js";
import { offCurve, onCurve } from "./shapes.js";

// Split parameters closer than this are the same
export const SAME_PARAMETER = 1e-9;

/**
 * @param {{points: object[], isClosed: boolean}} contour unpacked contour
 * @param {object[]} segments centerlineSegments(contour)
 * @param {object} method
 * @param {boolean} method.isEmpty nothing to draw (a zero width)
 * @param {boolean} [method.cutsAtSmoothPoints] end the bands at smooth points too
 * @param {(segment: object, index: number, forced: object|undefined) => {
 *   parts: {left: object[], right: object[], t0: number, t1: number,
 *     cut?: boolean}[],
 *   layout: object, twists: object[], mismatch: boolean}} method.buildSegment
 *   the edges of a segment, in parts from t0 to t1 (a part with cut starts a
 *   new band); its layout; its twists; whether a given layout was not followed
 * @param {(previous: object, current: object) => object} method.cornerShape
 *   the shape at the start of the part current, where the band of previous ends
 * @param {(first: object, last: object) => object[]} method.capShapes
 *   the shapes at the ends of an open centerline
 * @param {(pointIndex: number) => object[]} method.dotShapes the shapes of a
 *   lone point
 * @param {object} [layout] see the top of this file
 * @returns {{contours: {points: object[], isClosed: true}[], layout: object,
 *   twists: object[], layoutMismatch: boolean}}
 */
export function sweepContour(contour, segments, method, layout) {
  const result = {
    contours: [],
    layout: { segments: segments.map(() => null) },
    twists: [],
    layoutMismatch: false,
  };
  // (A lone point has no segments; its own values decide below)
  if (method.isEmpty && segments.length) {
    return result;
  }
  let forced = layout;
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
    const built = method.buildSegment(segment, index, forced?.segments[index]);
    if (built.mismatch) {
      result.layoutMismatch = true;
    }
    result.layout.segments[index] = built.layout;
    result.twists.push(...built.twists);
    for (const part of built.parts) {
      usable.push({
        index,
        segment,
        ...part,
        cut: !!part.cut,
        startTangent: part.t0 > 0 ? tangentAt(segment, part.t0) : startTangent(segment),
        endTangent: part.t1 < 1 ? tangentAt(segment, part.t1) : endTangent(segment),
      });
    }
  }

  if (!usable.length) {
    // A lone point (or points on top of each other): a dot, as in SVG
    const pointIndex = contour.points.findIndex((p) => !p.type);
    if (pointIndex >= 0) {
      result.contours.push(...method.dotShapes(pointIndex));
    }
    return result;
  }

  // A smooth point does not make a corner
  const continues = (previous, current) =>
    !current.cut &&
    !method.cutsAtSmoothPoints &&
    (current.index === previous.index + 1 ||
      (contour.isClosed &&
        current.index === 0 &&
        previous.index === segments.length - 1)) &&
    previous.segment.endSmooth;

  let ordered = usable;
  if (contour.isClosed) {
    // Start the runs at a corner, so that no run is cut at the contour's start
    const k = usable.findIndex((item, i) => !continues(usable.at(i - 1), item));
    if (k < 0) {
      result.contours.push(...ringContours(usable));
      return result;
    }
    ordered = [...usable.slice(k), ...usable.slice(0, k)];
  }

  // Split into runs at the corners
  let run = [ordered[0]];
  for (let k = 1; k < ordered.length; k++) {
    const previous = ordered[k - 1];
    const current = ordered[k];
    if (continues(previous, current)) {
      run.push(current);
      continue;
    }
    result.contours.push(runContour(run));
    result.contours.push(method.cornerShape(previous, current));
    run = [current];
  }
  result.contours.push(runContour(run));

  if (contour.isClosed) {
    // The corner where the loop comes back to its first run
    result.contours.push(method.cornerShape(ordered.at(-1), ordered[0]));
    return result;
  }
  result.contours.push(...method.capShapes(usable[0], usable.at(-1)));
  return result;
}

/**
 * Whether the split parameters of an edge can be used: sorted, within [0, 1].
 */
export function validBreaks(breaks) {
  return (
    Array.isArray(breaks) &&
    breaks.every((t, i) => t >= 0 && t <= 1 && (i === 0 || t >= breaks[i - 1]))
  );
}

/** Sorted split parameters without (nearly) equal ones. */
export function mergeBreaks(breaks) {
  const sorted = [...breaks].sort((a, b) => a - b);
  return sorted.filter((t, i) => i === 0 || t - sorted[i - 1] > SAME_PARAMETER);
}

/** Split parameters inside a segment, without its ends. */
export function innerBreaks(breaks) {
  return mergeBreaks(
    breaks.filter((t) => t > SAME_PARAMETER && t < 1 - SAME_PARAMETER)
  );
}

// --- Assembling contours ------------------------------------------------------

// The band of a run of parts joined by smooth points
function runContour(run) {
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
  return bandContour(right, left, joints);
}

// A loop without corners: the right edge forwards and the left edge backwards,
// each closed on its own
function ringContours(items) {
  const right = items.flatMap((item) => item.right.map(copyPiece));
  const left = items.flatMap((item) => item.left.map(copyPiece));
  const meetAll = (pieces, starts) => {
    for (const start of starts) {
      meetHalfway(pieces.at(start - 1), pieces[start]);
    }
  };
  const starts = (side) => {
    const result = [];
    let count = 0;
    for (const item of items) {
      result.push(count);
      count += item[side].length;
    }
    return result;
  };
  meetAll(right, starts("right"));
  meetAll(left, starts("left"));
  const outline = (pieces) => {
    const points = [onCurve(pieces[0].points[0])];
    for (const piece of pieces) {
      appendPiece(points, piece.points);
    }
    // The last point is the first one again; the contour closes by itself
    points.pop();
    return { points, isClosed: true };
  };
  const reversed = left.toReversed().map((piece) => ({
    type: piece.type,
    points: piece.points.toReversed(),
  }));
  return [outline(right), outline(reversed)];
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
