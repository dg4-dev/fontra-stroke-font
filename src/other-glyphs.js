// The other glyphs of the text (those not being edited) are drawn by
// Fontra's own visualization layers, which fill the glyph's flattened path.
// A canvas closes an open contour when filling it, so a centerline would be
// filled as a polygon. These layers are wrapped here: for a glyph with open
// contours they get, instead of the flattened path, the closed contours plus
// the stroked shapes, so the glyph looks like the exported one.

import { hasOpenContours, strokeGlyph } from "./glyph-strokes.js";
import { appendContour } from "./stroke-layer.js";

// Fontra's layers that draw glyph.flattenedPath2d of other glyphs
export const WRAPPED_LAYER_IDENTIFIERS = Object.freeze([
  "fontra.context.glyphs",
  "fontra.selected.glyph",
  "fontra.hovered.glyph",
  "fontra.all.glyphs",
]);

const ORIGINAL_DRAW = Symbol("stroke-font original draw");

/**
 * Wrap the draw functions of Fontra's glyph layers, in place. Layers wrapped
 * before (the plugin started twice) are not wrapped again.
 * @param {object[]} definitions editor.visualizationLayers.definitions
 * @param {(positionedGlyph: object, model: object) => object|null} expandGlyph
 *   returns the glyph to draw instead, or null to draw the glyph as it is
 * @returns {number} how many layers were wrapped
 */
export function wrapGlyphLayers(definitions, expandGlyph) {
  let count = 0;
  for (const [index, definition] of definitions.entries()) {
    if (!WRAPPED_LAYER_IDENTIFIERS.includes(definition.identifier)) {
      continue;
    }
    const original = definition[ORIGINAL_DRAW] ?? definition.draw;
    definitions[index] = {
      ...definition,
      [ORIGINAL_DRAW]: original,
      draw: (args) => {
        let glyph = null;
        try {
          glyph = expandGlyph(args.positionedGlyph, args.model);
        } catch (e) {
          console.error("[stroke-font] could not stroke a glyph", e);
        }
        original(
          glyph
            ? { ...args, positionedGlyph: { ...args.positionedGlyph, glyph } }
            : args
        );
      },
    };
    count++;
  }
  return count;
}

/**
 * A function for wrapGlyphLayers(): the glyph with its open contours (and
 * those of its components) replaced by their stroked shapes.
 * @param {object} settings display settings (see settings.js)
 * @param {object} componentGlyphs see glyph-strokes.js
 */
export function makeGlyphExpander(settings, componentGlyphs) {
  return (positionedGlyph, model) => {
    const glyph = positionedGlyph?.glyph;
    if (!settings.get("otherGlyphs") || !glyph) {
      return null;
    }
    const components = glyph.components ?? [];
    if (
      !hasOpenContours(glyph.path) &&
      !components.some((c) => hasOpenContours(c.path))
    ) {
      return null;
    }
    const location = model?.getLocationForGlyph?.(positionedGlyph.glyphName);
    const { outlines } = strokeGlyph(positionedGlyph, location, componentGlyphs);
    const path2d = new Path2D();
    drawClosedContours(path2d, glyph.path);
    for (const component of components) {
      drawClosedContours(path2d, component.path);
    }
    for (const contour of outlines) {
      appendContour(path2d, contour);
    }
    // Everything else (errors, bounds, ...) still comes from the glyph
    return Object.create(glyph, { flattenedPath2d: { value: path2d } });
  };
}

function drawClosedContours(path2d, path) {
  for (const [index, contour] of (path?.contourInfo ?? []).entries()) {
    if (contour.isClosed) {
      path.drawContourToPath2d(path2d, index);
    }
  }
}
