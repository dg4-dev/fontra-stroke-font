import assert from "node:assert/strict";
import { test } from "node:test";

import { editPointValues } from "../src/point-edit.js";
import { STROKE_KEY } from "../src/stroke-data.js";
import {
  StrokeDataRecorder,
  StrokeWidthTool,
  draggedValues,
  handleAt,
  widthHandles,
} from "../src/width-tool.js";
import { fakePath, fakePositionedGlyph } from "./fakes.js";
import { on } from "./helpers.js";

const withId = (point, identifier) => ({ ...point, attrs: { identifier } });
const pointsData = (points) => ({ [STROKE_KEY]: { points } });

function assertPoint(actual, expected) {
  assert.ok(
    Math.abs(actual.x - expected.x) < 1e-6 && Math.abs(actual.y - expected.y) < 1e-6,
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

test("each point of a centerline has a handle on each edge", () => {
  const glyph = fakePositionedGlyph({
    contours: [
      { points: [on(0, 0), withId(on(200, 0), "b")], isClosed: false },
      { points: [on(0, 0), on(10, 0), on(0, 10)], isClosed: true },
    ],
    sources: [{ customData: pointsData({ b: { left: 50, right: 20 } }) }],
  });
  const handles = widthHandles(glyph, {});
  assert.equal(handles.length, 4);
  const at = (pointIndex, side) =>
    handles.find((h) => h.pointIndex === pointIndex && h.side === side);
  assertPoint(at(0, "left").handle, { x: 0, y: 40 });
  assertPoint(at(0, "right").handle, { x: 0, y: -40 });
  assertPoint(at(1, "left").handle, { x: 200, y: 50 });
  assertPoint(at(1, "right").handle, { x: 200, y: -20 });
  assertPoint(at(1, "right").normal, { x: 0, y: -1 });
});

test("at a corner, the handles are between the two normals", () => {
  const glyph = fakePositionedGlyph({
    contours: [{ points: [on(0, 0), on(100, 0), on(100, 100)], isClosed: false }],
  });
  const corner = widthHandles(glyph, {}).find(
    (h) => h.pointIndex === 1 && h.side === "left"
  );
  assertPoint(corner.normal, { x: -Math.SQRT1_2, y: Math.SQRT1_2 });
});

test("the nearest handle within the margin is found", () => {
  const handles = [
    { pointIndex: 0, side: "left", handle: { x: 0, y: 40 } },
    { pointIndex: 1, side: "left", handle: { x: 0, y: 44 } },
  ];
  assert.equal(handleAt(handles, { x: 0, y: 43 }, 5).pointIndex, 1);
  assert.equal(handleAt(handles, { x: 20, y: 43 }, 5), undefined);
});

test("dragging a handle changes both sides, or one with Alt", () => {
  const start = { left: 40, right: 40, values: undefined };
  assert.deepEqual(draggedValues(start, "left", 10, false), {
    width: 100,
    left: undefined,
    right: undefined,
  });
  assert.deepEqual(draggedValues({ ...start, right: 20 }, "left", 10, false), {
    left: 50,
    right: 30,
    width: undefined,
  });
  // Alt: only the dragged side; the other side keeps following its points
  assert.deepEqual(draggedValues(start, "right", -15, true), {
    right: 25,
    width: undefined,
  });
  assert.deepEqual(draggedValues(start, "left", -100, false).width, 0);
});

function editableGlyph() {
  return {
    sources: [{ layerName: "a", customData: {} }],
    layers: {
      a: {
        glyph: {
          path: fakePath([{ points: [on(0, 0), on(200, 0)], isClosed: false }]),
        },
      },
    },
  };
}

test("changes to stroke data and point identifiers are recorded and undone", () => {
  const glyph = editableGlyph();
  const recorder = new StrokeDataRecorder(glyph, [0], 0);
  assert.equal(recorder.changes().hasChange, false);
  editPointValues(glyph, [0], [1], () => ({ width: 120 }), { defaultIndex: 0 });
  const identifier = glyph.layers.a.glyph.path.pointAttributes[1].identifier;
  const { hasChange, change, rollbackChange } = recorder.changes();
  assert.ok(hasChange);
  assert.deepEqual(change.c, [
    {
      p: ["sources", 0, "customData"],
      f: "=",
      a: [STROKE_KEY, { points: { [identifier]: { width: 120 } } }],
    },
    {
      p: ["layers", "a", "glyph", "path"],
      f: "=",
      a: ["pointAttributes", [null, { identifier }]],
    },
  ]);
  assert.deepEqual(rollbackChange.c, [
    { p: ["sources", 0, "customData"], f: "d", a: [STROKE_KEY] },
    { p: ["layers", "a", "glyph", "path"], f: "=", a: ["pointAttributes", null] },
  ]);
  recorder.restore();
  assert.deepEqual(glyph.sources[0].customData, {});
  assert.equal(glyph.layers.a.glyph.path.pointAttributes, null);
});

function fakeEditor(positionedGlyph, { selection = new Set() } = {}) {
  const sent = [];
  const results = [];
  const pointerCalls = [];
  const canvas = { style: {} };
  const sceneController = {
    sceneModel: {
      getSelectedPositionedGlyph: () => positionedGlyph,
      getLocationForGlyph: () => ({}),
    },
    sceneSettings: { selectedGlyph: { isEditing: true } },
    selection,
    editingLayerNames: [],
    mouseClickMargin: 5,
    hoverSelection: new Set(),
    selectedGlyphPoint: (event) => event.glyphPoint,
    async editGlyph(editFunc) {
      const result = await editFunc(
        async (change) => sent.push(change),
        positionedGlyph.varGlyph.glyph
      );
      results.push(result);
    },
  };
  const pointer = {
    activate() {},
    deactivate() {},
    handleHover: (event) => pointerCalls.push(["hover", event]),
    handleDrag: async (stream, event) => pointerCalls.push(["drag", event]),
    handleKeyDown: (event) => pointerCalls.push(["key", event]),
  };
  return {
    editor: {
      sceneController,
      canvasController: { canvas, requestUpdate() {} },
      tools: { "pointer-tool": pointer },
    },
    sent,
    results,
    pointerCalls,
    canvas,
  };
}

async function* events(...list) {
  for (const event of list) {
    yield event;
  }
}

const mouse = (x, y, extra = {}) => ({
  x,
  y,
  pageX: x,
  pageY: -y,
  glyphPoint: { x, y },
  ...extra,
});

test("dragging a handle writes the point's width as one undoable change", async () => {
  const glyph = fakePositionedGlyph({
    contours: [{ points: [on(0, 0), on(200, 0)], isClosed: false }],
  });
  const { editor, sent, results, pointerCalls } = fakeEditor(glyph);
  const tool = new StrokeWidthTool(editor, "icon.svg");
  tool.activate();
  await tool.handleDrag(events(mouse(200, 45), mouse(200, 60)), mouse(200, 40));
  assert.deepEqual(pointerCalls, []);
  const path = glyph.varGlyph.layers.layer0.glyph.path;
  const identifier = path.pointAttributes[1].identifier;
  assert.deepEqual(glyph.varGlyph.sources[0].customData[STROKE_KEY].points, {
    [identifier]: { width: 120 },
  });
  assert.equal(results.length, 1);
  assert.ok(results[0].changes.hasChange);
  assert.equal(results[0].undoLabel, "Change point width");
  assert.ok(sent.length >= 2);
});

test("a press that does not move changes nothing", async () => {
  const glyph = fakePositionedGlyph({
    contours: [{ points: [on(0, 0), on(200, 0)], isClosed: false }],
  });
  const { editor, results } = fakeEditor(glyph);
  const tool = new StrokeWidthTool(editor, "icon.svg");
  await tool.handleDrag(events(mouse(200, 41)), mouse(200, 40));
  assert.deepEqual(results, [{}]);
  assert.equal(glyph.varGlyph.sources[0].customData[STROKE_KEY], undefined);
});

test("dragging a selected point's handle changes all selected points", async () => {
  const glyph = fakePositionedGlyph({
    contours: [{ points: [on(0, 0), on(100, 0), on(200, 0)], isClosed: false }],
  });
  const { editor } = fakeEditor(glyph, { selection: new Set(["point/0", "point/2"]) });
  const tool = new StrokeWidthTool(editor, "icon.svg");
  // Alt: the right side only
  await tool.handleDrag(
    events(mouse(0, -50, { altKey: true })),
    mouse(0, -40, { altKey: true })
  );
  const values = Object.values(glyph.varGlyph.sources[0].customData[STROKE_KEY].points);
  assert.deepEqual(values, [{ right: 50 }, { right: 50 }]);
});

test("a double click on a handle clears the point's values", async () => {
  const glyph = fakePositionedGlyph({
    contours: [{ points: [on(0, 0), withId(on(200, 0), "b")], isClosed: false }],
    sources: [{ customData: pointsData({ b: { width: 120 } }) }],
  });
  const { editor, results } = fakeEditor(glyph);
  const tool = new StrokeWidthTool(editor, "icon.svg");
  await tool.handleDrag(events(), mouse(200, 60, { detail: 2 }));
  assert.equal(glyph.varGlyph.sources[0].customData[STROKE_KEY], undefined);
  assert.equal(results[0].undoLabel, "Clear point values");
});

test("away from handles, the pointer tool does the work", async () => {
  const glyph = fakePositionedGlyph({
    contours: [{ points: [on(0, 0), on(200, 0)], isClosed: false }],
  });
  const { editor, pointerCalls, canvas } = fakeEditor(glyph);
  const tool = new StrokeWidthTool(editor, "icon.svg");
  tool.handleHover(mouse(100, 0));
  await tool.handleDrag(events(), mouse(100, 0));
  tool.handleKeyDown({ key: "Delete" });
  assert.deepEqual(
    pointerCalls.map(([kind]) => kind),
    ["hover", "drag", "key"]
  );
  tool.handleHover(mouse(0, 41));
  assert.equal(tool.hoveredHandle.pointIndex, 0);
  assert.equal(canvas.style.cursor, "pointer");
});

test("the context menu sets the join of the selected points", async () => {
  const glyph = fakePositionedGlyph({
    contours: [{ points: [on(0, 0), on(100, 0), on(100, 100)], isClosed: false }],
  });
  const { editor } = fakeEditor(glyph, { selection: new Set(["point/1"]) });
  const tool = new StrokeWidthTool(editor, "icon.svg");
  const [menu] = tool.getContextMenuItems();
  const bevel = menu.getItems().find((item) => item.title === "Bevel");
  await bevel.callback();
  const values = Object.values(glyph.varGlyph.sources[0].customData[STROKE_KEY].points);
  assert.deepEqual(values, [{ join: "bevel" }]);
  const nothing = fakeEditor(glyph).editor;
  assert.deepEqual(new StrokeWidthTool(nothing, "icon.svg").getContextMenuItems(), []);
});

test("of two handles on top of each other, the drag's direction picks one", async () => {
  const glyph = fakePositionedGlyph({
    contours: [{ points: [on(0, 0), withId(on(200, 0), "b")], isClosed: false }],
    sources: [{ customData: pointsData({ b: { width: 0 } }) }],
  });
  const { editor } = fakeEditor(glyph);
  const tool = new StrokeWidthTool(editor, "icon.svg");
  // Both handles of point 1 are on the point; dragging down takes the right one
  await tool.handleDrag(
    events(mouse(200, -30, { altKey: true })),
    mouse(200, 0, { altKey: true })
  );
  assert.deepEqual(glyph.varGlyph.sources[0].customData[STROKE_KEY].points, {
    b: { right: 30, left: 0 },
  });
});
