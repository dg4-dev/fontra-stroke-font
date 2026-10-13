// Reading and writing the stroke settings kept in a glyph's customData.
// No Fontra or DOM dependencies: the CLI reads the same data.
//
// Glyph customData (shared by all sources, since the method and the nib shape
// cannot be interpolated):
//   { "xyz.dg4.stroke": { "type": "offset" | "nib", "shape": "ellipse" | "rect" } }
//
// Source customData (one per source, so the numbers can vary along the axes):
//   { "xyz.dg4.stroke": {
//       "defaults": { ...values for the whole source },
//       "points": { "<point identifier>": { ...values for one on-curve point } } } }
//
// Values of the offset method: width (or left / right), cap, join, miterLimit.
// Values of the nib method: major, minor, angle. Both methods: cornerRadius.
// Points also have centerline: true on the on-curve points of a closed
// contour that is a centerline (stroked as a loop) rather than an outline.
// Missing values fall back to the source defaults, then to the built-in ones.
// Between two points, numbers change evenly along the centerline (see
// geometry/widths.js).
//
// Nib values: major and minor are the full lengths of the nib's axes (of the
// ellipse, or the sides of the rectangle; a rectangle with minor 0 is a flat
// nib), angle the direction of the major axis in degrees, counter-clockwise
// from horizontal, kept in [0, 180).
//
// cornerRadius is not used yet; the format is fixed here so that later
// phases do not need to migrate data.

export const STROKE_KEY = "xyz.dg4.stroke";

export const STROKE_TYPES = Object.freeze(["offset", "nib"]);
export const NIB_SHAPES = Object.freeze(["ellipse", "rect"]);
export const CAPS = Object.freeze(["butt", "round", "square"]);
export const JOINS = Object.freeze(["miter", "round", "bevel"]);

export const DEFAULT_OFFSET_STYLE = Object.freeze({
  width: 80,
  cap: "round",
  join: "miter",
  miterLimit: 4,
});

export const MIN_MITER_LIMIT = 1;

export const DEFAULT_NIB_STYLE = Object.freeze({
  major: 120,
  minor: 30,
  angle: 45,
});

// The numbers of a nib, of the source defaults and of points. All are
// interpolated between sources.
export const NIB_KEYS = Object.freeze(["major", "minor", "angle"]);

// Numbers vary between sources and are interpolated. Strings cannot be
// interpolated, and the outlines would not match if they differed, so all
// sources use the default source's.
export const INTERPOLATED_OFFSET_KEYS = Object.freeze(["width", "miterLimit"]);
export const SHARED_OFFSET_KEYS = Object.freeze(["cap", "join"]);

// The values an on-curve point of the offset method can have
export const POINT_OFFSET_KEYS = Object.freeze([
  "width",
  "left",
  "right",
  "join",
  "miterLimit",
]);

// Point values that must be the same in all sources: those of the default
// source are used (as cap and join of the source defaults)
export const SHARED_POINT_KEYS = Object.freeze(["join", "centerline"]);

/**
 * The stroke method of a glyph. Glyphs without settings use the offset method.
 * @param {object} glyphCustomData customData of the variable glyph
 * @returns {{type: string, shape?: string}}
 */
export function getGlyphStroke(glyphCustomData) {
  const stored = asObject(glyphCustomData?.[STROKE_KEY]);
  const type = STROKE_TYPES.includes(stored.type) ? stored.type : "offset";
  if (type === "nib") {
    const shape = NIB_SHAPES.includes(stored.shape) ? stored.shape : NIB_SHAPES[0];
    return { type, shape };
  }
  return { type };
}

/**
 * Set the stroke method of a glyph, in place. The offset method is the
 * default, so it removes the glyph's stroke data. Returns the customData.
 * Like setSourceDefaults(), only what changes is assigned or deleted.
 * @param {object} glyphCustomData customData of the variable glyph
 * @param {string} type "offset" or "nib"
 * @param {string} [shape] the nib shape, for the nib method
 */
