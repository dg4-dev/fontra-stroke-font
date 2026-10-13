// Reading and changing the values of the selected points of a glyph. Works on
// Fontra's glyph objects, but needs nothing else from Fontra, so it is tested
// with plain objects.
//
// Values are written to each source being edited, and joins to the default
// source (see stroke-data.js). A point without an identifier gets one, as
// does a point whose identifier an earlier point of the glyph already has.

import {
  strokeStyleForGlyph,
  defaultSourceIndex,
  findStrokeSource,
  layerPath,
  nibProfile,
} from "./current-source.js";
import { centerlineSegments } from "./geometry/centerline.js";
import { widthProfile } from "./geometry/widths.js";
import { pathPoints, samePointStructure } from "./path-points.js";
import {
  NIB_KEYS,
  SHARED_POINT_KEYS,
  makePointIdentifier,
  normalizeNibAngle,
  pointHalfWidths,
  resolvePointValues,
  setPointValues,
} from "./stroke-data.js";

/** The point indices in a Fontra selection ("point/12", ...). */
export function selectedPointIndices(selection) {
  const indices = [];
  for (const item of selection ?? []) {
    const match = /^point\/(\d+)$/.exec(item);
    if (match) {
      indices.push(Number(match[1]));
    }
  }
  return indices.sort((a, b) => a - b);
}

/**
 * The on-curve points among the given points, with their contours. Points of
 * closed contours are included: a closed contour can be made a centerline.
 * @returns {{pointIndex: number, contourIndex: number, contourPointIndex: number,
 *   isClosed: boolean}[]}
 */
export function centerlinePoints(path, pointIndices) {
  const wanted = new Set(pointIndices);
  const result = [];
  for (const [contourIndex, contour] of pathPoints(path).entries()) {
    const isClosed = !!path.contourInfo[contourIndex].isClosed;
    for (const [contourPointIndex, point] of contour.entries()) {
      if (point.onCurve && wanted.has(point.pointIndex)) {
        result.push({
          pointIndex: point.pointIndex,
          contourIndex,
          contourPointIndex,
          isClosed,
        });
      }
    }
  }
  return result;
}

/**
 * The on-curve points of the closed contours that the given points are on:
 * the points that mark such a contour as a centerline.
 */
export function closedContourPoints(path, pointIndices) {
  const contours = new Set(
    centerlinePoints(path, pointIndices)
      .filter((point) => point.isClosed)
      .map((point) => point.contourIndex)
  );
  return pathPoints(path)
    .filter((contour, contourIndex) => contours.has(contourIndex))
    .flatMap((contour) =>
      contour.filter((point) => point.onCurve).map((point) => point.pointIndex)
    );
}

/**
 * The half widths (or the nib) the stroke has at points of the glyph's path,
 * and the values those points have, as the preview uses them.
 * @param {object} positionedGlyph an entry of Fontra's positioned lines
 * @param {object} location the glyph's location
 * @param {number[]} pointIndices points of the glyph's path
 * @returns {null | {style: object, points: {pointIndex: number,
 *   contourIndex: number, contourPointIndex: number, values: object|undefined,
 *   left: number, right: number}[]}} with a nib style (style.type "nib"),
 *   points have major, minor and angle instead of left and right
 */
export function measurePoints(positionedGlyph, location, pointIndices) {
  const path = positionedGlyph?.glyph?.path;
  const style = strokeStyleForGlyph(positionedGlyph, location);
  if (!path || !style) {
    return null;
  }
  const isNib = style.type === "nib";
  const profiles = new Map();
  const profile = (contourIndex) => {
    if (!profiles.has(contourIndex)) {
      const contour = path.getUnpackedContour(contourIndex);
      const values = style.points?.[contourIndex];
      contour.points.forEach((point, i) => {
        point.values = values?.[i];
      });
      profiles.set(contourIndex, {
        contour,
        numbers: isNib
          ? nibProfile(contour, style)
          : widthProfile(contour, centerlineSegments(contour), style),
      });
    }
    return profiles.get(contourIndex);
  };
  const points = centerlinePoints(path, pointIndices).map((point) => {
    const { contour, numbers } = profile(point.contourIndex);
    const values = contour.points[point.contourPointIndex].values;
    const at = numbers.atPoint(point.contourPointIndex);
    if (isNib) {
      // A lone point has no segments: its own nib, or the source's
      const nib = {};
      for (const key of NIB_KEYS) {
        nib[key] = at?.[key] ?? values?.[key] ?? style[key];
      }
      nib.angle = normalizeNibAngle(nib.angle);
      return { ...point, values, ...nib };
    }
    // A lone point has no segments: its own widths, or the source's
    const own = pointHalfWidths(values);
    const widths = at ?? {
      left: own.left ?? style.width / 2,
      right: own.right ?? style.width / 2,
    };
    return { ...point, values, left: widths.left, right: widths.right };
  });
  return { style, points };
}

