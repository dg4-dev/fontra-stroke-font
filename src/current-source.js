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
import { widthProfile } from "./geometry/widths.js";
import { pathPoints, startsWithPointStructure } from "./path-points.js";
import {
  INTERPOLATED_OFFSET_KEYS,
  getGlyphStroke,
  getSourceStroke,
  offsetStyleInGlyph,
  SHARED_POINT_KEYS,
  pointHalfWidths,
  resolveOffsetStyle,
  resolvePointValues,
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
 * The offset style for a glyph, or null when the glyph is stroked another way
 * (the nib method comes in phase 4). Its `points` hold the values of the
 * points of the glyph's path (per contour and point index, undefined for
 * points without values), when any point has values.
 */
export function strokeStyleForGlyph(positionedGlyph, location) {
  const { varGlyph, sourceIndex, atSource } = findStrokeSource(
    positionedGlyph,
    location
  );
  if (getGlyphStroke(varGlyph?.glyph?.customData).type !== "offset") {
    return null;
  }
  const sources = varGlyph?.sources ?? [];
  const defaultIndex = defaultSourceIndex(varGlyph);
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
        profiles.set(c, widthProfile(contour, centerlineSegments(contour), style));
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
 *   isDefaultSource: boolean, method: string, stored: object, style: object}}
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
  const method = getGlyphStroke(varGlyph?.glyph?.customData).type;
  return {
    glyphName: positionedGlyph.glyphName,
    sourceIndex,
    sourceName: atSource ? sourceDisplayName(varGlyph, source) : "",
    atSource,
    defaultSourceIndex: defaultIndex,
    defaultSourceName: sourceDisplayName(varGlyph, varGlyph?.sources?.[defaultIndex]),
    isDefaultSource: atSource && sourceIndex === defaultIndex,
    method,
    stored: getSourceStroke(source?.customData).defaults,
    style:
      method === "offset"
        ? strokeStyleForGlyph(positionedGlyph, location)
        : resolveOffsetStyle(source?.customData),
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
