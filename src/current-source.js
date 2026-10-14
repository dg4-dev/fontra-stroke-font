// Which stroke values apply to a glyph shown in the editor.
//
// At a source location, that source's numbers are used. Between sources, the
// numbers are interpolated the same way Fontra interpolates the outlines.
// Cap and join always come from the default source (see stroke-data.js).
//
// The values of points are found by the points' identifiers in each source.
// Between sources, points correspond by their index in the path (identifiers
// may differ between sources), so the sources need the same points. The path
// may have more contours after the glyph's own: those of nested components,
// in the flattened path of a component.

import { centerlineSegments } from "./geometry/centerline.js";
import { nibAngleReference, nibAngleShifts } from "./geometry/nib.js";
import { valueProfile, widthProfile } from "./geometry/widths.js";
import { pathPoints, startsWithPointStructure } from "./path-points.js";
import {
  INTERPOLATED_OFFSET_KEYS,
  NIB_KEYS,
  getGlyphStroke,
  getSourceStroke,
  nearestNibAngle,
  nibStyleInGlyph,
  offsetStyleInGlyph,
  SHARED_POINT_KEYS,
  pointHalfWidths,
  resolveNibStyle,
  resolveOffsetStyle,
  resolvePointValues,
  sanitizeNibValue,
  sanitizeOffsetValue,
} from "./stroke-data.js";

/**
 * @param {object} positionedGlyph an entry of Fontra's positioned lines
 * @param {object} [location] the glyph's source location, for finding the
 *   nearest source when the glyph is not at a source
 * @returns {{varGlyph: object|undefined, sourceIndex: number|undefined,
 *   atSource: boolean}} sourceIndex is the nearest source when not at one
 */
export function findStrokeSource(positionedGlyph, location) {
  const glyph = positionedGlyph?.glyph;
  const varGlyph = positionedGlyph?.varGlyph ?? glyph?.varGlyph;
  if (!varGlyph?.sources?.length) {
    return { varGlyph, sourceIndex: undefined, atSource: false };
  }
  if (glyph?.sourceIndex !== undefined) {
    return { varGlyph, sourceIndex: glyph.sourceIndex, atSource: true };
  }
  let sourceIndex;
  try {
    sourceIndex = varGlyph.findNearestSourceForSourceLocation?.(location ?? {}, true);
  } catch (e) {
    sourceIndex = undefined;
  }
  return { varGlyph, sourceIndex: sourceIndex ?? 0, atSource: false };
}

/**
 * The index of the glyph's source at the default location (the source whose
 * cap and join all sources use).
 */
export function defaultSourceIndex(varGlyph) {
  if (!varGlyph?.sources?.length) {
    return undefined;
  }
  try {
    const location = varGlyph.getDenseDefaultSourceLocation?.() ?? {};
    const index = varGlyph.findNearestSourceForSourceLocation?.(location, true);
    if (index !== undefined) {
      return index;
    }
  } catch (e) {
    // fall through
  }
  return 0;
}

/**
 * The style a glyph is stroked with: an offset style, or a nib style (with
 * type "nib", see nibStyleInGlyph() in stroke-data.js). Its `points` hold the
 * values of the points of the glyph's path (per contour and point index,
 * undefined for points without values), when any point has values.
 */
export function strokeStyleForGlyph(positionedGlyph, location) {
  // The style depends on the glyph's data and the location only; Fontra makes
  // a new glyph instance (positionedGlyph.glyph) whenever the glyph's data
  // changes, so the style is kept with the instance. A copy is returned, so
  // that a caller changing it does not change the one kept.
  const instance = positionedGlyph?.glyph;
  const key = JSON.stringify(location ?? null);
  const kept =
    instance && typeof instance === "object" ? styleCache.get(instance) : null;
  if (kept?.has(key)) {
    const style = kept.get(key);
    return style ? { ...style } : style;
  }
  const style = computeStrokeStyle(positionedGlyph, location);
  if (instance && typeof instance === "object") {
    if (!kept) {
      styleCache.set(instance, new Map([[key, style]]));
    } else {
      kept.set(key, style);
    }
  }
  return style ? { ...style } : style;
}

