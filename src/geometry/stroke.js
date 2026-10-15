// Stroking a centerline with the method of its style. No Fontra or DOM
// dependencies.

import { strokeNibContour } from "./nib.js";
import { strokeOffsetContour } from "./offset.js";

/**
 * @param {{points: object[], isClosed: boolean}} contour unpacked contour
 * @param {object} style an offset style (see offsetStyleInGlyph() in
 *   stroke-data.js), or a nib style with type "nib" (see nibStyleInGlyph())
 * @param {object} [options] see strokeOffsetContour() in offset.js
 * @returns {{contours: object[], edges: object[], layout: object,
 *   twists: object[], layoutMismatch: boolean}} see strokeOffsetContour()
 */
export function strokeContour(contour, style, options) {
  return style?.type === "nib"
    ? strokeNibContour(contour, style, options)
    : strokeOffsetContour(contour, style, options);
}
