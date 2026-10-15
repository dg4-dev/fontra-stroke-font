// Keeping the left and right widths of points on their sides when Fontra
// reverses a centerline.
//
// left and right are the sides of a point seen along its centerline (see
// stroke-data.js), kept by point identifier. Fontra reverses contours by
// reordering their points, identifiers included: "Reverse Contour
// Direction", "Join Contours" when the ends do not match, and the pen tool
// when it connects two open contours. The values stayed while the sides
// turned, so what was on the left came out on the right.
//
// The pen tool reverses contours in functions the plugin cannot reach, so
// instead of wrapping each operation, every edit of a glyph is checked: the
// order of the points of each source's layer before the edit is compared with
// the order after it, and where a run of points from one contour now goes the
// other way, the left and right values of its points are swapped in that
// source, in the same edit (one undo step).
//
// Points are followed by identifier, or by position when they have none (an
// edit that reverses a contour does not move its points), so that a contour
// whose only identified point is one end is still seen to turn.

import { layerPath } from "./current-source.js";
import { STROKE_KEY, getSourceStroke, setPointValues } from "./stroke-data.js";

/**
 * Whether a glyph has points with a left or right value in any source: only
 * then can a reversed contour change its shape.
 * @param {object} glyph Fontra's VariableGlyph
 */
export function hasSidedPoints(glyph) {
  return (glyph?.sources ?? []).some((source) =>
    Object.values(getSourceStroke(source.customData).points).some(
      (values) => values?.left !== undefined || values?.right !== undefined
    )
  );
}

/**
 * The order of the points of each source's layer, to compare with after an
 * edit.
 * @param {object} glyph Fontra's VariableGlyph
 * @returns {Map<string, Map<string, object>>} layer name → point key → place
 */
export function snapshotPointOrder(glyph) {
  const snapshot = new Map();
  for (const source of glyph?.sources ?? []) {
    if (snapshot.has(source.layerName)) {
      continue;
    }
    const path = layerPath(glyph, source);
    if (path) {
      snapshot.set(source.layerName, pointPlaces(path));
    }
  }
  return snapshot;
}

/**
 * The identifiers of the points that are in a contour of the path running
 * the other way than before.
 * @param {Map<string, object>} before pointPlaces() of the path before
 * @param {object} path the path now (Fontra's VarPackedPath)
 * @returns {Set<string>}
 */
export function reversedIdentifiers(before, path) {
  const reversed = new Set();
  for (const { points } of followedPoints(path)) {
    // Runs of points that come from the same contour before
    const runs = new Map();
    for (const { key, identifier } of points) {
      const place = before.get(key);
      if (!place) {
        continue;
      }
      let run = runs.get(place.contourIndex);
      if (!run) {
        run = { previous: undefined, forward: 0, backward: 0, identifiers: [] };
        runs.set(place.contourIndex, run);
      }
      if (run.previous !== undefined) {
        const step = direction(place, run.previous);
        if (step > 0) {
          run.forward++;
        } else if (step < 0) {
          run.backward++;
        }
      }
      run.previous = place.position;
      if (identifier !== undefined) {
        run.identifiers.push(identifier);
      }
    }
    for (const run of runs.values()) {
      if (run.backward > run.forward) {
        run.identifiers.forEach((identifier) => reversed.add(identifier));
      }
    }
  }
  return reversed;
}

/**
 * Swap the left and right values of points, in place. Returns whether
 * anything changed.
 * @param {object} sourceCustomData customData of a glyph source
 * @param {Iterable<string>} identifiers
 */
export function swapSides(sourceCustomData, identifiers) {
  const { points } = getSourceStroke(sourceCustomData);
  const changes = new Map();
  for (const identifier of identifiers) {
    const values = points[identifier];
    if (values && values.left !== values.right) {
      changes.set(identifier, { left: values.right, right: values.left });
    }
  }
  if (changes.size) {
    setPointValues(sourceCustomData, changes);
  }
  return changes.size > 0;
}

/**
 * After an edit, swap the sides of the points of the contours it reversed, in
 * place, and return the changes as Fontra change lists.
 * @param {object} glyph Fontra's VariableGlyph, as the edit left it
 * @param {Map<string, Map<string, object>>} before snapshotPointOrder() of
 *   the glyph before the edit
 * @returns {{forward: object[], rollback: object[]}}
 */