export function setGlyphStroke(glyphCustomData, type, shape) {
  const stored = glyphCustomData[STROKE_KEY];
  if (type !== "nib") {
    if (stored !== undefined) {
      delete glyphCustomData[STROKE_KEY];
    }
    return glyphCustomData;
  }
  const nibShape = NIB_SHAPES.includes(shape) ? shape : NIB_SHAPES[0];
  if (!isObject(stored)) {
    glyphCustomData[STROKE_KEY] = { type: "nib", shape: nibShape };
    return glyphCustomData;
  }
  if (stored.type !== "nib") {
    stored.type = "nib";
  }
  if (stored.shape !== nibShape) {
    stored.shape = nibShape;
  }
  return glyphCustomData;
}

/**
 * The raw stroke values of a source: its defaults and per-point values, as
 * stored (unknown keys are kept, nothing is filled in).
 * @param {object} sourceCustomData customData of a glyph source
 * @returns {{defaults: object, points: object}}
 */
export function getSourceStroke(sourceCustomData) {
  const stored = asObject(sourceCustomData?.[STROKE_KEY]);
  return { defaults: asObject(stored.defaults), points: asObject(stored.points) };
}

/**
 * The offset style of a source: its defaults, with missing or invalid values
 * replaced by the built-in defaults.
 * @param {object} sourceCustomData customData of a glyph source
 */
export function resolveOffsetStyle(sourceCustomData) {
  const { defaults } = getSourceStroke(sourceCustomData);
  const style = { ...DEFAULT_OFFSET_STYLE };
  for (const key of Object.keys(DEFAULT_OFFSET_STYLE)) {
    const value = sanitizeOffsetValue(key, defaults[key]);
    if (value !== undefined) {
      style[key] = value;
    }
  }
  return style;
}

/**
 * The offset style of a source within its glyph: its own numbers, with the
 * cap and join of the default source.
 * @param {object} sourceCustomData customData of the source
 * @param {object} defaultSourceCustomData customData of the default source
 */
export function offsetStyleInGlyph(sourceCustomData, defaultSourceCustomData) {
  const own = resolveOffsetStyle(sourceCustomData);
  const shared = resolveOffsetStyle(defaultSourceCustomData);
  for (const key of SHARED_OFFSET_KEYS) {
    own[key] = shared[key];
  }
  return own;
}

/**
 * The nib of a source: its defaults, with missing or invalid values replaced
 * by the built-in defaults.
 * @param {object} sourceCustomData customData of a glyph source
 * @returns {{major: number, minor: number, angle: number}}
 */
export function resolveNibStyle(sourceCustomData) {
  const { defaults } = getSourceStroke(sourceCustomData);
  const style = { ...DEFAULT_NIB_STYLE };
  for (const key of NIB_KEYS) {
    const value = sanitizeNibValue(key, defaults[key]);
    if (value !== undefined) {
      style[key] = value;
    }
  }
  return style;
}

/**
 * The nib style of a source within its glyph: the glyph's nib shape and the
 * source's numbers.
 * @param {object} sourceCustomData customData of the source
 * @param {object} glyphCustomData customData of the variable glyph
 * @returns {{type: "nib", shape: string, major: number, minor: number,
 *   angle: number}}
 */
export function nibStyleInGlyph(sourceCustomData, glyphCustomData) {
  const stored = asObject(glyphCustomData?.[STROKE_KEY]);
  const shape = NIB_SHAPES.includes(stored.shape) ? stored.shape : NIB_SHAPES[0];
  return { type: "nib", shape, ...resolveNibStyle(sourceCustomData) };
}

/**
 * A valid value for a nib key, or undefined when the value is missing or
 * cannot be used.
 */
export function sanitizeNibValue(key, value) {
  const number = toNumber(value);
  switch (key) {
    case "major":
    case "minor":
      return number === undefined ? undefined : Math.max(0, number);
    case "angle":
      return number === undefined ? undefined : normalizeNibAngle(number);
    default:
      throw new Error(`unknown nib key: ${key}`);
  }
}

/**
 * A valid value for an offset style key, or undefined when the value is
 * missing or cannot be used.
 */
