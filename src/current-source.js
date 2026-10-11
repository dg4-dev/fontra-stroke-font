// Which source's stroke values apply to a glyph shown in the editor.
//
// At a source location, that source's values are used. Elsewhere (between
// sources) phase 1 uses the nearest source; interpolating the values between
// sources comes with the weight axis (#8).

import { getGlyphStroke, getSourceStroke, resolveOffsetStyle } from "./stroke-data.js";

/**
 * @param {object} positionedGlyph an entry of Fontra's positioned lines
 * @param {object} [location] the glyph's source location, for finding the
 *   nearest source when the glyph is not at a source
 * @returns {{varGlyph: object|undefined, sourceIndex: number|undefined,
 *   atSource: boolean}}
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
 * The offset style for a glyph, or null when the glyph is stroked another way
 * (the nib method comes in phase 4).
 */
export function strokeStyleForGlyph(positionedGlyph, location) {
  const { varGlyph, sourceIndex } = findStrokeSource(positionedGlyph, location);
  if (getGlyphStroke(varGlyph?.glyph?.customData).type !== "offset") {
    return null;
  }
  return resolveOffsetStyle(varGlyph?.sources?.[sourceIndex]?.customData);
}

/**
 * What the settings panel shows for the selected glyph, or null when no glyph
 * is selected.
 * @returns {null | {glyphName: string, sourceIndex: number|undefined,
 *   sourceName: string, atSource: boolean, method: string, stored: object,
 *   style: object}} stored holds the source's own default values, style the
 *   values in use (with the built-in defaults filled in)
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
  return {
    glyphName: positionedGlyph.glyphName,
    sourceIndex,
    sourceName: sourceDisplayName(varGlyph, source),
    atSource,
    method: getGlyphStroke(varGlyph?.glyph?.customData).type,
    stored: getSourceStroke(source?.customData).defaults,
    style: resolveOffsetStyle(source?.customData),
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
