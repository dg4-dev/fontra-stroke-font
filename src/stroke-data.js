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
// Missing values fall back to the source defaults, then to the built-in ones,
// except the widths of points: a point in the middle of a centerline without a
// width of its own takes the width between the points around it that have one
// (see geometry/widths.js), so that adding a point does not change the stroke.
//
// The nib method and cornerRadius are not used yet; the format is fixed here
// so that later phases do not need to migrate data.

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
 * The valid offset values of one point, from what is stored for it.
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
  return Object.keys(values).length ? values : undefined;
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
 * Only open contours are centerlines; closed contours are ordinary outlines.
 */
export function isCenterline(contour) {
  return !contour.isClosed;
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
