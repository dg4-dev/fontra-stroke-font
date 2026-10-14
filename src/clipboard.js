// Carrying the values of points (widths, nibs, joins) through Fontra's copy
// and paste.
//
// Fontra copies the selected points with their attributes, identifiers
// included, but the values of points live in the sources' customData, keyed
// by identifier (see stroke-data.js), so they stayed behind: pasted into
// another glyph, the points had no values; pasted into the same glyph, they
// had the identifiers of the points they were copied from, and so shared
// their values. Worse, Fontra could not save them there: a UFO glyph cannot
// have two points with the same identifier, so pasting points with
// identifiers (which this plugin gives points with values) into the glyph
// they came from failed.
//
// On copy, each copied point gets its values as a point attribute
// (CARRIED_KEY), in the copy only. On paste, a pasted point whose identifier
// the glyph already has gets a new one (the same in every layer), then
// Fontra appends the points with their attributes; in the same edit (one
// undo step), the values are written to the sources of the glyph pasted
// into, and the attribute is removed.

import { defaultSourceIndex, layerPath } from "./current-source.js";
import { editPointValues } from "./point-edit.js";
import {
  SHARED_POINT_KEYS,
  getSourceStroke,
  makePointIdentifier,
  sanitizePointValues,
} from "./stroke-data.js";

/** The point attribute that carries a copied point's values. */
export const CARRIED_KEY = "xyz.dg4.stroke.values";

/**
 * The layers Fontra puts on the clipboard, with the values of their points
 * as point attributes. The glyphs that get values are copies; the others are
 * returned as they are.
 * @param {{layerName?: string, glyph: object}[]} layerGlyphs from Fontra's
 *   _prepareCopyOrCutLayers()
 * @param {object} varGlyph the variable glyph copied from (sources, layers)
 */
export function attachPointValues(layerGlyphs, varGlyph) {
  const sources = varGlyph?.sources ?? [];
  const defaultSource = sources[defaultSourceIndex(varGlyph)];
  const shared = getSourceStroke(defaultSource?.customData).points;
  return layerGlyphs.map((entry) => {
    const source =
      entry.layerName === undefined
        ? undefined
        : sources.find((s) => s.layerName === entry.layerName);
    const path = entry.glyph?.path;
    if (!source || !path?.pointAttributes) {
      return entry;
    }
    const own = getSourceStroke(source.customData).points;
    let attributes = null;
    for (const [i, attrs] of path.pointAttributes.entries()) {
      const identifier = attrs?.identifier;
      if (typeof identifier !== "string") {
        continue;
      }
      const values = { ...own[identifier] };
      for (const key of SHARED_POINT_KEYS) {
        delete values[key];
        if (shared[identifier]?.[key] !== undefined) {
          values[key] = shared[identifier][key];
        }
      }
      const clean = sanitizePointValues(values);
      if (!clean || !Object.keys(clean).length) {
        continue;
      }
      attributes ??= [...path.pointAttributes];
      attributes[i] = { ...attrs, [CARRIED_KEY]: clean };
    }
    if (!attributes) {
      return entry;
    }
    const glyph = entry.glyph.copy ? entry.glyph.copy() : { ...entry.glyph };
    glyph.path = glyph.path.copy ? glyph.path.copy() : { ...glyph.path };
    glyph.path.pointAttributes = attributes;
    return { ...entry, glyph };
  });
}

/**
 * The layers to paste, with new identifiers for the points whose identifiers
 * are taken: the same new identifier for the same old one in every layer, so
 * that the points still match between sources. The glyphs that change are
 * copies.
 * @param {{glyph: object}[]} pasteLayerGlyphs
 * @param {Iterable<string>} taken the identifiers of the glyph pasted into
 */
export function renameTakenIdentifiers(pasteLayerGlyphs, taken) {
  const used = new Set(taken);
  if (!used.size) {
    return pasteLayerGlyphs;
  }
  const renamed = new Map();
  return pasteLayerGlyphs.map((entry) => {
    const path = entry.glyph?.path;
    if (!path?.pointAttributes?.some((attrs) => used.has(attrs?.identifier))) {
      return entry;
    }
    const attributes = path.pointAttributes.map((attrs) => {
      const identifier = attrs?.identifier;
      if (typeof identifier !== "string") {
        return attrs;
      }
      if (!renamed.has(identifier)) {
        if (!used.has(identifier)) {
          return attrs;
        }
        const fresh = makePointIdentifier(used);
        used.add(fresh);
        renamed.set(identifier, fresh);
      }
      return { ...attrs, identifier: renamed.get(identifier) };
    });
    const glyph = entry.glyph.copy ? entry.glyph.copy() : { ...entry.glyph };
    glyph.path = glyph.path.copy ? glyph.path.copy() : { ...glyph.path };
    glyph.path.pointAttributes = attributes;
    return { ...entry, glyph };
  });
}

