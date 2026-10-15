// What other plugins can use: the stroked shapes of a glyph and the edges of
// their bands, computed the same way as the preview and the CLI. No DOM
// dependencies.
//
// start.js registers the functions on globalThis.fontraStrokeFont, for
// plugins loaded in the same editor. strokeGlyphSource() needs no editor, so
// it can also be imported from this module (by URL in a browser, or from a
// copy of the repository in Node.js). See docs/api.md.
//
// Compatibility: apiVersion goes up when something is added. Functions and
// the fields of their results stay as they are in later versions; a change
// that would break a call gets a new function instead.

import { nibAngleReference } from "./geometry/nib.js";
import { strokeContour } from "./geometry/stroke.js";
import { strokeGlyph } from "./glyph-strokes.js";
import {
  getGlyphStroke,
  isCenterlineContour,
  nibStyleInGlyph,
  offsetStyleInGlyph,
  resolvePointValues,
  withSharedPointValues,
} from "./stroke-data.js";

export const API_VERSION = 1;

/** The name of the registration on globalThis. */
export const GLOBAL_NAME = "fontraStrokeFont";

/**
 * The stroked shapes of a glyph shown in the editor: its own centerlines and
 * those inside its components, with the values at its location (between
 * sources too), as the preview draws them.
 * @param {object} positionedGlyph an entry of Fontra's positioned lines
 * @param {object} [location] the glyph's location (sceneModel's
 *   getLocationForGlyph()), needed when the glyph is between sources
 * @param {object} [componentGlyphs] see ComponentGlyphs in glyph-strokes.js
 * @returns {{outlines: object[], edges: object[], twists: object[],
 *   centerlines: number[]}} see docs/api.md; copies, which the caller may
 *   change
 */
export function strokePositionedGlyph(positionedGlyph, location, componentGlyphs) {
  const stroked = strokeGlyph(positionedGlyph, location, componentGlyphs);
  const path = positionedGlyph?.glyph?.path;
  const centerlines = [];
  for (const [index, info] of (path?.contourInfo ?? []).entries()) {
    if (!info.isClosed || stroked.strokedClosed.own.has(index)) {
      centerlines.push(index);
    }
  }
  const edges = [...stroked.edges];
  for (const [componentIndex, componentEdges] of stroked.componentEdges) {
    edges.push(...componentEdges.map((edge) => ({ ...edge, componentIndex })));
  }
  // The results are kept for the preview; the caller gets copies
  return structuredClone({
    outlines: stroked.outlines,
    edges,
    twists: stroked.twists.map(publicTwist),
    centerlines,
  });
}

/**
 * The stroked shapes of one source of a glyph, from its contours and the
 * stroke values in its customData, without Fontra: for a glyph read from a
 * file. As the preview at that source, and as the CLI for a font with a
 * single source.
 * @param {object} input
 * @param {{points: object[], isClosed: boolean}[]} input.contours all
 *   contours of the source's glyph, in Fontra's unpacked form ({x, y, type?,
 *   smooth?, attrs?: {identifier}}; identifier may be on the point itself)
 * @param {object} [input.customData] the source's customData (in a UFO, the
 *   glyph's lib key xyz.fontra.glyph.source.customData)
 * @param {object} [input.glyphCustomData] the glyph's customData (in a UFO,
 *   the lib key xyz.fontra.customData of the glyph in the default source)
 * @param {{contours: object[], customData?: object}} [input.defaultSource]
 *   the glyph's default source, when this is another one: its cap and join,
 *   the joins of its points, its marks of closed contours as centerlines and
 *   the way its nib turns apply to all sources
 * @param {number} [input.tolerance] see DEFAULT_TOLERANCE in
 *   geometry/offset.js
 * @returns {{outlines: object[], edges: object[], twists: object[],
 *   centerlines: number[]}} see docs/api.md
 */