const styleCache = new WeakMap();

function computeStrokeStyle(positionedGlyph, location) {
  const { varGlyph, sourceIndex, atSource } = findStrokeSource(
    positionedGlyph,
    location
  );
  const sources = varGlyph?.sources ?? [];
  const defaultIndex = defaultSourceIndex(varGlyph);
  if (getGlyphStroke(varGlyph?.glyph?.customData).type === "nib") {
    const style = nibStyleInGlyph(
      sources[sourceIndex]?.customData,
      varGlyph?.glyph?.customData
    );
    const path = positionedGlyph?.glyph?.path;
    if (!(atSource && sourceIndex === defaultIndex)) {
      // The nib turns the same way round as in the default source
      const references = nibAngleReferences(varGlyph, defaultIndex, path);
      if (references) {
        style.angleReferences = references;
      }
    }
    const interpolated = atSource
      ? null
      : interpolateNib(varGlyph, location, path, defaultIndex);
    if (interpolated) {
      Object.assign(style, interpolated.numbers);
      if (interpolated.points) {
        style.points = interpolated.points;
      }
      return style;
    }
    // At a source, or when interpolating fails, the (nearest) source's
    // values; between sources its points correspond by index
    const points = sourcePointValues(
      varGlyph,
      sourceIndex,
      defaultIndex,
      atSource ? path : undefined
    );
    if (points) {
      style.points = points;
    }
    return style;
  }
  const defaultCustomData = sources[defaultIndex]?.customData;
  const style = offsetStyleInGlyph(sources[sourceIndex]?.customData, defaultCustomData);
  const path = positionedGlyph?.glyph?.path;
  if (atSource) {
    const points = sourcePointValues(varGlyph, sourceIndex, defaultIndex, path);
    if (points) {
      style.points = points;
    }
  } else {
    const interpolated = interpolateStroke(varGlyph, location, path, defaultIndex);
    if (interpolated) {
      Object.assign(style, interpolated.numbers);
      if (interpolated.points) {
        style.points = interpolated.points;
      }
    }
  }
  return style;
}

/**
 * The numeric offset values at a location between sources, interpolated with
 * the glyph's own variation model, or null when that fails.
 */
/**
 * The angles of the default source's points as its nib takes them along each
 * contour (see nibAngleReference() in geometry/nib.js), for a path with the
 * same contours and points; undefined where the default source's contours
 * differ.
 * @returns {((number|undefined)[]|undefined)[]|undefined} by contour index
 */
export function nibAngleReferences(varGlyph, defaultIndex, path) {
  const source = varGlyph?.sources?.[defaultIndex];
  const defaultPath = layerPath(varGlyph, source);
  if (!path || !defaultPath) {
    return undefined;
  }
  const style = nibStyleInGlyph(source.customData, varGlyph?.glyph?.customData);
  const values = resolvePointValues(pathPoints(defaultPath), source.customData);
  const references = [];
  for (let index = 0; index < path.numContours; index++) {
    const info = path.contourInfo[index];
    const defaultInfo = defaultPath.contourInfo?.[index];
    const length = info.endPoint - (path.contourInfo[index - 1]?.endPoint ?? -1);
    const defaultLength =
      defaultInfo &&
      defaultInfo.endPoint - (defaultPath.contourInfo[index - 1]?.endPoint ?? -1);
    if (
      !defaultInfo ||
      defaultInfo.isClosed !== info.isClosed ||
      length !== defaultLength
    ) {
      references.push(undefined);
      continue;
    }
    try {
      const contour = defaultPath.getUnpackedContour(index);
      contour.points.forEach((point, i) => {
        point.values = values[index]?.[i];
      });
      references.push(nibAngleReference(contour, style));
    } catch (e) {
      // A contour being drawn can be malformed for a moment
      references.push(undefined);
    }
  }
  return references.some(Boolean) ? references : undefined;
}

