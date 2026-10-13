// The stroke width tool: handles on the edges of the points of centerlines,
// dragged to change the widths of the points; in a glyph of the nib method,
// handles on the ends of the nib's axes (see nib-handles.js). Everything else
// (clicking and dragging points, keys) goes to Fontra's pointer tool, so
// points can be moved without switching tools.
//
// Fontra's edit tools are classes of its own bundle, which plugins cannot
// import; Fontra only needs an object with the methods below.

import { defaultSourceIndex, findStrokeSource, layerPath } from "./current-source.js";
import {
  add,
  dot,
  endTangent,
  isDegenerateSegment,
  leftNormal,
  normalize,
  scale,
  startTangent,
  sub,
} from "./geometry/bezier.js";
import { centerlineSegments } from "./geometry/centerline.js";
import {
  CLEARED_POINT_VALUES,
  centerlinePoints,
  closedContourPoints,
  editPointValues,
  editingSourceIndices,
  measurePoints,
  pointValuesForField,
  selectedPointIndices,
} from "./point-edit.js";
import { KNOB_DISTANCE, draggedNibValues, nibDrag, nibHandles } from "./nib-handles.js";
import {
  JOINS,
  STROKE_KEY,
  getGlyphStroke,
  isCenterlineContour,
} from "./stroke-data.js";
import { t } from "./strings.js";

export const TOOL_IDENTIFIER = "fontra-plugin.stroke-font.width-tool";

// Pixels the pointer must move before a press becomes a drag
const MINIMUM_DRAG_DISTANCE = 2;

/**
 * The handles of the glyph being edited: for each on-curve point of each
 * centerline, one on its left edge and one on its right edge, along the
 * normal of the centerline there (between the two normals at a corner).
 * @returns {{pointIndex: number, side: "left"|"right", anchor: object,
 *   handle: object, normal: object, width: number}[]} in glyph coordinates;
 *   normal points from the anchor (the point) towards the handle
 */
export function widthHandles(positionedGlyph, location) {
  const path = positionedGlyph?.glyph?.path;
  if (!path) {
    return [];
  }
  const all = [];
  for (const contour of path.contourInfo ?? []) {
    const start = all.length;
    for (let i = start; i <= contour.endPoint; i++) {
      all.push(i);
    }
  }
  const measured = measurePoints(positionedGlyph, location, all);
  if (!measured || measured.style.type === "nib") {
    return [];
  }
  // Closed contours that are outlines get no handles
  const centerlines = new Set(
    (path.contourInfo ?? [])
      .map((contour, index) =>
        isCenterlineContour(contour.isClosed, measured.style.points?.[index])
          ? index
          : -1
      )
      .filter((index) => index >= 0)
  );
  const normals = pointNormals(path, centerlines);
  const handles = [];
  for (const point of measured.points) {
    if (!centerlines.has(point.contourIndex)) {
      continue;
    }
    const normal = normals.get(point.pointIndex);
    if (!normal) {
      continue;
    }
    const anchor = pointPosition(path, point.pointIndex);
    for (const side of ["left", "right"]) {
      const outward = side === "left" ? normal : scale(normal, -1);
      handles.push({
        pointIndex: point.pointIndex,
        side,
        anchor,
        normal: outward,
        width: point[side],
        handle: add(anchor, scale(outward, point[side])),
      });
    }
  }
  return handles;
}

