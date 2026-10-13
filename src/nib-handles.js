// The nib of each point of a glyph of the nib method, and its handles: the
// two ends of the nib's major axis, the two ends of its minor axis (except
// for a flat nib), and a knob for turning it, a little beyond the "+" end of
// the major axis. No Fontra or DOM dependencies.
//
// | Drag                       | Changes                                       |
// | -------------------------- | --------------------------------------------- |
// | the knob                   | angle only                                    |
// |   with Shift               | the angle in steps of 15°                     |
// | an end of the major axis   | major only                                    |
// |   with Alt (Option)        | major and angle: the end follows the pointer |
// | an end of the minor axis   | minor only                                    |
//
// With several points selected, all of them get the same change: their
// lengths are multiplied by the same ratio and turned by the same angle.

import {
  MIN_ELLIPSE_AXIS,
  ellipseContour,
  makeNib,
  rectContour,
} from "./geometry/nib.js";
import { pathPoints } from "./path-points.js";
import { measurePoints } from "./point-edit.js";
import { isCenterlineContour, normalizeNibAngle } from "./stroke-data.js";

export const ANGLE_STEP = 15;
/** How far the turning knob is beyond the end of the major axis, in pixels. */
export const KNOB_DISTANCE = 24;

/**
 * The nibs and handles of the centerline points of a glyph of the nib
 * method, in glyph coordinates; null for other glyphs.
 * @returns {null | {shape: string, nibs: {pointIndex: number, anchor: object,
 *   major: number, minor: number, angle: number, contour: object}[],
 *   handles: {pointIndex: number, side: string, axis:
 *   "major"|"minor"|"rotate", anchor: object, handle: object, normal: object,
 *   length: number}[]}}
 *   a nib's contour is its outline at the point; a handle's normal is the
 *   unit vector from the point towards it, and length the full axis length
 *   (the major axis for the knob)
 * @param {{knobDistance?: number}} [options] the distance of the turning
 *   knob beyond the end of the major axis, in glyph units
 */
export function nibHandles(positionedGlyph, location, options = {}) {
  const knobDistance = options.knobDistance ?? 0;
  const path = positionedGlyph?.glyph?.path;
  if (!path) {
    return null;
  }
  const all = pathPoints(path).flatMap((contour) =>
    contour.map((point) => point.pointIndex)
  );
  const measured = measurePoints(positionedGlyph, location, all);
  if (measured?.style.type !== "nib") {
    return null;
  }
  const { shape } = measured.style;
  const nibs = [];
  const handles = [];
  for (const point of measured.points) {
    const info = path.contourInfo[point.contourIndex];
    if (
      !isCenterlineContour(info.isClosed, measured.style.points?.[point.contourIndex])
    ) {
      continue;
    }
    const anchor = {
      x: path.coordinates[point.pointIndex * 2],
      y: path.coordinates[point.pointIndex * 2 + 1],
    };
    const { major, minor, angle } = point;
    const nib = makeNib(major, minor, angle, shape === "rect" ? 0 : MIN_ELLIPSE_AXIS);
    nibs.push({
      pointIndex: point.pointIndex,
      anchor,
      major,
      minor,
      angle,
      contour:
        shape === "rect" ? rectContour(anchor, nib) : ellipseContour(anchor, nib),
    });
    const along = { x: nib.cos, y: nib.sin };
    const across = { x: -nib.sin, y: nib.cos };
    const axes = [["major", along, major]];
    // A flat nib has no minor axis to drag
    if (!(shape === "rect" && minor === 0)) {
      axes.push(["minor", across, minor]);
    }
    for (const [axis, direction, length] of axes) {
      for (const end of [1, -1]) {
        const normal = { x: direction.x * end, y: direction.y * end };
        handles.push({
          pointIndex: point.pointIndex,
          side: `${axis}${end > 0 ? "+" : "-"}`,
          axis,
          anchor,
          normal,
          length,
          handle: {
            x: anchor.x + (normal.x * length) / 2,
            y: anchor.y + (normal.y * length) / 2,
          },
        });
      }
    }
    handles.push({
      pointIndex: point.pointIndex,
      side: "rotate",
      axis: "rotate",
      anchor,
      normal: along,
      length: major,
      handle: {
        x: anchor.x + along.x * (major / 2 + knobDistance),
        y: anchor.y + along.y * (major / 2 + knobDistance),
      },
    });
  }
  return { shape, nibs, handles };
}

/**
 * The change a drag makes to the dragged point's nib.
 * @param {{axis: string, normal: object, anchor: object}} handle the dragged
 *   handle, as it was when the drag started
 * @param {{major: number, minor: number, angle: number}} start the point's
 *   nib when the drag started
 * @param {{x: number, y: number}} pointer where the pointer is (glyph units)
 * @param {{altKey?: boolean, shiftKey?: boolean}} [keys]
 * @returns {{ratio: number, rotation: number, length: number, angle: number}}
 *   the dragged axis's new length (and how many times the old one), and the
 *   nib's new angle (and how far it turned)
 */
export function nibDrag(handle, start, pointer, keys = {}) {
  const v = { x: pointer.x - handle.anchor.x, y: pointer.y - handle.anchor.y };
  const old = handle.axis === "minor" ? start.minor : start.major;
  let length;
  let angle = start.angle;
  const turns = handle.axis === "rotate" || (handle.axis === "major" && keys.altKey);
  if (turns) {
    length = handle.axis === "rotate" ? old : 2 * Math.hypot(v.x, v.y);
    // The direction of the axis is towards the "+" end
    const towards = handle.side.endsWith("-") ? { x: -v.x, y: -v.y } : v;
    if (Math.hypot(v.x, v.y) > 0) {
      angle = (Math.atan2(towards.y, towards.x) * 180) / Math.PI;
      if (keys.shiftKey) {
        angle = Math.round(angle / ANGLE_STEP) * ANGLE_STEP;
      }
    }
  } else {
    // Only the length: the pointer measured along the handle's direction
    length = 2 * Math.max(0, v.x * handle.normal.x + v.y * handle.normal.y);
  }
  let rotation = angle - start.angle;
  // The same nib turned by a half turn: take the shortest rotation
  rotation -= 180 * Math.round(rotation / 180);
  return {
    length,
    ratio: old > 0 ? length / old : undefined,
    angle: normalizeNibAngle(start.angle + rotation),
    rotation,
  };
}

/**
 * The new values of a point for a drag (see nibDrag()): its axis length
 * times the ratio (or the dragged point's new length when the ratio is
 * unknown), its angle turned by the rotation.
 * @param {{major: number, minor: number, angle: number}} nib the point's nib
 *   when the drag started
 * @param {"major"|"minor"|"rotate"} axis the dragged handle's
 */
export function draggedNibValues(nib, axis, drag) {
  const values = {};
  if (axis !== "rotate") {
    values[axis] = round(
      drag.ratio === undefined ? drag.length : nib[axis] * drag.ratio
    );
  }
  if (axis !== "minor" && drag.rotation !== 0) {
    values.angle = round(normalizeNibAngle(nib.angle + drag.rotation));
  }
  return values;
}

function round(value) {
  return Math.round(value * 100) / 100;
}