/**
 * What the panel shows for the selected points, or null when no point of a
 * centerline is selected.
 * @returns {null | {count: number, atSource: boolean, editable: boolean,
 *   stored: boolean, fields: object}} fields: per key, the value of all the
 *   points (undefined when they differ), whether the points set it themselves
 */
export function describeSelectedPoints(positionedGlyph, location, selection) {
  const measured = measurePoints(
    positionedGlyph,
    location,
    selectedPointIndices(selection)
  );
  if (!measured?.points.length) {
    return null;
  }
  const { style, points } = measured;
  const { atSource } = findStrokeSource(positionedGlyph, location);
  // Whether the closed contours of the selected points are centerlines:
  // undefined without closed contours, null when some are and some are not
  const closed = new Map();
  for (const point of points.filter((p) => p.isClosed)) {
    const values = style.points?.[point.contourIndex];
    closed.set(point.contourIndex, !!values?.some((v) => v?.centerline));
  }
  const closedStates = [...closed.values()];
  const closedCenterline = !closedStates.length
    ? undefined
    : closedStates.every((state) => state === closedStates[0])
      ? closedStates[0]
      : null;
  const common = (get) => {
    const values = points.map(get);
    return values.every((value) => value === values[0]) ? values[0] : undefined;
  };
  const round = (value) => Math.round(value * 100) / 100;
  const isNib = style.type === "nib";
  return {
    count: points.length,
    atSource,
    editable: atSource,
    method: isNib ? "nib" : "offset",
    // Values of the glyph's method only: those of the other one do nothing
    stored: points.some((point) =>
      Object.keys(point.values ?? {}).some((key) => NIB_KEYS.includes(key) === isNib)
    ),
    fields: isNib
      ? {
          major: common((point) => round(point.major)),
          minor: common((point) => round(point.minor)),
          angle: common((point) => round(point.angle)),
        }
      : {
          width: common((point) => round(point.left + point.right)),
          left: common((point) => round(point.left)),
          right: common((point) => round(point.right)),
          join: common((point) => point.values?.join ?? ""),
          miterLimit: common((point) => point.values?.miterLimit ?? ""),
        },
    closedCenterline,
    sourceStyle: style,
  };
}

/**
 * The new values of a point when one field is changed.
 * @param {object|undefined} stored what the point has now
 * @param {string} key width, left, right, join or miterLimit
 * @param {*} value the new value; undefined (or "") removes it
 * @returns {object} the keys to set (undefined to remove)
 */
export function pointValuesForField(stored, key, value) {
  if (value === "") {
    value = undefined;
  }
  switch (key) {
    case "width":
      return { width: value, left: undefined, right: undefined };
    case "left":
    case "right": {
      const other = key === "left" ? "right" : "left";
      const change = { [key]: value, width: undefined };
      // A width set for both sides keeps applying to the other side
      if (stored?.width !== undefined && stored?.[other] === undefined) {
        change[other] = stored.width / 2;
      }
      return change;
    }
    default:
      return { [key]: value };
  }
}

/** All the keys of a point (but its closed contour mark), removed. */
export const CLEARED_POINT_VALUES = Object.freeze({
  width: undefined,
  left: undefined,
  right: undefined,
  join: undefined,
  miterLimit: undefined,
  major: undefined,
  minor: undefined,
  angle: undefined,
});

/**
 * The sources to write point values to: those whose layers are being edited
 * (Fontra can edit several sources at once), with points that correspond to
 * the primary one's. The primary source comes first.
 * @param {object} varGlyph Fontra's VariableGlyph (or its controller)
 * @param {number} sourceIndex the source being edited
 * @param {string[]} [editingLayerNames] sceneController.editingLayerNames
 */
export function editingSourceIndices(varGlyph, sourceIndex, editingLayerNames = []) {
  const sources = varGlyph?.sources ?? [];
  const primary = sources[sourceIndex];
  if (!primary) {
    return [];
  }
  const primaryPath = layerPath(varGlyph, primary);
  const indices = [sourceIndex];
  for (const [index, source] of sources.entries()) {
    if (
      index !== sourceIndex &&
      !source.inactive &&
      editingLayerNames.includes(source.layerName) &&
      samePointStructure(layerPath(varGlyph, source), primaryPath)
    ) {
      indices.push(index);
    }
  }
  return indices;
}

