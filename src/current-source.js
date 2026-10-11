// Which stroke values apply to a glyph shown in the editor.
//
// At a source location, that source's numbers are used. Between sources, the
// numbers are interpolated the same way Fontra interpolates the outlines.
// Cap and join always come from the default source (see stroke-data.js).

import {
  INTERPOLATED_OFFSET_KEYS,
  getGlyphStroke,
  getSourceStroke,
  offsetStyleInGlyph,
  resolveOffsetStyle,
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
 * (the nib method comes in phase 4).
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
  const defaultCustomData = sources[defaultSourceIndex(varGlyph)]?.customData;
  const style = offsetStyleInGlyph(sources[sourceIndex]?.customData, defaultCustomData);
  if (!atSource) {
    Object.assign(style, interpolateOffsetNumbers(varGlyph, location) ?? {});
  }
  return style;
}

/**
 * The numeric offset values at a location between sources, interpolated with
 * the glyph's own variation model, or null when that fails.
 */
export function interpolateOffsetNumbers(varGlyph, location) {
  try {
    const model = varGlyph?.model;
    if (!model) {
      return null;
    }
    const values = varGlyph.sources
      .filter((source) => !source.inactive)
      .map((source) => {
        const style = resolveOffsetStyle(source.customData);
        return INTERPOLATED_OFFSET_KEYS.map((key) => style[key]);
      });
    const sourceLocation = varGlyph.expandNLIAxes?.(location ?? {}) ?? location ?? {};
    const { instance } = model.interpolateFromDeltas(
      sourceLocation,
      model.getDeltas(values)
    );
    if (!Array.isArray(instance) || !instance.every(Number.isFinite)) {
      return null;
    }
    return Object.fromEntries(
      INTERPOLATED_OFFSET_KEYS.map((key, i) => [
        key,
        sanitizeOffsetValue(key, instance[i]),
      ])
    );
  } catch (e) {
    return null;
  }
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
