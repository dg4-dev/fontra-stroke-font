// The stroked shapes of a glyph shown in the editor: its own open contours,
// and the open contours inside its components, each stroked with the values
// of the glyph they belong to.
//
// Results are kept per path object and reused as long as the path's points
// and the values stay the same, so that redrawing many glyphs (the text
// around the glyph being edited) does not stroke them all again.

import { strokeStyleForGlyph } from "./current-source.js";
import { strokeOffsetContour } from "./geometry/offset.js";

/**
 * Variable glyphs of component bases. Fontra loads glyphs asynchronously, so
 * a base glyph is requested the first time it is needed, and the canvas is
 * redrawn once it is there.
 */
export class ComponentGlyphs {
  constructor(fontController, onLoad) {
    this._fontController = fontController;
    this._onLoad = onLoad;
    this._glyphs = new Map();
    this._watched = new Set();
  }

  /** The variable glyph controller of a glyph, or undefined while loading. */
  get(glyphName) {
    if (!this._glyphs.has(glyphName)) {
      this._glyphs.set(glyphName, undefined);
      Promise.resolve(this._fontController?.getGlyph?.(glyphName))
        .then((varGlyph) => {
          if (varGlyph) {
            this._glyphs.set(glyphName, varGlyph);
            this._watch(glyphName);
            this._onLoad?.();
          } else {
            this._glyphs.delete(glyphName);
          }
        })
        .catch(() => this._glyphs.delete(glyphName));
    }
    return this._glyphs.get(glyphName);
  }

  /** Forget a glyph, after it changed. */
  forget(glyphName) {
    this._glyphs.delete(glyphName);
  }

  // When a base glyph is edited, Fontra makes a new controller for it
  _watch(glyphName) {
    if (this._watched.has(glyphName) || !this._fontController?.addGlyphChangeListener) {
      return;
    }
    this._watched.add(glyphName);
    this._fontController.addGlyphChangeListener(glyphName, () => {
      this.forget(glyphName);
      this._onLoad?.();
    });
  }
}

/**
 * @param {object} positionedGlyph an entry of Fontra's positioned lines
 * @param {object} [location] the glyph's source location
 * @param {ComponentGlyphs} [componentGlyphs]
 * @returns {{outlines: object[], twists: object[]}} outlines in glyph
 *   coordinates; twists of the glyph's own contours only
 */
export function strokeGlyph(positionedGlyph, location, componentGlyphs) {
  const glyph = positionedGlyph?.glyph;
  const outlines = [];
  let twists = [];
  if (glyph?.path?.numContours) {
    const style = strokeStyleForGlyph(positionedGlyph, location);
    if (style) {
      const own = strokeOpenContours(glyph.path, style);
      outlines.push(...own.outlines);
      twists = own.twists;
    }
  }
  for (const component of glyph?.components ?? []) {
    const name = component.compo?.name;
    const path = component.path;
    if (!name || !hasOpenContours(path)) {
      continue;
    }
    const varGlyph = componentGlyphs?.get(name);
    if (!varGlyph) {
      continue;
    }
    // The component's glyph between its sources: at the parent's location,
    // with the component's own axis values
    const style = strokeStyleForGlyph(
      { glyphName: name, varGlyph, glyph: { varGlyph } },
      { ...location, ...component.compo.location }
    );
    if (style) {
      outlines.push(...strokeOpenContours(path, style).outlines);
    }
  }
  return { outlines, twists };
}

export function hasOpenContours(path) {
  return !!path?.contourInfo?.some((contour) => !contour.isClosed);
}

const cache = new WeakMap();

/**
 * Stroked outlines of the open contours of a Fontra path, and the places
 * where the strokes twist. Reused while the points and the style stay the same.
 */
export function strokeOpenContours(path, style) {
  const key = cacheKey(path, style);
  const cached = cache.get(path);
  if (cached?.key === key) {
    return cached.result;
  }
  const result = strokeOpenContoursUncached(path, style);
  cache.set(path, { key, result });
  return result;
}

function strokeOpenContoursUncached(path, style) {
  const outlines = [];
  const twists = [];
  for (let contourIndex = 0; contourIndex < path.numContours; contourIndex++) {
    if (path.contourInfo[contourIndex].isClosed) {
      continue;
    }
    let contour;
    try {
      contour = path.getUnpackedContour(contourIndex);
    } catch (e) {
      // A contour that is being drawn can be momentarily malformed; skip it
      // rather than break drawing.
      continue;
    }
    const stroked = strokeOffsetContour(contour, style);
    outlines.push(...stroked.contours);
    twists.push(...stroked.twists.map((twist) => ({ ...twist, contourIndex })));
  }
  return { outlines, twists };
}

// Fontra may change a path in place while points are dragged, so the key
// holds the points themselves, not just the path object
function cacheKey(path, style) {
  const contours = (path.contourInfo ?? [])
    .map((contour) => `${contour.endPoint}${contour.isClosed ? "c" : "o"}`)
    .join(",");
  return [
    style.width,
    style.cap,
    style.join,
    style.miterLimit,
    contours,
    Array.from(path.pointTypes ?? []).join(","),
    Array.from(path.coordinates ?? []).join(","),
  ].join("|");
}
