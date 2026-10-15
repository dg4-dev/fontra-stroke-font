// The corner knobs of the stroke width tool: a small knob inside each corner
// of a centerline, dragged away from the corner to round it (see
// geometry/corners.js). No Fontra or DOM dependencies.
//
// | Action                 | Changes                                         |
// | ---------------------- | ----------------------------------------------- |
// | Drag the knob          | the radius, by as much as the knob is dragged   |
// |   with Shift           | the radius in steps of 5 units                  |
// | Double-click the knob  | the radius back to 0                            |
//
// The knob lies on the line halfway between the two segments, on the inside
// of the corner, a few pixels from the point plus the radius. With several
// corners selected, all of them get the same radius.

import { strokeStyleForGlyph } from "./current-source.js";
import { add, dot, normalize, scale, sub } from "./geometry/bezier.js";
import { centerlineCorners, roundCorners } from "./geometry/corners.js";
import { isCenterlineContour } from "./stroke-data.js";

export const CORNER_STEP = 5;
/** How far the knob of a corner without radius is from the point, in pixels. */
export const CORNER_KNOB_DISTANCE = 12;

/**
 * The knobs of the corners of the centerlines of a glyph, in glyph
 * coordinates.
 * @param {{knobDistance?: number}} [options] the distance of the knob of a
 *   corner without radius from its point, in glyph units
 * @returns {{pointIndex: number, side: "corner", axis: "corner",
 *   anchor: object, handle: object, normal: object, radius: number}[]}
 *   normal is the unit vector from the point (anchor) towards the knob, into
 *   the corner; radius the corner's radius
 */
export function cornerHandles(positionedGlyph, location, options = {}) {
  const knobDistance = options.knobDistance ?? 0;
  const handles = [];
  for (const { contour, firstPoint } of centerlineContours(positionedGlyph, location)) {
    for (const corner of centerlineCorners(contour)) {
      // Into the corner, halfway between the two segments
      const normal = normalize(sub(corner.tangentOut, corner.tangentIn));
      if (!normal) {
        continue;
      }
      const anchor = { x: corner.point.x, y: corner.point.y };
      const radius = contour.points[corner.pointIndex].values?.cornerRadius ?? 0;
      handles.push({
        pointIndex: firstPoint + corner.pointIndex,
        side: "corner",
        axis: "corner",
        anchor,
        normal,
        radius,
        handle: add(anchor, scale(normal, knobDistance + radius)),
      });
    }
  }
  return handles;
}

/**
 * The radius for a drag of a corner knob: the corner's radius when the drag
 * started, plus how far the pointer moved into the corner.
 * @param {{normal: object, radius: number}} handle the knob, as it was when
 *   the drag started
 * @param {{x: number, y: number}} move how far the pointer moved (glyph units)
 * @param {{shiftKey?: boolean}} [keys] Shift: steps of CORNER_STEP
 */
export function draggedCornerRadius(handle, move, keys = {}) {
  let radius = Math.max(0, handle.radius + dot(move, handle.normal));
  if (keys.shiftKey) {
    radius = Math.round(radius / CORNER_STEP) * CORNER_STEP;
  }
  return Math.round(radius * 100) / 100;
}

/**
 * The centerlines of a glyph with their corners rounded, as they are
 * stroked, for those with a rounded corner.
 * @returns {{points: object[], isClosed: boolean}[]} unpacked contours
 */
export function roundedCenterlines(positionedGlyph, location) {
  return centerlineContours(positionedGlyph, location)
    .map(({ contour }) => roundCorners(contour))
    .filter((rounded) => rounded.corners.length)
    .map((rounded) => rounded.contour);
}

// The centerlines of the glyph's path, unpacked, with the values of their
// points, and the index of their first point in the path
function centerlineContours(positionedGlyph, location) {
  const path = positionedGlyph?.glyph?.path;
  if (!path) {
    return [];
  }
  const style = strokeStyleForGlyph(positionedGlyph, location);
  if (!style) {
    return [];
  }
  const contours = [];
  let firstPoint = 0;
  for (const [contourIndex, info] of (path.contourInfo ?? []).entries()) {
    const start = firstPoint;
    firstPoint = info.endPoint + 1;
    const values = style.points?.[contourIndex];
    if (!isCenterlineContour(info.isClosed, values)) {
      continue;
    }
    let contour;
    try {
      contour = path.getUnpackedContour(contourIndex);
    } catch (e) {
      // A contour being drawn can be malformed for a moment
      continue;
    }
    contour.points.forEach((point, i) => {
      point.values = values?.[i];
    });
    contours.push({ contour, firstPoint: start });
  }
  return contours;
}