// The left normal of the centerline at each on-curve point of the open
// contours: of the segment arriving or leaving, halfway between both at a
// corner
function pointNormals(path, centerlines) {
  const normals = new Map();
  for (const [contourIndex, info] of (path.contourInfo ?? []).entries()) {
    if (!centerlines.has(contourIndex)) {
      continue;
    }
    const start = contourIndex ? path.contourInfo[contourIndex - 1].endPoint + 1 : 0;
    let contour;
    try {
      contour = path.getUnpackedContour(contourIndex);
    } catch (e) {
      continue;
    }
    const arriving = new Map();
    const leaving = new Map();
    for (const segment of centerlineSegments(contour)) {
      if (isDegenerateSegment(segment)) {
        continue;
      }
      if (segment.startIndex !== undefined && !leaving.has(segment.startIndex)) {
        leaving.set(segment.startIndex, leftNormal(startTangent(segment)));
      }
      if (segment.endIndex !== undefined) {
        arriving.set(segment.endIndex, leftNormal(endTangent(segment)));
      }
    }
    for (const index of new Set([...arriving.keys(), ...leaving.keys()])) {
      const a = arriving.get(index);
      const b = leaving.get(index);
      let normal = a && b ? add(a, b) : (a ?? b);
      if (Math.hypot(normal.x, normal.y) < 1e-6) {
        // A stroke turning back on itself: the arriving segment's normal
        normal = a;
      }
      normals.set(start + index, normalize(normal));
    }
  }
  return normals;
}

function pointPosition(path, pointIndex) {
  return {
    x: path.coordinates[pointIndex * 2],
    y: path.coordinates[pointIndex * 2 + 1],
  };
}

/** The handle nearest to a point, within a distance, or undefined. */
export function handleAt(handles, point, margin) {
  return handlesAt(handles, point, margin)[0];
}

/**
 * The handles of a glyph: width handles, or for a glyph of the nib method,
 * the handles and the nibs of its points (see nib-handles.js).
 * @param {number} [onePixelUnit] glyph units per pixel, for placing the knob
 *   that turns a nib
 * @returns {{handles: object[], nibs?: object[]}}
 */
export function glyphHandles(positionedGlyph, location, onePixelUnit = 1) {
  const varGlyph = positionedGlyph?.varGlyph ?? positionedGlyph?.glyph?.varGlyph;
  if (getGlyphStroke(varGlyph?.glyph?.customData).type === "nib") {
    const nib = nibHandles(positionedGlyph, location, {
      knobDistance: KNOB_DISTANCE * onePixelUnit,
    });
    return { handles: nib?.handles ?? [], nibs: nib?.nibs ?? [] };
  }
  return { handles: widthHandles(positionedGlyph, location) };
}

/**
 * The handles at the place of the one nearest to a point (within a
 * distance): more than one where handles lie on top of each other, as the
 * two handles of a point without width do.
 */
export function handlesAt(handles, point, margin) {
  let nearest;
  let nearestDistance = margin;
  for (const handle of handles) {
    const distance = Math.hypot(handle.handle.x - point.x, handle.handle.y - point.y);
    if (distance <= nearestDistance) {
      nearest = handle;
      nearestDistance = distance;
    }
  }
  if (!nearest) {
    return [];
  }
  return handles.filter(
    (handle) =>
      Math.hypot(
        handle.handle.x - nearest.handle.x,
        handle.handle.y - nearest.handle.y
      ) < 1e-6
  );
}

/** Of handles on top of each other, the one pointing most along a move. */
export function handleForMove(candidates, move) {
  let best = candidates[0];
  for (const candidate of candidates) {
    if (dot(candidate.normal, move) > dot(best.normal, move)) {
      best = candidate;
    }
  }
  return best;
}

/**
 * The values of the dragged points for a drag of a handle by `delta` (glyph
 * units, along the handle's normal): both sides change by delta, or only the
 * dragged side with `oneSide`. Widths do not go below zero.
 * @param {{left: number, right: number, values: object|undefined}} start the
 *   point's widths and values when the drag started
 */
export function draggedValues(start, side, delta, oneSide) {
  if (oneSide) {
    return pointValuesForField(start.values, side, Math.max(0, start[side] + delta));
  }
  const left = Math.max(0, start.left + delta);
  const right = Math.max(0, start.right + delta);
  if (Math.abs(left - right) < 1e-9) {
    return { width: round(left + right), left: undefined, right: undefined };
  }
  return { left: round(left), right: round(right), width: undefined };
}

