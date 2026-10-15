// Live corners in the plugin: the data, the preview, the panel and the
// stroke width tool (the geometry is in corners.test.js)

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cornerHandles,
  draggedCornerRadius,
  roundedCenterlines,
} from "../src/corner-handles.js";
import { strokeStyleForGlyph } from "../src/current-source.js";
import { strokeGlyph } from "../src/glyph-strokes.js";
import { drawCenterlines } from "../src/handles-layer.js";
import { describeSelectedPoints, pointValuesForField } from "../src/point-edit.js";
import {
  STROKE_KEY,
  resolvePointValues,
  sanitizePointValues,
  sanitizeStrokeValue,
} from "../src/stroke-data.js";
import { drawStrokePreview } from "../src/stroke-layer.js";
import { StrokeWidthTool, glyphHandles } from "../src/width-tool.js";
import { FakeContext, fakePositionedGlyph } from "./fakes.js";
import { on } from "./helpers.js";

const withId = (point, identifier) => ({ ...point, attrs: { identifier } });
const pointsData = (points) => ({ [STROKE_KEY]: { points } });
// A corner at (200, 0), turning left by 90°
const cornerContour = () => ({
  points: [withId(on(0, 0), "a"), withId(on(200, 0), "c"), withId(on(200, 200), "b")],
  isClosed: false,
});

