// Stroking a centerline with the method of its style. No Fontra or DOM
// dependencies.
//
// Corners with a radius are rounded first (see corners.js), for both
// methods; the methods stroke the rounded centerline.

import { roundCorners } from "./corners.js";
import { strokeNibContour } from "./nib.js";
import { strokeOffsetContour } from "./offset.js";

/**
 * @param {{points: object[], isClosed: boolean}} contour unpacked contour
 * @param {object} style an offset style (see offsetStyleInGlyph() in
 *   stroke-data.js), or a nib style with type "nib" (see nibStyleInGlyph())
 * @param {object} [options] see strokeOffsetContour() in offset.js; its
 *   angleReference is by the point indices of the contour
 * @returns {object} what the method returns (see strokeOffsetContour()),
 *   and corners: the rounded corners (see roundCorners() in corners.js)
 */
export function strokeContour(contour, style, options) {
  const rounded = roundCorners(contour);
  let methodOptions = options;
  if (rounded.pointIndices && options?.angleReference) {
    // The points of the rounded centerline, by the points they come from
    const reference = options.angleReference;
    methodOptions = {
      ...options,
      angleReference: rounded.pointIndices.map((index) =>
        index === undefined ? undefined : reference[index]
      ),
    };
  }
  const result =
    style?.type === "nib"
      ? strokeNibContour(rounded.contour, style, methodOptions)
      : strokeOffsetContour(rounded.contour, style, methodOptions);
  return { ...result, corners: rounded.corners };
}