export function keepSidesOnReversal(glyph, before) {
  const forward = [];
  const rollback = [];
  for (const [sourceIndex, source] of (glyph?.sources ?? []).entries()) {
    const places = before.get(source.layerName);
    const path = layerPath(glyph, source);
    if (!places || !path || !source.customData?.[STROKE_KEY]) {
      continue;
    }
    const identifiers = reversedIdentifiers(places, path);
    if (!identifiers.size) {
      continue;
    }
    const old = clone(source.customData[STROKE_KEY]);
    if (!swapSides(source.customData, identifiers)) {
      continue;
    }
    const changePath = ["sources", sourceIndex, "customData"];
    forward.push(setChange(changePath, source.customData[STROKE_KEY]));
    rollback.unshift(setChange(changePath, old));
  }
  return { forward, rollback };
}

/**
 * Wrap Fontra's glyph editing (an internal method of the scene controller),
 * in place, so that every edit keeps the sides of the points of the contours
 * it reverses. Does nothing with a Fontra without it.
 */
export function wrapContourReversal(sceneController) {
  const edit = sceneController?._editGlyphOrInstance;
  if (typeof edit !== "function") {
    console.warn("[stroke-font] reversed contours keep no sides in this Fontra");
    return false;
  }
  if (edit.strokeFontWrapped) {
    return true;
  }
  const wrapped = function (glyphName, editFunc, senderID, doInstance, ...rest) {
    if (doInstance || typeof editFunc !== "function") {
      return edit.call(this, glyphName, editFunc, senderID, doInstance, ...rest);
    }
    const wrappedEditFunc = async (sendIncrementalChange, glyph) => {
      let before;
      try {
        before = hasSidedPoints(glyph) ? snapshotPointOrder(glyph) : undefined;
      } catch (e) {
        console.error("[stroke-font] could not read the order of points", e);
      }
      const result = await editFunc(sendIncrementalChange, glyph);
      const changes = result?.changes;
      const Collector = changes?.constructor;
      if (
        !before ||
        !changes?.hasChange ||
        typeof changes.concat !== "function" ||
        typeof Collector?.fromChanges !== "function"
      ) {
        return result;
      }
      try {
        const { forward, rollback } = keepSidesOnReversal(glyph, before);
        if (forward.length) {
          result.changes = changes.concat(Collector.fromChanges(forward, rollback));
        }
      } catch (e) {
        console.error("[stroke-font] could not keep the sides of reversed points", e);
      }
      return result;
    };
    return edit.call(this, glyphName, wrappedEditFunc, senderID, doInstance, ...rest);
  };
  wrapped.strokeFontWrapped = true;
  sceneController._editGlyphOrInstance = wrapped;
  return true;
}

// The points of each contour of a path that can be followed: their key
// (identifier, or position when they have none), identifier and index in the
// contour, with the number of points of the contour and whether it is
// closed. Points whose key is not unique in the path are left out.
function followedPoints(path) {
  const contours = [];
  const counts = new Map();
  let start = 0;
  for (const contour of path?.contourInfo ?? []) {
    const points = [];
    for (let i = start; i <= contour.endPoint; i++) {
      const attribute = path.pointAttributes?.[i]?.identifier;
      const identifier = typeof attribute === "string" ? attribute : undefined;
      const key =
        identifier !== undefined
          ? `id:${identifier}`
          : `xy:${path.coordinates[2 * i]},${path.coordinates[2 * i + 1]}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      points.push({ key, identifier, position: i - start });
    }
    contours.push({
      points,
      length: contour.endPoint + 1 - start,
      isClosed: !!contour.isClosed,
    });
    start = contour.endPoint + 1;
  }
  for (const contour of contours) {
    contour.points = contour.points.filter(({ key }) => counts.get(key) === 1);
  }
  return contours;
}

// Where each followed point of a path is: point key → its contour, its index
// in it, and the number of points and closedness of that contour
function pointPlaces(path) {
  const places = new Map();
  for (const [contourIndex, contour] of followedPoints(path).entries()) {
    const { length, isClosed } = contour;
    for (const { key, position } of contour.points) {
      places.set(key, { contourIndex, position, length, isClosed });
    }
  }
  return places;
}

// +1 when a point at place comes after the point at position previous along
// their contour, -1 when before it, 0 when that cannot be told
function direction(place, previous) {
  const step = place.position - previous;
  if (!place.isClosed) {
    return Math.sign(step);
  }
  const forward = ((step % place.length) + place.length) % place.length;
  const backward = place.length - forward;
  return forward === 0 || forward === backward ? 0 : forward < backward ? 1 : -1;
}

function setChange(changePath, value) {
  return value === undefined
    ? { p: changePath, f: "d", a: [STROKE_KEY] }
    : { p: changePath, f: "=", a: [STROKE_KEY, clone(value)] };
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