/** The identifiers of the points of all layers of a glyph. */
export function glyphIdentifiers(varGlyph) {
  const identifiers = new Set();
  for (const layer of Object.values(varGlyph?.layers ?? {})) {
    for (const attrs of layer?.glyph?.path?.pointAttributes ?? []) {
      if (typeof attrs?.identifier === "string") {
        identifiers.add(attrs.identifier);
      }
    }
  }
  return identifiers;
}

/** Whether a path has points with carried values. */
export function carriesPointValues(path) {
  return !!path?.pointAttributes?.some((attrs) => attrs?.[CARRIED_KEY]);
}

/**
 * Write the carried values of pasted points to the sources of a glyph and
 * remove them from the points, in place: Fontra's VariableGlyph, inside the
 * edit that pasted them.
 * @returns {number} how many points got values
 */
export function applyCarriedValues(glyph) {
  let count = 0;
  for (const [sourceIndex, source] of (glyph?.sources ?? []).entries()) {
    const path = layerPath(glyph, source);
    const carried = new Map();
    for (const [i, attrs] of (path?.pointAttributes ?? []).entries()) {
      const values = sanitizePointValues(attrs?.[CARRIED_KEY]);
      if (values && Object.keys(values).length) {
        carried.set(i, values);
      }
    }
    if (!carried.size) {
      continue;
    }
    editPointValues(glyph, [sourceIndex], [...carried.keys()], (stored, pointIndex) =>
      carried.get(pointIndex)
    );
    count += carried.size;
  }
  // The attribute is not kept, in any layer
  for (const layer of Object.values(glyph?.layers ?? {})) {
    const path = layer?.glyph?.path;
    if (!carriesPointValues(path)) {
      continue;
    }
    for (const [i, attrs] of path.pointAttributes.entries()) {
      if (attrs?.[CARRIED_KEY]) {
        const { [CARRIED_KEY]: removed, ...rest } = attrs;
        path.pointAttributes[i] = Object.keys(rest).length ? rest : null;
      }
    }
  }
  return count;
}

/**
 * Wrap Fontra's copy and paste of the editor (internal methods), in place.
 * Does nothing with a Fontra without them.
 */
export function wrapCopyPaste(editor) {
  const prepare = editor?._prepareCopyOrCutLayers;
  const paste = editor?._pasteLayerGlyphs;
  if (typeof prepare !== "function" || typeof paste !== "function") {
    console.warn("[stroke-font] copy and paste keep no point values in this Fontra");
    return false;
  }
  if (prepare.strokeFontWrapped) {
    return true;
  }
  const wrappedPrepare = function (varGlyph, doCut) {
    const result = prepare.call(this, varGlyph, doCut);
    try {
      const glyph =
        varGlyph ?? this.sceneModel?.getSelectedPositionedGlyph?.()?.varGlyph?.glyph;
      if (result?.layerGlyphs && glyph) {
        result.layerGlyphs = attachPointValues(result.layerGlyphs, glyph);
      }
    } catch (e) {
      console.error("[stroke-font] could not copy the values of points", e);
    }
    return result;
  };
  wrappedPrepare.strokeFontWrapped = true;

  const wrappedPaste = async function (pasteLayerGlyphs) {
    const sceneController = this.sceneController;
    try {
      const target = this.sceneModel?.getSelectedPositionedGlyph?.()?.varGlyph?.glyph;
      pasteLayerGlyphs = renameTakenIdentifiers(
        pasteLayerGlyphs,
        glyphIdentifiers(target)
      );
    } catch (e) {
      console.error("[stroke-font] could not give pasted points new identifiers", e);
    }
    if (
      !sceneController ||
      !pasteLayerGlyphs?.some((layer) => carriesPointValues(layer.glyph?.path))
    ) {
      return paste.call(this, pasteLayerGlyphs);
    }
    // Write the values in the same edit as the paste: one undo step
    const name = "editGlyphAndRecordChanges";
    const hadOwn = Object.prototype.hasOwnProperty.call(sceneController, name);
    const edit = sceneController[name];
    const restore = () => {
      if (hadOwn) {
        sceneController[name] = edit;
      } else {
        delete sceneController[name];
      }
    };
    sceneController[name] = function (editFunc, ...rest) {
      restore();
      return edit.call(
        this,
        (glyph) => {
          const result = editFunc(glyph);
          try {
            applyCarriedValues(glyph);
          } catch (e) {
            console.error("[stroke-font] could not paste the values of points", e);
          }
          return result;
        },
        ...rest
      );
    };
    try {
      return await paste.call(this, pasteLayerGlyphs);
    } finally {
      restore();
    }
  };
  editor._prepareCopyOrCutLayers = wrappedPrepare;
  editor._pasteLayerGlyphs = wrappedPaste;
  return true;
}