export function strokeGlyphSource({
  contours,
  customData,
  glyphCustomData,
  defaultSource,
  tolerance,
} = {}) {
  const ownValues = pointValues(contours, customData);
  const defaultContours = defaultSource ? defaultSource.contours : contours;
  const defaultCustomData = defaultSource ? defaultSource.customData : customData;
  // The values all sources share come from the default source when its
  // contours match; otherwise each source keeps its own, as in the CLI
  const matches = !!defaultSource && sameContours(contours, defaultContours);
  const defaultValues = matches
    ? pointValues(defaultContours, defaultCustomData)
    : undefined;
  const values = matches
    ? ownValues.map((contour, c) =>
        contour.map((own, i) => withSharedPointValues(own, defaultValues[c][i]))
      )
    : ownValues;
  const isNib = getGlyphStroke(glyphCustomData).type === "nib";
  const style = isNib
    ? nibStyleInGlyph(customData, glyphCustomData)
    : offsetStyleInGlyph(customData, defaultCustomData);
  // The nib turns the same way round as in the default source
  const defaultStyle =
    isNib && matches ? nibStyleInGlyph(defaultCustomData, glyphCustomData) : undefined;

  const result = { outlines: [], edges: [], twists: [], centerlines: [] };
  for (const [contourIndex, contour] of contours.entries()) {
    if (!isCenterlineContour(contour.isClosed, values[contourIndex])) {
      continue;
    }
    const angleReference = defaultStyle
      ? nibAngleReference(
          withValues(defaultContours[contourIndex], defaultValues[contourIndex]),
          defaultStyle
        )
      : undefined;
    const stroked = strokeContour(withValues(contour, values[contourIndex]), style, {
      tolerance,
      angleReference,
    });
    result.outlines.push(...stroked.contours);
    result.edges.push(...stroked.edges.map((edge) => ({ ...edge, contourIndex })));
    result.twists.push(
      ...stroked.twists.map((twist) => publicTwist({ ...twist, contourIndex }))
    );
    result.centerlines.push(contourIndex);
  }
  return result;
}

/**
 * The object registered on globalThis: the functions above, which never
 * throw (on bad input they log the error and return an empty result).
 * @param {object} [componentGlyphs] see ComponentGlyphs in glyph-strokes.js
 */
export function makeApi(componentGlyphs) {
  return Object.freeze({
    apiVersion: API_VERSION,
    strokePositionedGlyph: guarded((positionedGlyph, location) =>
      strokePositionedGlyph(positionedGlyph, location, componentGlyphs)
    ),
    strokeGlyphSource: guarded((input) => strokeGlyphSource(input)),
  });
}

/**
 * Register the functions on globalThis.fontraStrokeFont, for the other
 * plugins of the editor. A registration with a higher apiVersion (another
 * copy of the plugin, a later version) is kept: it has all that this one has.
 * The registration lasts as long as the page: after the plugin is removed,
 * the editor is reloaded without it.
 * @returns {object|undefined} the registration in place
 */
export function registerApi(componentGlyphs, target = globalThis) {
  try {
    const existing = target[GLOBAL_NAME];
    if (!(existing?.apiVersion > API_VERSION)) {
      target[GLOBAL_NAME] = makeApi(componentGlyphs);
    }
    return target[GLOBAL_NAME];
  } catch (e) {
    console.error(
      "[stroke-font] could not register the functions for other plugins",
      e
    );
    return undefined;
  }
}

function guarded(fn) {
  return (...args) => {
    try {
      return fn(...args);
    } catch (e) {
      console.error("[stroke-font] could not stroke the glyph for another plugin", e);
      return { outlines: [], edges: [], twists: [], centerlines: [] };
    }
  };
}

// A twist as other plugins get it: where, on which side, in which contour
function publicTwist({ point, side, contourIndex }) {
  return { point: { x: point.x, y: point.y }, side, contourIndex };
}

// The values of the points of plain contours, found by their identifiers
function pointValues(contours, customData) {
  return resolvePointValues(
    contours.map((contour) =>
      contour.points.map((point) => ({
        identifier: point.attrs?.identifier ?? point.identifier,
        onCurve: !point.type,
      }))
    ),
    customData
  );
}

// Whether two lists of contours have the same contours with the same
// numbers of points, so that their points correspond by index
function sameContours(a, b) {
  return (
    Array.isArray(b) &&
    a.length === b.length &&
    a.every(
      (contour, i) =>
        contour.isClosed === b[i].isClosed &&
        contour.points.length === b[i].points.length
    )
  );
}

// A contour with the values of its points, as the stroke methods take it
function withValues(contour, values) {
  return {
    points: contour.points.map((point, i) =>
      values?.[i] ? { ...point, values: values[i] } : { ...point }
    ),
    isClosed: !!contour.isClosed,
  };
}