export function sanitizeOffsetValue(key, value) {
  switch (key) {
    case "width":
    case "left":
    case "right": {
      const number = toNumber(value);
      return number === undefined ? undefined : Math.max(0, number);
    }
    case "miterLimit": {
      const number = toNumber(value);
      return number === undefined ? undefined : Math.max(MIN_MITER_LIMIT, number);
    }
    case "cap":
      return CAPS.includes(value) ? value : undefined;
    case "join":
      return JOINS.includes(value) ? value : undefined;
    default:
      throw new Error(`unknown offset style key: ${key}`);
  }
}

/**
 * Set (or, with undefined, remove) source default values, in place. Returns
 * the customData. Other keys of the stroke data are kept.
 *
 * Only the keys that change are assigned or deleted, and new objects are
 * built from plain values only: inside Fontra's editGlyph functions the
 * customData is a change-recording proxy, and assigning an object that holds
 * such proxies would record proxies instead of data.
 * @param {object} sourceCustomData customData of a glyph source
 * @param {object} values e.g. { width: 90 } or { cap: undefined }
 */
export function setSourceDefaults(sourceCustomData, values) {
  const toSet = Object.fromEntries(
    Object.entries(values).filter(([key, value]) => value !== undefined)
  );
  const stored = sourceCustomData[STROKE_KEY];
  if (!isObject(stored)) {
    if (Object.keys(toSet).length) {
      sourceCustomData[STROKE_KEY] = { defaults: toSet };
    }
    return sourceCustomData;
  }
  const defaults = stored.defaults;
  if (!isObject(defaults)) {
    if (Object.keys(toSet).length) {
      stored.defaults = toSet;
    }
  } else {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) {
        if (defaults[key] !== undefined) {
          delete defaults[key];
        }
      } else if (defaults[key] !== value) {
        defaults[key] = value;
      }
    }
    if (!Object.keys(defaults).length) {
      delete stored.defaults;
    }
  }
  if (!Object.keys(stored).length) {
    delete sourceCustomData[STROKE_KEY];
  }
  return sourceCustomData;
}

/**
 * The valid values of one point (of both methods), from what is stored for it.
 * @returns {object|undefined} undefined when the point has no valid values
 */
export function sanitizePointValues(stored) {
  if (!isObject(stored)) {
    return undefined;
  }
  const values = {};
  for (const key of POINT_OFFSET_KEYS) {
    const value = sanitizeOffsetValue(key, stored[key]);
    if (value !== undefined) {
      values[key] = value;
    }
  }
  for (const key of NIB_KEYS) {
    const value = sanitizeNibValue(key, stored[key]);
    if (value !== undefined) {
      values[key] = value;
    }
  }
  if (stored.centerline === true) {
    values.centerline = true;
  }
  return Object.keys(values).length ? values : undefined;
}

/**
 * Whether a contour is a centerline: an open one always, a closed one when
 * one of its points has centerline: true.
 * @param {boolean} isClosed
 * @param {(object|undefined)[]} [values] the values of its points
 */
export function isCenterlineContour(isClosed, values) {
  return !isClosed || !!values?.some((pointValues) => pointValues?.centerline);
}

/**
 * The half widths a point sets on its left and right, each undefined when
 * the point does not set it. left / right win over width.
 */
export function pointHalfWidths(values) {
  const half = values?.width !== undefined ? values.width / 2 : undefined;
  return {
    left: values?.left ?? half,
    right: values?.right ?? half,
  };
}

/**
 * The values of the points of a glyph's contours in one source.
 *
 * A point is found by its identifier. When several points of the glyph have
 * the same identifier (a contour that was duplicated or pasted), only the
 * first one gets the values; the others count as points without values.
 * Off-curve points never have values.
 *
 * @param {{identifier?: string, onCurve: boolean}[][]} contours the points of
 *   each contour of the glyph
 * @param {object} sourceCustomData customData of the source
 * @returns {(object|undefined)[][]} sanitized values per contour and point
 */