export function interpolateOffsetNumbers(varGlyph, location) {
  return interpolateStroke(varGlyph, location)?.numbers ?? null;
}

/**
 * The values of the points of a source, with the joins of the default source
 * (by point index), or undefined when no point has values.
 * @param {object} [path] the source's path, when at hand
 */
export function sourcePointValues(varGlyph, sourceIndex, defaultIndex, path) {
  const source = varGlyph?.sources?.[sourceIndex];
  const usesDefaultJoins =
    sourceIndex !== defaultIndex &&
    hasPointValues(varGlyph?.sources?.[defaultIndex]?.customData);
  if (!source || (!hasPointValues(source.customData) && !usesDefaultJoins)) {
    return undefined;
  }
  const ownPath = path ?? layerPath(varGlyph, source);
  if (!ownPath) {
    return undefined;
  }
  const values = resolvePointValues(pathPoints(ownPath), source?.customData);
  if (sourceIndex !== defaultIndex) {
    applyDefaultJoins(values, varGlyph, defaultIndex, ownPath);
  }
  return values.some((contour) => contour.some(Boolean)) ? values : undefined;
}

// The joins of points, and which closed contours are centerlines, come from
// the default source, as cap and join do
function applyDefaultJoins(values, varGlyph, defaultIndex, path) {
  const source = varGlyph?.sources?.[defaultIndex];
  if (
    !hasPointValues(source?.customData) &&
    !values.some((c) => c.some((v) => SHARED_POINT_KEYS.some((key) => v?.[key])))
  ) {
    return;
  }
  const defaultPath = layerPath(varGlyph, source);
  const sameStructure = defaultPath && startsWithPointStructure(path, defaultPath);
  const defaults = sameStructure
    ? resolvePointValues(pathPoints(defaultPath), source.customData)
    : undefined;
  for (const [c, contour] of values.entries()) {
    for (const [i, own] of contour.entries()) {
      const shared = defaults?.[c]?.[i];
      if (SHARED_POINT_KEYS.every((key) => own?.[key] === shared?.[key])) {
        continue;
      }
      const next = { ...own };
      for (const key of SHARED_POINT_KEYS) {
        if (shared?.[key] === undefined) {
          delete next[key];
        } else {
          next[key] = shared[key];
        }
      }
      contour[i] = Object.keys(next).length ? next : undefined;
    }
  }
}

function emptyPointValues(path) {
  return pathPoints(path).map((contour) => contour.map(() => undefined));
}

/**
 * The numeric values at a location between sources, and the values of the
 * points of the path there, interpolated with the glyph's own variation model.
 *
 * A side of a point gets an interpolated width when any source sets it; the
 * width of a source that does not is the one its stroke has at that point.
 * Returns null when interpolating fails.
 * @param {object} [path] the glyph's path at the location; without it, only
 *   the numbers of the sources are interpolated
 * @returns {{numbers: object, points?: object[][]}|null}
 */