function round(value) {
  return Math.round(value * 100) / 100;
}

export class StrokeWidthTool {
  /**
   * @param {object} editor Fontra's editor
   * @param {string} iconPath
   */
  constructor(editor, iconPath) {
    this.editor = editor;
    this.sceneController = editor.sceneController;
    this.canvasController = editor.canvasController;
    this.identifier = TOOL_IDENTIFIER;
    this.iconPath = iconPath;
    this.isActive = false;
    // Read by the handles layer
    this.hoveredHandle = undefined;
    this.draggedHandle = undefined;
    this.dragLabel = undefined;
  }

  get pointerTool() {
    return this.editor.tools?.["pointer-tool"];
  }

  activate() {
    this.isActive = true;
    this.canvasController.canvas.style.cursor = "default";
    this.pointerTool?.activate?.();
    this.canvasController.requestUpdate();
  }

  deactivate() {
    this.isActive = false;
    this.hoveredHandle = undefined;
    this.pointerTool?.deactivate?.();
    this.canvasController.requestUpdate();
  }

  /** The handles of the glyph being edited, in glyph coordinates. */
  currentHandles() {
    const sceneModel = this.sceneController.sceneModel;
    const positionedGlyph = sceneModel.getSelectedPositionedGlyph?.();
    if (
      !positionedGlyph?.isEditing &&
      !this.sceneController.sceneSettings?.selectedGlyph?.isEditing
    ) {
      return { positionedGlyph, handles: [] };
    }
    const location = sceneModel.getLocationForGlyph?.(positionedGlyph?.glyphName);
    return {
      positionedGlyph,
      location,
      ...glyphHandles(
        positionedGlyph,
        location,
        this.sceneController.onePixelUnit ?? this.canvasController.onePixelUnit
      ),
    };
  }

  _handlesAtEvent(event) {
    const point = this.sceneController.selectedGlyphPoint(event);
    if (!point) {
      return [];
    }
    const { handles } = this.currentHandles();
    return handlesAt(handles, point, this.sceneController.mouseClickMargin);
  }

  _handleAtEvent(event) {
    return this._handlesAtEvent(event)[0];
  }

  handleHover(event) {
    const handle = event?.x !== undefined ? this._handleAtEvent(event) : undefined;
    if (!sameHandle(handle, this.hoveredHandle)) {
      this.hoveredHandle = handle;
      this.canvasController.requestUpdate();
    }
    if (handle) {
      this.sceneController.hoverSelection = new Set();
      this.canvasController.canvas.style.cursor = "pointer";
      return;
    }
    this.pointerTool?.handleHover(event);
  }

  handleKeyDown(event) {
    this.pointerTool?.handleKeyDown(event);
  }

  async handleDrag(eventStream, initialEvent) {
    const candidates = this._handlesAtEvent(initialEvent);
    if (!candidates.length) {
      await this.pointerTool?.handleDrag(eventStream, initialEvent);
      return;
    }
    if (initialEvent.detail === 2) {
      await this._clearValues(candidates[0]);
      return;
    }
    if (candidates[0].axis) {
      await this._dragNibHandle(candidates[0], eventStream, initialEvent);
      return;
    }
    await this._dragHandle(candidates, eventStream, initialEvent);
  }

  // The selected points when the dragged point is one of them, else that point
  _draggedPoints(handle) {
    const selected = selectedPointIndices(this.sceneController.selection);
    return selected.includes(handle.pointIndex) ? selected : [handle.pointIndex];
  }

  _editTarget() {
    const { positionedGlyph, location } = this.currentHandles();
    const { varGlyph, sourceIndex, atSource } = findStrokeSource(
      positionedGlyph,
      location
    );
    return { positionedGlyph, location, varGlyph, sourceIndex, atSource };
  }