/**
 * Change the values of points, in place, in the given sources of a glyph:
 * Fontra's VariableGlyph, inside editGlyph / recordChanges.
 * @param {object} glyph the variable glyph (sources and layers)
 * @param {number[]} sourceIndices see editingSourceIndices()
 * @param {number[]} pointIndices points of the glyph's path
 * @param {(stored: object|undefined, pointIndex: number, sourceIndex: number) => object} makeValues
 *   the keys to set for a point (undefined to remove)
 * @param {{defaultIndex?: number}} [options] the default source, which gets
 *   the joins
 */
export function editPointValues(
  glyph,
  sourceIndices,
  pointIndices,
  makeValues,
  options = {}
) {
  const defaultIndex = options.defaultIndex ?? defaultSourceIndex(glyph);
  const writes = new Map(); // sourceIndex → Map(pointIndex → values)
  const add = (sourceIndex, pointIndex, values) => {
    if (!Object.keys(values).length) {
      return;
    }
    if (!writes.has(sourceIndex)) {
      writes.set(sourceIndex, new Map());
    }
    const forSource = writes.get(sourceIndex);
    forSource.set(pointIndex, { ...forSource.get(pointIndex), ...values });
  };
  const primaryPath = layerPath(glyph, glyph.sources[sourceIndices[0]]);
  for (const sourceIndex of sourceIndices) {
    const stored = storedValues(glyph, sourceIndex);
    for (const pointIndex of pointIndices) {
      const values = makeValues(stored.get(pointIndex), pointIndex, sourceIndex);
      const own = {};
      const shared = {};
      for (const [key, value] of Object.entries(values)) {
        (SHARED_POINT_KEYS.includes(key) ? shared : own)[key] = value;
      }
      add(sourceIndex, pointIndex, own);
      if (
        Object.keys(shared).length &&
        defaultIndex !== undefined &&
        samePointStructure(layerPath(glyph, glyph.sources[defaultIndex]), primaryPath)
      ) {
        add(defaultIndex, pointIndex, shared);
      }
    }
  }
  for (const [sourceIndex, changes] of writes) {
    const source = glyph.sources[sourceIndex];
    const path = layerPath(glyph, source);
    if (!path) {
      continue;
    }
    const identifiers = ensureIdentifiers(path, [...changes.keys()]);
    if (!source.customData) {
      source.customData = {};
    }
    setPointValues(
      source.customData,
      new Map(
        [...changes].map(([pointIndex, values]) => [
          identifiers.get(pointIndex),
          values,
        ])
      ),
      pathIdentifiers(path)
    );
  }
}

// The values each point of a source has, by point index
function storedValues(glyph, sourceIndex) {
  const source = glyph.sources[sourceIndex];
  const path = layerPath(glyph, source);
  const result = new Map();
  if (!path) {
    return result;
  }
  const contours = pathPoints(path);
  const values = resolvePointValues(contours, source.customData);
  for (const [c, contour] of contours.entries()) {
    for (const [i, point] of contour.entries()) {
      if (values[c][i]) {
        result.set(point.pointIndex, values[c][i]);
      }
    }
  }
  return result;
}

/**
 * Give the points identifiers where they have none, or one that an earlier
 * point of the path already has. Changes the path in place.
 * @returns {Map<number, string>} point index → identifier
 */
export function ensureIdentifiers(path, pointIndices) {
  const first = new Map();
  const numPoints = path.pointTypes.length;
  for (let i = 0; i < numPoints; i++) {
    const identifier = path.pointAttributes?.[i]?.identifier;
    if (typeof identifier === "string" && !first.has(identifier)) {
      first.set(identifier, i);
    }
  }
  const taken = new Set(first.keys());
  const result = new Map();
  for (const pointIndex of pointIndices) {
    const identifier = path.pointAttributes?.[pointIndex]?.identifier;
    if (typeof identifier === "string" && first.get(identifier) === pointIndex) {
      result.set(pointIndex, identifier);
      continue;
    }
    const fresh = makePointIdentifier(taken);
    taken.add(fresh);
    if (!path.pointAttributes) {
      path.pointAttributes = new Array(numPoints).fill(null);
    }
    const attrs = path.pointAttributes[pointIndex];
    path.pointAttributes[pointIndex] = { ...(attrs ?? {}), identifier: fresh };
    result.set(pointIndex, fresh);
  }
  return result;
}

function pathIdentifiers(path) {
  const identifiers = [];
  for (let i = 0; i < path.pointTypes.length; i++) {
    const identifier = path.pointAttributes?.[i]?.identifier;
    if (typeof identifier === "string") {
      identifiers.push(identifier);
    }
  }
  return identifiers;
}