export function interpolateStroke(varGlyph, location, path, defaultIndex) {
  try {
    const model = varGlyph?.model;
    if (!model) {
      return null;
    }
    const sources = varGlyph.sources.filter((source) => !source.inactive);
    const styles = sources.map((source) => resolveOffsetStyle(source.customData));
    const vectors = styles.map((style) =>
      INTERPOLATED_OFFSET_KEYS.map((key) => style[key])
    );

    const pointPart = path ? pointVectors(varGlyph, sources, styles, path) : null;
    if (pointPart) {
      for (const [i, vector] of pointPart.vectors.entries()) {
        vectors[i].push(...vector);
      }
    }
    const sourceLocation = varGlyph.expandNLIAxes?.(location ?? {}) ?? location ?? {};
    const { instance } = model.interpolateFromDeltas(
      sourceLocation,
      model.getDeltas(vectors)
    );
    if (!Array.isArray(instance) || !instance.every(Number.isFinite)) {
      return null;
    }
    const numbers = Object.fromEntries(
      INTERPOLATED_OFFSET_KEYS.map((key, i) => [
        key,
        sanitizeOffsetValue(key, instance[i]),
      ])
    );
    if (!path) {
      return { numbers };
    }
    const points = pointPart
      ? pointPart.build(instance.slice(INTERPOLATED_OFFSET_KEYS.length))
      : emptyPointValues(path);
    applyDefaultJoins(
      points,
      varGlyph,
      defaultIndex ?? defaultSourceIndex(varGlyph),
      path
    );
    return points.some((contour) => contour.some(Boolean))
      ? { numbers, points }
      : { numbers };
  } catch (e) {
    return null;
  }
}

// The numbers of the points to interpolate, per source, and how to turn the
// interpolated numbers back into point values. Null when no source has point
// values or the sources' points do not correspond.
function pointVectors(varGlyph, sources, styles, path) {
  if (!sources.some((source) => hasPointValues(source.customData))) {
    return null;
  }
  const perSource = [];
  for (const [i, source] of sources.entries()) {
    const sourcePath = layerPath(varGlyph, source);
    if (!sourcePath || !startsWithPointStructure(path, sourcePath)) {
      return null;
    }
    const values = resolvePointValues(pathPoints(sourcePath), source.customData);
    perSource.push({ path: sourcePath, values, style: styles[i] });
  }
  // What is interpolated: per open contour and on-curve point, each side
  // that any source sets, and the miter limit if any source sets it
  const entries = [];
  const numContours = perSource[0].path.contourInfo.length;
  for (const [c, contour] of pathPoints(path).entries()) {
    if (c >= numContours) {
      continue;
    }
    for (const [i, point] of contour.entries()) {
      if (!point.onCurve) {
        continue;
      }
      const set = perSource.map(({ values }) => values[c][i]);
      for (const side of ["left", "right"]) {
        if (set.some((v) => pointHalfWidths(v)[side] !== undefined)) {
          entries.push({ c, i, key: side });
        }
      }
      if (set.some((v) => v?.miterLimit !== undefined)) {
        entries.push({ c, i, key: "miterLimit" });
      }
    }
  }
  if (!entries.length) {
    return null;
  }
  const vectors = perSource.map(({ path: sourcePath, values, style }) => {
    const profiles = new Map();
    const profile = (c) => {
      if (!profiles.has(c)) {
        const contour = sourcePath.getUnpackedContour(c);
        contour.points.forEach((point, i) => {
          point.values = values[c][i];
        });
        profiles.set(
          c,
          widthProfile(contour, centerlineSegments(contour), style, {
            pointsOnly: true,
          })
        );
      }
      return profiles.get(c);
    };
    return entries.map(({ c, i, key }) =>
      key === "miterLimit"
        ? (values[c][i]?.miterLimit ?? style.miterLimit)
        : (profile(c).atPoint(i)?.[key] ?? style.width / 2)
    );
  });
  const build = (numbers) => {
    const points = path.contourInfo.map((contour, c) =>
      new Array(
        contour.endPoint + 1 - (c ? path.contourInfo[c - 1].endPoint + 1 : 0)
      ).fill(undefined)
    );
    for (const [k, { c, i, key }] of entries.entries()) {
      const value = sanitizeOffsetValue(key, numbers[k]);
      points[c][i] = { ...points[c][i], [key]: value };
    }
    return points;
  };
  return { vectors, build };
}