  async _clearValues(handle) {
    const { varGlyph, sourceIndex, positionedGlyph } = this._editTarget();
    const pointIndices = this._draggedPoints(handle);
    const sourceIndices = editingSourceIndices(
      varGlyph,
      sourceIndex,
      this.sceneController.editingLayerNames ?? []
    );
    const defaultIndex = defaultSourceIndex(varGlyph);
    await this._edit(sourceIndices, defaultIndex, (glyph) => {
      editPointValues(glyph, sourceIndices, pointIndices, () => CLEARED_POINT_VALUES, {
        defaultIndex,
      });
      return t("undo.pointClear");
    });
  }

  // candidates: the handles under the pointer; when several lie on top of
  // each other, the first move decides which one is dragged
  async _dragHandle(candidates, eventStream, initialEvent) {
    const { positionedGlyph, location, varGlyph, sourceIndex } = this._editTarget();
    let handle = candidates[0];
    const pointIndices = this._draggedPoints(handle);
    const measured = measurePoints(positionedGlyph, location, pointIndices);
    const starts = new Map(
      measured?.points.map((point) => [point.pointIndex, point]) ?? []
    );
    const sourceIndices = editingSourceIndices(
      varGlyph,
      sourceIndex,
      this.sceneController.editingLayerNames ?? []
    );
    const defaultIndex = defaultSourceIndex(varGlyph);
    const startPoint = this.sceneController.selectedGlyphPoint(initialEvent);

    this.draggedHandle = handle;
    try {
      await this.sceneController.editGlyph(async (sendIncrementalChange, glyph) => {
        const recorder = new StrokeDataRecorder(glyph, sourceIndices, defaultIndex);
        let moved = false;
        for await (const event of eventStream) {
          if (event.x === undefined) {
            continue;
          }
          if (
            !moved &&
            Math.hypot(
              event.pageX - initialEvent.pageX,
              event.pageY - initialEvent.pageY
            ) <= MINIMUM_DRAG_DISTANCE
          ) {
            continue;
          }
          const point = this.sceneController.selectedGlyphPoint(event);
          if (!moved && candidates.length > 1) {
            handle = handleForMove(candidates, sub(point, startPoint));
            this.draggedHandle = handle;
          }
          moved = true;
          const delta = dot(sub(point, startPoint), handle.normal);
          recorder.restore();
          editPointValues(
            glyph,
            sourceIndices,
            pointIndices,
            (stored, pointIndex, editedSourceIndex) => {
              const start = starts.get(pointIndex);
              if (!start) {
                return {};
              }
              // Other sources keep their own values for the other side
              const values = editedSourceIndex === sourceIndex ? start.values : stored;
              return draggedValues(
                { ...start, values },
                handle.side,
                delta,
                event.altKey
              );
            },
            { defaultIndex }
          );
          const own = starts.get(handle.pointIndex);
          this.dragLabel = own
            ? formatNumber(
                Math.max(0, own[handle.side] + delta) +
                  (event.altKey ? 0 : Math.max(0, own[otherSide(handle.side)] + delta))
              )
            : undefined;
          await sendIncrementalChange(recorder.change(), true);
        }
        if (!moved) {
          return {};
        }
        await sendIncrementalChange(recorder.change());
        return {
          changes: recorder.changes(),
          undoLabel: t("undo.pointWidth"),
        };
      });
    } finally {
      this.draggedHandle = undefined;
      this.dragLabel = undefined;
      this.canvasController.requestUpdate();
    }
  }