export function resolvePointValues(contours, sourceCustomData) {
  const { points } = getSourceStroke(sourceCustomData);
  const seen = new Set();
  return contours.map((contour) =>
    contour.map(({ identifier, onCurve }) => {
      if (!onCurve || typeof identifier !== "string" || seen.has(identifier)) {
        return undefined;
      }
      seen.add(identifier);
      return sanitizePointValues(points[identifier]);
    })
  );
}

/**
 * Change the values of points, in place: for each identifier, the given keys
 * are set, or removed when undefined. Points left without values are
 * removed, and so are the values of identifiers not in keepIdentifiers (the
 * points that were deleted), when it is given. Returns the customData.
 *
 * Like setSourceDefaults(), only what changes is assigned or deleted, with
 * new objects built from plain values only.
 * @param {object} sourceCustomData customData of a glyph source
 * @param {Map<string, object>|object} changes identifier → values
 * @param {Iterable<string>} [keepIdentifiers] the identifiers of the source's points
 */
export function setPointValues(sourceCustomData, changes, keepIdentifiers) {
  const entries = changes instanceof Map ? [...changes] : Object.entries(changes);
  let stored = sourceCustomData[STROKE_KEY];
  if (!isObject(stored)) {
    sourceCustomData[STROKE_KEY] = {};
    stored = sourceCustomData[STROKE_KEY];
  }
  if (!isObject(stored.points)) {
    stored.points = {};
  }
  const points = stored.points;
  for (const [identifier, values] of entries) {
    const toSet = Object.fromEntries(
      Object.entries(values).filter(([key, value]) => value !== undefined)
    );
    const current = points[identifier];
    if (!isObject(current)) {
      if (Object.keys(toSet).length) {
        points[identifier] = toSet;
      } else if (current !== undefined) {
        delete points[identifier];
      }
      continue;
    }
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) {
        if (current[key] !== undefined) {
          delete current[key];
        }
      } else if (current[key] !== value) {
        current[key] = value;
      }
    }
    if (!Object.keys(current).length) {
      delete points[identifier];
    }
  }
  if (keepIdentifiers) {
    const keep = new Set(keepIdentifiers);
    for (const identifier of Object.keys(points)) {
      if (!keep.has(identifier)) {
        delete points[identifier];
      }
    }
  }
  if (!Object.keys(points).length) {
    delete stored.points;
  }
  if (!Object.keys(stored).length) {
    delete sourceCustomData[STROKE_KEY];
  }
  return sourceCustomData;
}

/**
 * A point identifier not in the given set: ten letters and digits, like the
 * identifiers ufoLib makes.
 */
export function makePointIdentifier(taken = new Set(), random = Math.random) {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (;;) {
    let identifier = "";
    for (let i = 0; i < 10; i++) {
      identifier += characters[Math.floor(random() * characters.length)];
    }
    if (!taken.has(identifier)) {
      return identifier;
    }
  }
}

/**
 * Nib angles are stored in degrees in [0, 180): an ellipse or a rectangle
 * turned by 180° is the same shape.
 */
export function normalizeNibAngle(angle) {
  return (((Number(angle) % 180) + 180) % 180) + 0; // + 0 turns -0 into 0
}

/**
 * The angle turned by whole half turns to be within 90° of the reference:
 * the same nib, turned the short way from the reference. Interpolating such
 * angles turns the nib the short way (170° and 10° go through 180°).
 */
export function nearestNibAngle(angle, reference) {
  return angle - 180 * Math.round((angle - reference) / 180);
}

/**
 * A valid value for a key of either method, or undefined (see
 * sanitizeOffsetValue() and sanitizeNibValue()).
 */
export function sanitizeStrokeValue(key, value) {
  return NIB_KEYS.includes(key)
    ? sanitizeNibValue(key, value)
    : sanitizeOffsetValue(key, value);
}

/**
 * Whether a contour is a centerline, from the values of its points (see
 * isCenterlineContour()).
 */
export function isCenterline(contour, values) {
  return isCenterlineContour(contour.isClosed, values);
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asObject(value) {
  return isObject(value) ? value : {};
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