/**
 * The nib numbers at a location between sources, and the nib values of the
 * points of the path there, interpolated with the glyph's own variation
 * model. Before interpolating, every angle is turned by half turns to be
 * within 90° of the default source's (at the same point, for points), so
 * that the nib turns the short way from it.
 *
 * A point gets an interpolated number when any source sets it; the number
 * of a source that does not is the one its nib has at that point. Returns
 * null when interpolating fails.
 * @param {object} [path] the glyph's path at the location
 * @returns {{numbers: object, points?: object[][]}|null}
 */
export function interpolateNib(varGlyph, location, path, defaultIndex) {
  try {
    const model = varGlyph?.model;
    if (!model) {
      return null;
    }
    const sources = varGlyph.sources.filter((source) => !source.inactive);
    const defaultSource =
      varGlyph.sources[defaultIndex ?? defaultSourceIndex(varGlyph)] ?? sources[0];
    const reference = resolveNibStyle(defaultSource?.customData);
    const styles = sources.map((source) => resolveNibStyle(source.customData));
    const vectors = styles.map((style) =>
      NIB_KEYS.map((key) =>
        key === "angle" ? nearestNibAngle(style.angle, reference.angle) : style[key]
      )
    );
    const pointPart = path
      ? nibPointVectors(varGlyph, sources, styles, path, sources.indexOf(defaultSource))
      : null;
    if (pointPart) {
      for (const [i, vector] of pointPart.vectors.entries()) {
        vectors[i].push(...vector);
      }
    }
    const sourceLocation = varGlyph.expandNLIAxes?.(location ?? {}) ?? location ?? {};
    const { instance } = model.interpolateFromDeltas(
      sourceLocation,
      model.getDeltas(vectors)
    );
    if (!Array.isArray(instance) || !instance.every(Number.isFinite)) {
      return null;
    }
    const numbers = Object.fromEntries(
      NIB_KEYS.map((key, i) => [key, sanitizeNibValue(key, instance[i])])
    );
    if (!path) {
      return { numbers };
    }
    const points = pointPart
      ? pointPart.build(instance.slice(NIB_KEYS.length))
      : emptyPointValues(path);
    applyDefaultJoins(
      points,
      varGlyph,
      defaultIndex ?? defaultSourceIndex(varGlyph),
      path
    );
    return points.some((contour) => contour.some(Boolean))
      ? { numbers, points }
      : { numbers };
  } catch (e) {
    return null;
  }
}

// As pointVectors(), for the nib numbers of points
function nibPointVectors(varGlyph, sources, styles, path, defaultPosition) {
  if (!sources.some((source) => hasPointValues(source.customData))) {
    return null;
  }
  const perSource = [];
  for (const [i, source] of sources.entries()) {
    const sourcePath = layerPath(varGlyph, source);
    if (!sourcePath || !startsWithPointStructure(path, sourcePath)) {
      return null;
    }
    const values = resolvePointValues(pathPoints(sourcePath), source.customData);
    perSource.push({ path: sourcePath, values, style: styles[i] });
  }
  const entries = [];
  const numContours = perSource[0].path.contourInfo.length;
  for (const [c, contour] of pathPoints(path).entries()) {
    if (c >= numContours) {
      continue;
    }
    for (const [i, point] of contour.entries()) {
      if (!point.onCurve) {
        continue;
      }
      const set = perSource.map(({ values }) => values[c][i]);
      for (const key of NIB_KEYS) {
        if (set.some((v) => v?.[key] !== undefined)) {
          entries.push({ c, i, key });
        }
      }
    }
  }
  if (!entries.length) {
    return null;
  }
  const atPoints = perSource.map(({ path: sourcePath, values, style }) => {
    const profiles = new Map();
    const profile = (c) => {
      if (!profiles.has(c)) {
        const contour = sourcePath.getUnpackedContour(c);
        contour.points.forEach((point, i) => {
          point.values = values[c][i];
        });
        profiles.set(c, nibProfile(contour, style));
      }
      return profiles.get(c);
    };
    return entries.map(({ c, i, key }) => profile(c).atPoint(i)?.[key] ?? style[key]);
  });
  const references = atPoints[defaultPosition] ?? atPoints[0];
  const vectors = atPoints.map((numbers) =>
    numbers.map((number, k) =>
      entries[k].key === "angle" ? nearestNibAngle(number, references[k]) : number
    )
  );
  const build = (numbers) => {
    const points = path.contourInfo.map((contour, c) =>
      new Array(
        contour.endPoint + 1 - (c ? path.contourInfo[c - 1].endPoint + 1 : 0)
      ).fill(undefined)
    );
    for (const [k, { c, i, key }] of entries.entries()) {
      points[c][i] = { ...points[c][i], [key]: sanitizeNibValue(key, numbers[k]) };
    }
    return points;
  };
  return { vectors, build };
}