  async _dragNibHandle(handle, eventStream, initialEvent) {
    const { positionedGlyph, location, varGlyph, sourceIndex } = this._editTarget();
    const pointIndices = this._draggedPoints(handle);
    const measured = measurePoints(positionedGlyph, location, pointIndices);
    const starts = new Map(
      measured?.points.map((point) => [point.pointIndex, point]) ?? []
    );
    const own = starts.get(handle.pointIndex);
    if (!own || measured.style.type !== "nib") {
      return;
    }
    const sourceIndices = editingSourceIndices(
      varGlyph,
      sourceIndex,
      this.sceneController.editingLayerNames ?? []
    );
    const defaultIndex = defaultSourceIndex(varGlyph);

    this.draggedHandle = handle;
    try {
      await this.sceneController.editGlyph(async (sendIncrementalChange, glyph) => {
        const recorder = new StrokeDataRecorder(glyph, sourceIndices, defaultIndex);
        let moved = false;
        for await (const event of eventStream) {
          if (event.x === undefined) {
            continue;
          }
          if (
            !moved &&
            Math.hypot(
              event.pageX - initialEvent.pageX,
              event.pageY - initialEvent.pageY
            ) <= MINIMUM_DRAG_DISTANCE
          ) {
            continue;
          }
          moved = true;
          const drag = nibDrag(
            handle,
            own,
            this.sceneController.selectedGlyphPoint(event),
            {
              altKey: event.altKey,
              shiftKey: event.shiftKey,
            }
          );
          recorder.restore();
          editPointValues(
            glyph,
            sourceIndices,
            pointIndices,
            (stored, pointIndex) => {
              const start = starts.get(pointIndex);
              return start ? draggedNibValues(start, handle.axis, drag) : {};
            },
            { defaultIndex }
          );
          this.dragLabel =
            handle.axis === "rotate"
              ? `${formatNumber(drag.angle)}°`
              : handle.axis === "major" && event.altKey
                ? `${formatNumber(drag.length)} · ${formatNumber(drag.angle)}°`
                : formatNumber(drag.length);
          await sendIncrementalChange(recorder.change(), true);
        }
        if (!moved) {
          return {};
        }
        await sendIncrementalChange(recorder.change());
        return { changes: recorder.changes(), undoLabel: t("undo.pointNib") };
      });
    } finally {
      this.draggedHandle = undefined;
      this.dragLabel = undefined;
      this.canvasController.requestUpdate();
    }
  }

  // One undoable change outside a drag
  async _edit(sourceIndices, defaultIndex, editFunc) {
    await this.sceneController.editGlyph(async (sendIncrementalChange, glyph) => {
      const recorder = new StrokeDataRecorder(glyph, sourceIndices, defaultIndex);
      const undoLabel = editFunc(glyph);
      await sendIncrementalChange(recorder.change());
      return { changes: recorder.changes(), undoLabel };
    });
  }

  getContextMenuItems() {
    const { varGlyph, sourceIndex, atSource, positionedGlyph } = this._editTarget();
    const defaultIndex = defaultSourceIndex(varGlyph);
    const path = positionedGlyph?.glyph?.path;
    const pointIndices = centerlinePoints(
      path ?? { contourInfo: [] },
      selectedPointIndices(this.sceneController.selection)
    ).map((point) => point.pointIndex);
    if (!atSource || !pointIndices.length) {
      return [];
    }
    const sourceIndices = editingSourceIndices(
      varGlyph,
      sourceIndex,
      this.sceneController.editingLayerNames ?? []
    );
    const setJoin = (join) =>
      this._edit(sourceIndices, defaultIndex, (glyph) => {
        editPointValues(glyph, sourceIndices, pointIndices, () => ({ join }), {
          defaultIndex,
        });
        return t("undo.pointJoin");
      });
    const items = [];
    const closedPoints = closedContourPoints(
      path,
      selectedPointIndices(this.sceneController.selection)
    );
    if (closedPoints.length) {
      const state = measurePoints(
        positionedGlyph,
        this._editTarget().location,
        closedPoints
      )?.points.some((point) => point.values?.centerline);
      items.push({
        title: t("points.closedCenterline"),
        enabled: () => true,
        checked: !!state,
        callback: () =>
          this._edit(sourceIndices, defaultIndex, (glyph) => {
            editPointValues(
              glyph,
              sourceIndices,
              closedPoints,
              () => ({ centerline: state ? undefined : true }),
              { defaultIndex }
            );
            return t("undo.closedCenterline");
          }),
      });
    }
    if (getGlyphStroke(varGlyph?.glyph?.customData).type === "nib") {
      return items;
    }
    return [
      ...items,
      {
        title: t("menu.pointJoin"),
        getItems: () => [
          {
            title: t("point.sourceValue"),
            enabled: () => true,
            callback: () => setJoin(undefined),
          },
          ...JOINS.map((join) => ({
            title: t(`join.${join}`),
            enabled: () => true,
            callback: () => setJoin(join),
          })),
        ],
      },
    ];
  }
}

