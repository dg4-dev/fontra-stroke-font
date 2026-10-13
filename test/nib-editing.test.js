import assert from "node:assert/strict";
import { test } from "node:test";

import { drawNibs, makeHandlesLayerDefinition } from "../src/handles-layer.js";
import { draggedNibValues, nibDrag, nibHandles } from "../src/nib-handles.js";
import { describeSelectedPoints } from "../src/point-edit.js";
import {
  STROKE_KEY,
  nearestNibAngle,
  sanitizeStrokeValue,
  setGlyphStroke,
} from "../src/stroke-data.js";
import { StrokeWidthTool, glyphHandles } from "../src/width-tool.js";
import { FakeContext, fakePositionedGlyph } from "./fakes.js";
import { on } from "./helpers.js";

const withId = (point, identifier) => ({ ...point, attrs: { identifier } });
const nibGlyph = (shape = "ellipse") => ({ [STROKE_KEY]: { type: "nib", shape } });
const nibSource = (defaults, points) => ({
  customData: { [STROKE_KEY]: { defaults, ...(points ? { points } : {}) } },
});

function assertClose(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} ≠ ${expected}`);
}

function assertPoint(actual, expected) {
  assertClose(actual.x, expected.x, "x");
  assertClose(actual.y, expected.y, "y");
}

const bar = (shape = "ellipse", defaults = { major: 100, minor: 40, angle: 0 }) =>
  fakePositionedGlyph({
    contours: [{ points: [on(0, 0), withId(on(200, 0), "b")], isClosed: false }],
    glyphCustomData: nibGlyph(shape),
    sources: [nibSource(defaults)],
  });

test("each point of a nib glyph has its nib, the ends of its axes and a knob", () => {
  const { nibs, handles } = nibHandles(bar(), {}, { knobDistance: 30 });
  assert.equal(nibs.length, 2);
  assert.equal(handles.length, 10);
  const at = (pointIndex, side) =>
    handles.find((h) => h.pointIndex === pointIndex && h.side === side);
  assertPoint(at(1, "major+").handle, { x: 250, y: 0 });
  assertPoint(at(1, "major-").handle, { x: 150, y: 0 });
  assertPoint(at(1, "minor+").handle, { x: 200, y: 20 });
  assertPoint(at(1, "minor-").normal, { x: 0, y: -1 });
  // The knob is beyond the "+" end of the major axis
  assertPoint(at(1, "rotate").handle, { x: 280, y: 0 });
  // A flat nib has no minor handles
  const flat = nibHandles(bar("rect", { major: 100, minor: 0, angle: 30 }), {});
  assert.deepEqual(
    flat.handles.map((h) => h.axis),
    ["major", "major", "rotate", "major", "major", "rotate"]
  );
  // Width glyphs have none
  const widthGlyph = fakePositionedGlyph({
    contours: [{ points: [on(0, 0), on(200, 0)], isClosed: false }],
  });
  assert.equal(nibHandles(widthGlyph, {}), null);
  assert.equal(glyphHandles(widthGlyph, {}).nibs, undefined);
  assert.equal(glyphHandles(bar(), {}).nibs.length, 2);
});

test("the knob turns the nib without sizing it", () => {
  const { handles } = nibHandles(bar(), {}, { knobDistance: 30 });
  const knob = handles.find((h) => h.pointIndex === 1 && h.side === "rotate");
  const start = { major: 100, minor: 40, angle: 0 };
  let drag = nibDrag(knob, start, { x: 200, y: 80 });
  assertClose(drag.angle, 90, "angle");
  // A quarter turn either way is the same nib
  assertClose(Math.abs(drag.rotation), 90, "rotation");
  assert.deepEqual(draggedNibValues(start, "rotate", drag), { angle: 90 });
  // Shift: steps of 15°
  drag = nibDrag(knob, start, { x: 250, y: 40 }, { shiftKey: true });
  assertClose(drag.angle, 45, "snapped angle");
});

test("dragging an end of the major axis sizes the nib, or with Alt turns it too", () => {
  const { handles } = nibHandles(bar(), {});
  const plus = handles.find((h) => h.pointIndex === 1 && h.side === "major+");
  const minus = handles.find((h) => h.pointIndex === 1 && h.side === "major-");
  const start = { major: 100, minor: 40, angle: 0 };
  // The length only, measured along the axis
  let drag = nibDrag(plus, start, { x: 300, y: 40 });
  assertClose(drag.length, 200, "length");
  assertClose(drag.angle, 0, "angle");
  assert.deepEqual(draggedNibValues(start, "major", drag), { major: 200 });
  // Alt: the end follows the pointer
  drag = nibDrag(plus, start, { x: 200, y: 80 }, { altKey: true });
  assertClose(drag.length, 160, "length with Alt");
  assertClose(drag.angle, 90, "angle with Alt");
  // The other end too: pointing down from the point is the same nib
  drag = nibDrag(minus, start, { x: 200, y: 80 }, { altKey: true });
  assertClose(drag.angle, 90, "angle from the other end");
});

test("dragging an end of the minor axis changes the minor axis only", () => {
  const { handles } = nibHandles(bar(), {});
  const minor = handles.find((h) => h.pointIndex === 1 && h.side === "minor+");
  const drag = nibDrag(minor, { major: 100, minor: 40, angle: 0 }, { x: 230, y: 50 });
  assertClose(drag.length, 100, "minor");
  assert.deepEqual(
    draggedNibValues({ major: 100, minor: 40, angle: 0 }, "minor", drag),
    {
      minor: 100,
    }
  );
});

test("all dragged points get the same ratio and rotation", () => {
  const drag = { length: 200, ratio: 2, angle: 30, rotation: 30 };
  assert.deepEqual(
    draggedNibValues({ major: 50, minor: 10, angle: 170 }, "major", drag),
    {
      major: 100,
      angle: 20,
    }
  );
  // A rotation through the end of the range turns the short way
  const turned = nibDrag(
    {
      axis: "rotate",
      side: "rotate",
      anchor: { x: 0, y: 0 },
      normal: {
        x: Math.cos((170 * Math.PI) / 180),
        y: Math.sin((170 * Math.PI) / 180),
      },
    },
    { major: 100, minor: 20, angle: 170 },
    { x: Math.cos((190 * Math.PI) / 180) * 50, y: Math.sin((190 * Math.PI) / 180) * 50 }
  );
  assertClose(turned.rotation, 20, "rotation");
  assertClose(turned.angle, 10, "angle");
});

function fakeEditor(positionedGlyph, { selection = new Set() } = {}) {
  const results = [];
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
      results.push(await editFunc(async () => {}, positionedGlyph.varGlyph.glyph));
    },
  };
  const pointer = {
    activate() {},
    deactivate() {},
    handleHover() {},
    handleDrag: async () => {},
    handleKeyDown() {},
  };
  return {
    editor: {
      sceneController,
      canvasController: { canvas: { style: {} }, requestUpdate() {} },
      tools: { "pointer-tool": pointer },
    },
    results,
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

test("the tool drags nib handles as one undoable change", async () => {
  const glyph = bar();
  const { editor, results } = fakeEditor(glyph);
  const tool = new StrokeWidthTool(editor, "icon.svg");
  tool.activate();
  // The end of the major axis: the length only
  await tool.handleDrag(events(mouse(270, 20), mouse(290, 0)), mouse(250, 0));
  assert.deepEqual(glyph.varGlyph.sources[0].customData[STROKE_KEY].points, {
    b: { major: 180 },
  });
  // The knob (24 pixels beyond, at one unit per pixel): the angle only
  await tool.handleDrag(events(mouse(250, 50), mouse(200, 80)), mouse(314, 0));
  assert.deepEqual(glyph.varGlyph.sources[0].customData[STROKE_KEY].points, {
    b: { major: 180, angle: 90 },
  });
  results.splice(1);
  assert.equal(results.length, 1);
  assert.equal(results[0].undoLabel, "Change point nib");
  assert.equal(tool.dragLabel, undefined);
});

test("the tool drags the nibs of all selected points", async () => {
  const glyph = fakePositionedGlyph({
    contours: [
      { points: [withId(on(0, 0), "a"), withId(on(200, 0), "b")], isClosed: false },
    ],
    glyphCustomData: nibGlyph(),
    sources: [nibSource({ major: 100, minor: 40, angle: 0 }, { a: { major: 50 } })],
  });
  const { editor } = fakeEditor(glyph, { selection: new Set(["point/0", "point/1"]) });
  const tool = new StrokeWidthTool(editor, "icon.svg");
  // The minor axis of point 1, from 40 to 80
  await tool.handleDrag(events(mouse(200, 40)), mouse(200, 20));
  assert.deepEqual(glyph.varGlyph.sources[0].customData[STROKE_KEY].points, {
    a: { major: 50, minor: 80 },
    b: { minor: 80 },
  });
});

test("a double click on a nib handle clears the point's values", async () => {
  const glyph = fakePositionedGlyph({
    contours: [{ points: [on(0, 0), withId(on(200, 0), "b")], isClosed: false }],
    glyphCustomData: nibGlyph(),
    sources: [nibSource({ major: 100, minor: 40, angle: 0 }, { b: { major: 60 } })],
  });
  const { editor } = fakeEditor(glyph);
  const tool = new StrokeWidthTool(editor, "icon.svg");
  await tool.handleDrag(events(), mouse(230, 0, { detail: 2 }));
  assert.equal(glyph.varGlyph.sources[0].customData[STROKE_KEY].points, undefined);
});

test("the context menu of a nib glyph sets what angles are measured from", async () => {
  const glyph = fakePositionedGlyph({
    contours: [
      { points: [on(0, 0), withId(on(100, 0), "c"), on(100, 100)], isClosed: false },
    ],
    glyphCustomData: nibGlyph(),
  });
  const { editor } = fakeEditor(glyph, { selection: new Set(["point/1"]) });
  const items = new StrokeWidthTool(editor, "icon.svg").getContextMenuItems();
  // No joins: only the angle base
  assert.deepEqual(
    items.map((item) => item.title),
    ["Angle from"]
  );
  const choices = items[0].getItems();
  assert.deepEqual(
    choices.map((item) => item.title),
    ["Horizontal", "Centerline"]
  );
  await choices[1].callback();
  assert.deepEqual(glyph.varGlyph.sources[0].customData[STROKE_KEY].points, {
    c: { angleBase: "centerline" },
  });
});

test("a nib measured from the centerline is drawn and turned from it", async () => {
  // A vertical line: the centerline points up, at 90°
  const glyph = fakePositionedGlyph({
    contours: [
      {
        points: [on(0, 0), withId(on(0, 200), "t")],
        isClosed: false,
      },
    ],
    glyphCustomData: nibGlyph(),
    sources: [
      nibSource(
        { major: 100, minor: 40, angle: 0 },
        { t: { angleBase: "centerline", angle: 0 } }
      ),
    ],
  });
  const { handles } = nibHandles(glyph, {}, { knobDistance: 30 });
  const at = (side) => handles.find((h) => h.pointIndex === 1 && h.side === side);
  // Along the centerline: the major axis points up
  assertPoint(at("major+").handle, { x: 0, y: 250 });
  assertClose(at("rotate").frame, 90, "frame");
  // Turning the knob to the right of the point is -90° from the centerline
  const drag = nibDrag(
    at("rotate"),
    { major: 100, minor: 40, angle: 0 },
    { x: 80, y: 200 }
  );
  assertClose(drag.angle, 90, "angle (−90°, the same nib as 90°)");
});

test("the panel shows the nib of the selected points", () => {
  const glyph = fakePositionedGlyph({
    contours: [
      { points: [on(0, 0), withId(on(100, 0), "m"), on(200, 0)], isClosed: false },
    ],
    glyphCustomData: nibGlyph(),
    sources: [nibSource({ major: 100, minor: 40, angle: 30 }, { m: { angle: 170 } })],
  });
  const one = describeSelectedPoints(glyph, {}, new Set(["point/1"]));
  assert.equal(one.method, "nib");
  assert.ok(one.editable && one.stored);
  assert.deepEqual(one.fields, { major: 100, minor: 40, angle: 170, angleBase: "" });
  // Points with different angles have none in common
  const two = describeSelectedPoints(glyph, {}, new Set(["point/0", "point/1"]));
  assert.deepEqual(two.fields, {
    major: 100,
    minor: 40,
    angle: undefined,
    angleBase: "",
  });
  assert.equal(two.stored, true);
});

test("the handles layer draws the nibs with the setting", () => {
  const glyph = bar();
  const settings = new Map([
    ["handles", false],
    ["nibs", true],
  ]);
  const layer = makeHandlesLayerDefinition({ tool: { isActive: false }, settings });
  const parameters = { ...layer.screenParameters, ...layer.colors };
  const draw = () => {
    const context = new FakeContext();
    layer.draw({ context, positionedGlyph: glyph, parameters, model: {} });
    return context.calls;
  };
  const withNibs = draw();
  // Two ellipses of four curves, and no handles
  assert.equal(withNibs.filter(([name]) => name === "bezierCurveTo").length, 8);
  assert.equal(withNibs.filter(([name]) => name === "arc").length, 0);
  settings.set("nibs", false);
  assert.deepEqual(draw(), []);
  // A rectangle is four lines
  const context = new FakeContext();
  drawNibs(context, nibHandles(bar("rect"), {}).nibs.slice(0, 1), parameters);
  assert.equal(context.calls.filter(([name]) => name === "lineTo").length, 4);
});

test("stroke data: the method of a glyph, values of either method, angles", () => {
  const customData = { other: 1 };
  setGlyphStroke(customData, "nib", "rect");
  assert.deepEqual(customData, {
    other: 1,
    [STROKE_KEY]: { type: "nib", shape: "rect" },
  });
  setGlyphStroke(customData, "nib", "ellipse");
  assert.equal(customData[STROKE_KEY].shape, "ellipse");
  setGlyphStroke(customData, "offset");
  assert.deepEqual(customData, { other: 1 });
  assert.equal(sanitizeStrokeValue("angle", "-30"), 150);
  assert.equal(sanitizeStrokeValue("major", -5), 0);
  assert.equal(sanitizeStrokeValue("width", "abc"), undefined);
  assert.equal(nearestNibAngle(10, 170), 190);
  assert.equal(nearestNibAngle(170, 10), -10);
  assert.equal(nearestNibAngle(60, 10), 60);
});