/**
 * The nib numbers at the points of a centerline (see valueProfile() in
 * widths.js; atPoint() only).
 * @param {{points: object[], isClosed: boolean}} contour unpacked, with the
 *   points' values
 * @param {{major: number, minor: number, angle: number}} style
 */
export function nibProfile(contour, style) {
  const segments = centerlineSegments(contour);
  return valueProfile(contour, segments, {
    pointsOnly: true,
    keys: NIB_KEYS,
    defaults: { major: style.major, minor: style.minor, angle: style.angle },
    periods: { angle: 180 },
    shifts: { angle: nibAngleShifts(contour, segments) },
  });
}

/**
 * Whether any closed contour of a glyph is marked as a centerline (in its
 * default source, which decides it for all sources).
 */
export function hasClosedCenterlines(varGlyph) {
  const source = varGlyph?.sources?.[defaultSourceIndex(varGlyph)];
  const { points } = getSourceStroke(source?.customData);
  return Object.values(points).some((values) => values?.centerline === true);
}

function hasPointValues(customData) {
  return Object.keys(getSourceStroke(customData).points).length > 0;
}

/** The path of a source's layer. */
export function layerPath(varGlyph, source) {
  if (!source) {
    return undefined;
  }
  const layers = varGlyph?.layers ?? varGlyph?.glyph?.layers;
  return layers?.[source.layerName]?.glyph?.path;
}

/**
 * What the settings panel shows for the selected glyph, or null when no glyph
 * is selected.
 * @returns {null | {glyphName: string, sourceIndex: number|undefined,
 *   sourceName: string, atSource: boolean, defaultSourceIndex: number|undefined,
 *   isDefaultSource: boolean, method: string, shape?: string, stored: object,
 *   style: object}}
 *   stored holds the source's own default values; style the values in use
 *   (interpolated between sources, with built-in defaults filled in)
 */
export function describeStrokeSource(positionedGlyph, location) {
  if (!positionedGlyph?.glyphName) {
    return null;
  }
  const { varGlyph, sourceIndex, atSource } = findStrokeSource(
    positionedGlyph,
    location
  );
  const source = varGlyph?.sources?.[sourceIndex];
  const defaultIndex = defaultSourceIndex(varGlyph);
  const { type: method, shape } = getGlyphStroke(varGlyph?.glyph?.customData);
  return {
    glyphName: positionedGlyph.glyphName,
    sourceIndex,
    sourceName: atSource ? sourceDisplayName(varGlyph, source) : "",
    atSource,
    defaultSourceIndex: defaultIndex,
    defaultSourceName: sourceDisplayName(varGlyph, varGlyph?.sources?.[defaultIndex]),
    isDefaultSource: atSource && sourceIndex === defaultIndex,
    method,
    shape,
    stored: getSourceStroke(source?.customData).defaults,
    style:
      strokeStyleForGlyph(positionedGlyph, location) ??
      resolveOffsetStyle(source?.customData),
  };
}

function sourceDisplayName(varGlyph, source) {
  if (!source) {
    return "";
  }
  let name;
  try {
    name = varGlyph.getSourceName?.(source);
  } catch (e) {
    name = undefined;
  }
  return name || source.name || source.layerName || "";
}