function formatNumber(value) {
  return String(Math.round(value * 10) / 10);
}

function otherSide(side) {
  return side === "left" ? "right" : "left";
}

function sameHandle(a, b) {
  return a?.pointIndex === b?.pointIndex && a?.side === b?.side;
}

/**
 * Records changes to the stroke data of a glyph's sources and the point
 * attributes of their paths as Fontra changes, without Fontra's change
 * recorder (which plugins cannot import). Changes are made to the glyph
 * directly; restore() puts back what was there at the start.
 */
export class StrokeDataRecorder {
  constructor(glyph, sourceIndices, defaultIndex) {
    this.glyph = glyph;
    const indices = new Set(sourceIndices);
    if (defaultIndex !== undefined) {
      indices.add(defaultIndex);
    }
    this.targets = [...indices]
      .map((sourceIndex) => {
        const source = glyph.sources[sourceIndex];
        const path = layerPath(glyph, source);
        return source && path
          ? {
              sourceIndex,
              layerName: source.layerName,
              strokeData: clone(source.customData?.[STROKE_KEY]),
              pointAttributes: clone(path.pointAttributes),
            }
          : null;
      })
      .filter(Boolean);
  }

  restore() {
    for (const target of this.targets) {
      const source = this.glyph.sources[target.sourceIndex];
      if (!source.customData) {
        source.customData = {};
      }
      setOrDelete(source.customData, STROKE_KEY, clone(target.strokeData));
      layerPath(this.glyph, source).pointAttributes = clone(target.pointAttributes);
    }
  }

  // The change from the start to now
  change() {
    return { c: this._changes(false) };
  }

  /** As Fontra's ChangeCollector: hasChange, change, rollbackChange. */
  changes() {
    const forward = this._changes(false);
    return {
      hasChange: forward.length > 0,
      change: { c: forward },
      rollbackChange: { c: this._changes(true) },
    };
  }

  _changes(rollback) {
    const changes = [];
    for (const target of this.targets) {
      const source = this.glyph.sources[target.sourceIndex];
      const path = layerPath(this.glyph, source);
      const nowStroke = source.customData?.[STROKE_KEY];
      const nowAttributes = path.pointAttributes ?? null;
      const before = {
        stroke: target.strokeData,
        attributes: target.pointAttributes ?? null,
      };
      const after = { stroke: nowStroke, attributes: nowAttributes };
      if (JSON.stringify(before.stroke) !== JSON.stringify(after.stroke)) {
        const value = rollback ? before.stroke : after.stroke;
        const changePath = ["sources", target.sourceIndex, "customData"];
        changes.push(
          value === undefined
            ? { p: changePath, f: "d", a: [STROKE_KEY] }
            : { p: changePath, f: "=", a: [STROKE_KEY, clone(value)] }
        );
      }
      if (JSON.stringify(before.attributes) !== JSON.stringify(after.attributes)) {
        changes.push({
          p: ["layers", target.layerName, "glyph", "path"],
          f: "=",
          a: [
            "pointAttributes",
            clone(rollback ? before.attributes : after.attributes),
          ],
        });
      }
    }
    return changes;
  }
}

function setOrDelete(object, key, value) {
  if (value === undefined) {
    delete object[key];
  } else {
    object[key] = value;
  }
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
