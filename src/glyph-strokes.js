// The stroked shapes of a glyph shown in the editor: its own open contours,
// and the open contours inside its components, each stroked with the values
// of the glyph they belong to.
//
// Results are kept per path object and reused as long as the path's points
// and the values stay the same, so that redrawing many glyphs (the text
// around the glyph being edited) does not stroke them all again.

import { hasClosedCenterlines, strokeStyleForGlyph } from "./current-source.js";
import { strokeContour } from "./geometry/stroke.js";
import { isCenterlineContour, normalizeNibAngle } from "./stroke-data.js";

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
 * @returns {{outlines: object[], twists: object[], shrunkCorners: object[],
 *   strokedClosed: {own: Set<number>, components: Map<number, Set<number>>},
 *   componentOutlines: Map<number, object[]>}} outlines in glyph
 *   coordinates; twists of the glyph's own contours only; the corners of
 *   the glyph's own contours whose radius was made smaller to fit (see
 *   roundCorners() in geometry/corners.js); the closed contours
 *   that were stroked as centerlines (by contour index, of the glyph's own
 *   path and of each component's path, by component index); the outlines of
 *   each component with centerlines, by component index
 */
export function strokeGlyph(positionedGlyph, location, componentGlyphs) {
  const glyph = positionedGlyph?.glyph;
  const outlines = [];
  let twists = [];
  let shrunkCorners = [];
  const strokedClosed = { own: new Set(), components: new Map() };
  const componentOutlines = new Map();
  if (glyph?.path?.numContours) {
    const style = strokeStyleForGlyph(positionedGlyph, location);
    if (style) {
      const own = strokeOpenContours(glyph.path, style);
      outlines.push(...own.outlines);
      twists = own.twists;
      shrunkCorners = own.shrunkCorners;
      strokedClosed.own = new Set(own.strokedClosed);
    }
  }
  for (const [componentIndex, component] of (glyph?.components ?? []).entries()) {
    const name = component.compo?.name;
    const path = component.path;
    if (!name || !path?.numContours) {
      continue;
    }
    const varGlyph = componentGlyphs?.get(name);
    if (!varGlyph) {
      continue;
    }
    // The component's glyph between its sources: at the parent's location,
    // with the component's own axis values. Its path is the component's, for
    // the values of its points.
    const style = strokeStyleForGlyph(
      { glyphName: name, varGlyph, glyph: { varGlyph, path } },
      { ...location, ...component.compo.location }
    );
    if (style) {
      if (isMirrored(component.compo.transformation)) {
        if (style.type === "nib") {
          style.angle = normalizeNibAngle(-style.angle);
        }
        if (style.points) {
          style.points = mirrorPointValues(style.points);
        }
        if (style.angleReferences) {
          style.angleReferences = style.angleReferences.map((angles) =>
            angles?.map((angle) => (angle === undefined ? undefined : -angle))
          );
        }
      }
      const stroked = strokeOpenContours(path, style);
      outlines.push(...stroked.outlines);
      if (stroked.outlines.length) {
        componentOutlines.set(componentIndex, stroked.outlines);
      }
      if (stroked.strokedClosed.length) {
        strokedClosed.components.set(componentIndex, new Set(stroked.strokedClosed));
      }
    }
  }
  return { outlines, twists, shrunkCorners, strokedClosed, componentOutlines };
}

/**
 * Whether a glyph of the text may have centerlines: open contours of its own
 * or in its components, or closed contours marked as centerlines in its glyph
 * or in a component's glyph (once that is loaded).
 */
export function glyphHasCenterlines(positionedGlyph, componentGlyphs) {
  const glyph = positionedGlyph?.glyph;
  if (!glyph) {
    return false;
  }
  const varGlyph = positionedGlyph.varGlyph ?? glyph.varGlyph;
  if (hasOpenContours(glyph.path) || hasClosedCenterlines(varGlyph)) {
    return true;
  }
  return (glyph.components ?? []).some(
    (component) =>
      hasOpenContours(component.path) ||
      (component.path?.numContours > 0 &&
        hasClosedCenterlines(componentGlyphs?.get(component.compo?.name)))
  );
}

/**
 * Whether a component's transformation flips its glyph over: then the left
 * of the centerline in the glyph is on its right in the component.
 */
export function isMirrored(transformation) {
  const scaleX = transformation?.scaleX ?? 1;
  const scaleY = transformation?.scaleY ?? 1;
  return scaleX * scaleY < 0;
}

/**
 * Point values seen in a mirror: left and right swapped, nib angles turned
 * the other way.
 */
export function mirrorPointValues(points) {
  return points.map((contour) =>
    contour.map((values) => {
      if (
        !values ||
        (values.left === undefined &&
          values.right === undefined &&
          values.angle === undefined)
      ) {
        return values;
      }
      const { left, right, ...rest } = values;
      const swapped = { ...rest };
      if (rest.angle !== undefined) {
        swapped.angle = normalizeNibAngle(-rest.angle);
      }
      if (right !== undefined) {
        swapped.left = right;
      }
      if (left !== undefined) {
        swapped.right = left;
      }
      return swapped;
    })
  );
}

export function hasOpenContours(path) {
  return !!path?.contourInfo?.some((contour) => !contour.isClosed);
}

const cache = new WeakMap();

/**
 * Stroked outlines of the centerlines of a Fontra path (its open contours,
 * and the closed contours marked as centerlines in style.points), the places
 * where the strokes twist, the corners whose radius was made smaller, and
 * the indices of the closed contours stroked. Reused while the points and
 * the style stay the same.
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
  const shrunkCorners = [];
  const strokedClosed = [];
  for (let contourIndex = 0; contourIndex < path.numContours; contourIndex++) {
    const isClosed = path.contourInfo[contourIndex].isClosed;
    if (!isCenterlineContour(isClosed, style.points?.[contourIndex])) {
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
    const values = style.points?.[contourIndex];
    if (values) {
      contour.points.forEach((point, i) => {
        point.values = values[i];
      });
    }
    const stroked = strokeContour(contour, style, {
      angleReference: style.angleReferences?.[contourIndex],
    });
    outlines.push(...stroked.contours);
    twists.push(...stroked.twists.map((twist) => ({ ...twist, contourIndex })));
    shrunkCorners.push(
      ...stroked.corners
        .filter((corner) => corner.shrunk)
        .map((corner) => ({ ...corner, contourIndex }))
    );
    if (isClosed) {
      strokedClosed.push(contourIndex);
    }
  }
  return { outlines, twists, shrunkCorners, strokedClosed };
}

// Fontra may change a path in place while points are dragged, so the key
// holds the points themselves, not just the path object
function cacheKey(path, style) {
  const contours = (path.contourInfo ?? [])
    .map((contour) => `${contour.endPoint}${contour.isClosed ? "c" : "o"}`)
    .join(",");
  return [
    style.type,
    style.shape,
    style.width,
    style.cap,
    style.join,
    style.miterLimit,
    style.major,
    style.minor,
    style.angle,
    style.points ? JSON.stringify(style.points) : "",
    style.angleReferences ? JSON.stringify(style.angleReferences) : "",
    contours,
    Array.from(path.pointTypes ?? []).join(","),
    Array.from(path.coordinates ?? []).join(","),
  ].join("|");
}
