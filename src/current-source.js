// Which source's stroke values apply to a glyph shown in the editor.
//
// At a source location, that source's values are used. Elsewhere (between
// sources) phase 1 uses the nearest source; interpolating the values between
// sources comes with the weight axis (#8).

import { getGlyphStroke, resolveOffsetStyle } from "./stroke-data.js";

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