function assertClose(actual, expected, tolerance = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${expected}, got ${actual}`
  );
}

test("corner radii are read on points; 0 is the same as none", () => {
  assert.deepEqual(sanitizePointValues({ cornerRadius: 20 }), { cornerRadius: 20 });
  assert.deepEqual(sanitizePointValues({ cornerRadius: "12.5" }), {
    cornerRadius: 12.5,
  });
  for (const value of [0, -5, "x", null]) {
    assert.equal(sanitizePointValues({ cornerRadius: value }), undefined);
  }
  assert.equal(sanitizeStrokeValue("cornerRadius", "-3"), 0);
  assert.equal(sanitizeStrokeValue("cornerRadius", "7"), 7);
  assert.equal(sanitizeStrokeValue("cornerRadius", "x"), undefined);
  // Written from the panel: 0 removes it
  assert.deepEqual(pointValuesForField({ cornerRadius: 9 }, "cornerRadius", 0), {
    cornerRadius: undefined,
  });
  assert.deepEqual(pointValuesForField(undefined, "cornerRadius", 15), {
    cornerRadius: 15,
  });
  assert.deepEqual(
    resolvePointValues(
      [[{ identifier: "c", onCurve: true }]],
      pointsData({ c: { cornerRadius: 30, width: 50 } })
    ),
    [[{ width: 50, cornerRadius: 30 }]]
  );
});

test("a corner rounded in another source gets radius 0 at a source", () => {
  const glyph = fakePositionedGlyph({
    contours: [cornerContour()],
    sources: [
      { customData: {} },
      { customData: pointsData({ c: { cornerRadius: 40 } }) },
    ],
  });
  assert.deepEqual(strokeStyleForGlyph(glyph, {}).points, [
    [undefined, { cornerRadius: 0 }, undefined],
  ]);
  // Without radii anywhere, nothing changes
  const plain = fakePositionedGlyph({
    contours: [cornerContour()],
    sources: [{ customData: {} }, { customData: {} }],
  });
  assert.equal(strokeStyleForGlyph(plain, {}).points, undefined);
});

test("between sources, corner radii are interpolated, with either method", () => {
  for (const glyphCustomData of [{}, { [STROKE_KEY]: { type: "nib" } }]) {
    const glyph = fakePositionedGlyph({
      contours: [cornerContour()],
      glyphCustomData,
      sources: [
        { customData: pointsData({ a: { width: 60 } }) },
        { customData: pointsData({ c: { cornerRadius: 40 } }) },
      ],
      sourceIndex: undefined,
    });
    const style = strokeStyleForGlyph(glyph, { wght: 500 });
    assert.equal(style.points[0][1].cornerRadius, 20);
    // At the first source: 0, still rounded
    const atLight = strokeStyleForGlyph(glyph, { wght: 300 });
    assert.equal(atLight.points[0][1].cornerRadius, 0);
  }
});

test("the preview marks the corners whose radius was made smaller", () => {
  // The segment after the corner is 100 long, too short for a radius of 150
  const glyph = fakePositionedGlyph({
    contours: [
      {
        points: [on(0, 0), withId(on(300, 0), "c"), on(300, 100)],
        isClosed: false,
      },
    ],
    sources: [{ customData: pointsData({ c: { cornerRadius: 150 } }) }],
  });
  const { shrunkCorners } = strokeGlyph(glyph, {});
  assert.equal(shrunkCorners.length, 1);
  assert.deepEqual(shrunkCorners[0].point, { x: 300, y: 0 });
  assert.equal(shrunkCorners[0].contourIndex, 0);
  const context = new FakeContext();
  drawStrokePreview(
    context,
    glyph,
    {},
    {
      fillColor: "gray",
      twistColor: "red",
      cornerColor: "blue",
      markerRadius: 5,
      markerWidth: 1,
    }
  );
  // A diamond around the corner
  const lines = context.calls.filter(([name]) => name === "lineTo").slice(-3);
  assert.deepEqual(lines, [
    ["lineTo", 305, 0],
    ["lineTo", 300, 5],
    ["lineTo", 295, 0],
  ]);
  assert.deepEqual(context.calls.at(-1), ["stroke", "blue", 1]);
  // A radius that fits is not marked
  const fits = fakePositionedGlyph({
    contours: [cornerContour()],
    sources: [{ customData: pointsData({ c: { cornerRadius: 50 } }) }],
  });
  assert.deepEqual(strokeGlyph(fits, {}).shrunkCorners, []);
});

test("the panel shows the corner radius of the selected points", () => {
  for (const glyphCustomData of [{}, { [STROKE_KEY]: { type: "nib" } }]) {
    const glyph = fakePositionedGlyph({
      contours: [cornerContour()],
      glyphCustomData,
      sources: [{ customData: pointsData({ c: { cornerRadius: 25 } }) }],
    });
    const one = describeSelectedPoints(glyph, {}, new Set(["point/1"]));
    assert.deepEqual(one.cornerFields, { cornerRadius: 25 });
    assert.ok(one.stored);
    const two = describeSelectedPoints(glyph, {}, new Set(["point/0", "point/1"]));
    assert.equal(two.cornerFields.cornerRadius, undefined);
    const none = describeSelectedPoints(glyph, {}, new Set(["point/0"]));
    assert.equal(none.cornerFields.cornerRadius, 0);
    assert.ok(!none.stored);
  }
});

test("each corner has a knob inside it, farther in with a larger radius", () => {
  const glyph = fakePositionedGlyph({
    contours: [
      cornerContour(),
      // No corners: a straight line, and a smooth point
      { points: [on(0, 0), on(100, 0), on(200, 0)], isClosed: false },
    ],
    sources: [{ customData: pointsData({ c: { cornerRadius: 30 } }) }],
  });
  const handles = cornerHandles(glyph, {}, { knobDistance: 10 });
  assert.equal(handles.length, 1);
  const [knob] = handles;
  assert.equal(knob.pointIndex, 1);
  assert.equal(knob.axis, "corner");
  assert.equal(knob.radius, 30);
  assertClose(knob.normal.x, -Math.SQRT1_2);
  assertClose(knob.normal.y, Math.SQRT1_2);
  assertClose(knob.handle.x, 200 - 40 * Math.SQRT1_2);
  assertClose(knob.handle.y, 40 * Math.SQRT1_2);
  // The tool's handles have it too, with either method
  assert.ok(glyphHandles(glyph, {}).handles.some((h) => h.axis === "corner"));
  const nib = fakePositionedGlyph({
    contours: [cornerContour()],
    glyphCustomData: { [STROKE_KEY]: { type: "nib" } },
  });
  assert.ok(glyphHandles(nib, {}).handles.some((h) => h.axis === "corner"));
});

test("dragging a knob into the corner makes the radius larger", () => {
  const knob = { normal: { x: -Math.SQRT1_2, y: Math.SQRT1_2 }, radius: 10 };
  const move = (d) => ({ x: -d * Math.SQRT1_2, y: d * Math.SQRT1_2 });
  assert.equal(draggedCornerRadius(knob, move(12)), 22);
  assert.equal(draggedCornerRadius(knob, move(-30)), 0);
  // Shift: steps of 5
  assert.equal(draggedCornerRadius(knob, move(12), { shiftKey: true }), 20);
  assert.equal(draggedCornerRadius(knob, move(13), { shiftKey: true }), 25);
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
  return {
    editor: {
      sceneController,
      canvasController: { canvas: { style: {} }, requestUpdate() {} },
      tools: {},
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

// Two corners: (200, 0) turning left, (200, 200) turning left
const twoCorners = () =>
  fakePositionedGlyph({
    contours: [
      {
        points: [
          on(0, 0),
          withId(on(200, 0), "c"),
          withId(on(200, 200), "d"),
          on(0, 200),
        ],
        isClosed: false,
      },
    ],
  });

// Where the knob of a corner without radius is: 12 units in (one unit a
// pixel in the fakes)
const knobOf = (x, y, dx, dy) => [
  x + 12 * dx * Math.SQRT1_2,
  y + 12 * dy * Math.SQRT1_2,
];

test("dragging a knob rounds the corner, as one undoable change", async () => {
  const glyph = twoCorners();
  const { editor, results } = fakeEditor(glyph);
  const tool = new StrokeWidthTool(editor, "icon.svg");
  const [x, y] = knobOf(200, 0, -1, 1);
  const shift = 20 * Math.SQRT1_2;
  await tool.handleDrag(events(mouse(x - shift, y + shift)), mouse(x, y));
  const path = glyph.varGlyph.layers.layer0.glyph.path;
  assert.equal(path.pointAttributes[1].identifier, "c");
  assert.deepEqual(glyph.varGlyph.sources[0].customData[STROKE_KEY].points, {
    c: { cornerRadius: 20 },
  });
  assert.equal(results.at(-1).undoLabel, "Change corner radius");
  assert.equal(tool.draggedHandle, undefined);
});

test("selected corners all get the dragged knob's radius", async () => {
  const glyph = twoCorners();
  const { editor } = fakeEditor(glyph, {
    selection: new Set(["point/0", "point/1", "point/2"]),
  });
  const tool = new StrokeWidthTool(editor, "icon.svg");
  const [x, y] = knobOf(200, 200, -1, -1);
  // Shift: 33 becomes 35
  const shift = 33 * Math.SQRT1_2;
  await tool.handleDrag(
    events(mouse(x - shift, y - shift, { shiftKey: true })),
    mouse(x, y, { shiftKey: true })
  );
  // The end point (0) is no corner and gets nothing
  assert.deepEqual(glyph.varGlyph.sources[0].customData[STROKE_KEY].points, {
    c: { cornerRadius: 35 },
    d: { cornerRadius: 35 },
  });
});

test("a double click on a knob sets the radius back to 0, nothing else", async () => {
  const glyph = fakePositionedGlyph({
    contours: [cornerContour()],
    sources: [{ customData: pointsData({ c: { cornerRadius: 30, width: 100 } }) }],
  });
  const { editor, results } = fakeEditor(glyph);
  const tool = new StrokeWidthTool(editor, "icon.svg");
  const d = (12 + 30) * Math.SQRT1_2;
  await tool.handleDrag(events(), mouse(200 - d, d, { detail: 2 }));
  assert.deepEqual(glyph.varGlyph.sources[0].customData[STROKE_KEY].points, {
    c: { width: 100 },
  });
  assert.equal(results.at(-1).undoLabel, "Change corner radius");
});

test("while a knob is dragged, the rounded centerline is drawn", () => {
  const glyph = fakePositionedGlyph({
    contours: [cornerContour()],
    sources: [{ customData: pointsData({ c: { cornerRadius: 50 } }) }],
  });
  const contours = roundedCenterlines(glyph, {});
  assert.equal(contours.length, 1);
  const context = new FakeContext();
  drawCenterlines(context, contours, { lineWidth: 1, handleColor: "orange" });
  // A line to where the arc starts, the arc in two cubics, a line to the end
  assert.deepEqual(
    context.calls.map(([name]) => name),
    [
      "beginPath",
      "moveTo",
      "lineTo",
      "bezierCurveTo",
      "bezierCurveTo",
      "lineTo",
      "stroke",
    ]
  );
  assert.deepEqual(context.calls[2], ["lineTo", 150, 0]);
  assert.deepEqual(context.calls[5], ["lineTo", 200, 200]);
});
