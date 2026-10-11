// The other glyphs of the text (those not being edited) are drawn by
// Fontra's own visualization layers, which fill the glyph's flattened path.
// A canvas closes an open contour when filling it, so a centerline would be
// filled as a polygon. These layers are wrapped here: for a glyph with open
// contours they get, instead of the flattened path, the closed contours plus
// the stroked shapes, so the glyph looks like the exported one.
//
// Fontra also takes a glyph whose contours all have two points or less for an
// empty glyph: it leaves it out of the selected and hovered glyph layers and
// draws a placeholder (its character, and a grey box when it is selected or
// hovered) instead. A glyph of straight two-point centerlines is not empty, so
// for glyphs with open contours those layers draw it and the placeholder
// layers do not.

import { hasOpenContours, strokeGlyph } from "./glyph-strokes.js";
import { appendContour } from "./stroke-layer.js";

// Fontra's layers that draw glyph.flattenedPath2d of other glyphs
export const WRAPPED_LAYER_IDENTIFIERS = Object.freeze([
  "fontra.context.glyphs",
  "fontra.selected.glyph",
  "fontra.hovered.glyph",
  "fontra.all.glyphs",
]);

// Layers that leave out empty glyphs, and those that draw placeholders for them
const EMPTY_FILTERED_LAYER_IDENTIFIERS = Object.freeze([
  "fontra.selected.glyph",
  "fontra.hovered.glyph",
]);
export const PLACEHOLDER_LAYER_IDENTIFIERS = Object.freeze([
  "fontra.undefined.glyph",
  "fontra.empty.selected.glyph",
  "fontra.empty.hovered.glyph",
]);

const ORIGINAL_DRAW = Symbol("stroke-font original draw");
const ORIGINAL_FILTER = Symbol("stroke-font original selection filter");

/**
 * Wrap the draw functions of Fontra's glyph layers, in place. Layers wrapped
 * before (the plugin started twice) are not wrapped again.
 * @param {object[]} definitions editor.visualizationLayers.definitions
 * @param {(positionedGlyph: object, model: object) => object|null} expandGlyph
 *   returns the glyph to draw instead, or null to draw the glyph as it is
 * @param {(positionedGlyph: object) => boolean} [isStroked] whether a glyph
 *   is drawn with its stroked shapes (then it is not empty)
 * @returns {number} how many layers were wrapped
 */
export function wrapGlyphLayers(definitions, expandGlyph, isStroked = () => false) {
  let count = 0;
  for (let index = 0; index < definitions.length; index++) {
    let definition = definitions[index];
    if (PLACEHOLDER_LAYER_IDENTIFIERS.includes(definition.identifier)) {
      definitions[index] = withFilter(
        definition,
        (original) => (positionedGlyph) =>
          original(positionedGlyph) &&
          (positionedGlyph.isUndefined || !isStroked(positionedGlyph))
      );
      continue;
    }
    if (!WRAPPED_LAYER_IDENTIFIERS.includes(definition.identifier)) {
      continue;
    }
    if (EMPTY_FILTERED_LAYER_IDENTIFIERS.includes(definition.identifier)) {
      definitions[index] = withFilter(
        definition,
        (original) => (positionedGlyph) =>
          original(positionedGlyph) || isStroked(positionedGlyph)
      );
    }
    definition = definitions[index];
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

// A copy of a layer definition with its selection filter wrapped (the
// original one, when the layer was wrapped before)
function withFilter(definition, wrap) {
  const original =
    definition[ORIGINAL_FILTER] ?? definition.selectionFilter ?? (() => true);
  return {
    ...definition,
    [ORIGINAL_FILTER]: original,
    selectionFilter: wrap(original),
  };
}

/**
 * Whether a glyph of the text is drawn with stroked shapes: it or one of its
 * components has open contours, and the setting is on.
 */
export function makeStrokedTest(settings) {
  return (positionedGlyph) => {
    const glyph = positionedGlyph?.glyph;
    return (
      !!glyph &&
      !!settings.get("otherGlyphs") &&
      (hasOpenContours(glyph.path) ||
        (glyph.components ?? []).some((c) => hasOpenContours(c.path)))
    );
  };
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
