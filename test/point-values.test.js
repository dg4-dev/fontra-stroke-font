import assert from "node:assert/strict";
import { test } from "node:test";

import { strokeStyleForGlyph } from "../src/current-source.js";
import { strokeGlyph } from "../src/glyph-strokes.js";
import { locatePoint, pathPoints } from "../src/path-points.js";
import {
  centerlinePoints,
  closedContourPoints,
  describeSelectedPoints,
  editPointValues,
  editingSourceIndices,
  pointValuesForField,
  selectedPointIndices,
} from "../src/point-edit.js";
import {
  STROKE_KEY,
  makePointIdentifier,
  resolvePointValues,
  setPointValues,
} from "../src/stroke-data.js";
import { fakePath, fakePositionedGlyph } from "./fakes.js";
import { bounds, off, on } from "./helpers.js";

const withId = (point, identifier) => ({ ...point, attrs: { identifier } });
const pointsData = (points, defaults = { cap: "butt" }) => ({
  [STROKE_KEY]: { defaults, points },
});
const line = (id = "b") => ({
  points: [on(0, 0), withId(on(200, 0), id)],
  isClosed: false,
});

function assertClose(actual, expected, tolerance = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${expected}, got ${actual}`
  );
}

test("the points of a path are read with their identifiers", () => {
  const path = fakePath([
    { points: [withId(on(0, 0), "a"), off(1, 1), on(2, 2)], isClosed: false },
    { points: [on(5, 5)], isClosed: true },
  ]);
  assert.deepEqual(pathPoints(path), [
    [
      { identifier: "a", onCurve: true, pointIndex: 0 },
      { identifier: undefined, onCurve: false, pointIndex: 1 },
      { identifier: undefined, onCurve: true, pointIndex: 2 },
    ],
    [{ identifier: undefined, onCurve: true, pointIndex: 3 }],
  ]);
  assert.deepEqual(locatePoint(path, 3), { contourIndex: 1, contourPointIndex: 0 });
  assert.equal(locatePoint(path, 4), undefined);
});

test("point values are found by identifier, the first of duplicates only", () => {
  const contours = [
    [
      { identifier: "a", onCurve: true },
      { identifier: "x", onCurve: false },
    ],
    [{ identifier: "a", onCurve: true }],
  ];
  const values = resolvePointValues(
    contours,
    pointsData({ a: { width: "50", join: "round", bogus: 1 }, x: { width: 9 } })
  );
  assert.deepEqual(values, [[{ width: 50, join: "round" }, undefined], [undefined]]);
});

test("point values are set and removed, keeping only existing points", () => {
  const customData = pointsData({ a: { width: 50 }, gone: { left: 3 } });
  setPointValues(
    customData,
    { a: { left: 20, width: undefined }, b: { join: "bevel" } },
    ["a", "b"]
  );
  assert.deepEqual(customData[STROKE_KEY].points, {
    a: { left: 20 },
    b: { join: "bevel" },
  });
  setPointValues(customData, { a: { left: undefined }, b: { join: undefined } });
  assert.deepEqual(customData[STROKE_KEY], { defaults: { cap: "butt" } });
  const empty = {};
  setPointValues(empty, { a: { width: undefined } });
  assert.deepEqual(empty, {});
});

test("new point identifiers are not taken", () => {
  let calls = 0;
  // The first try gives "AAAAAAAAAA", which is taken
  const random = () => (calls++ < 10 ? 0 : 0.5);
  const identifier = makePointIdentifier(new Set(["AAAAAAAAAA"]), random);
  assert.equal(identifier.length, 10);
  assert.notEqual(identifier, "AAAAAAAAAA");
});

test("the preview uses the width of a point at a source", () => {
  const glyph = fakePositionedGlyph({
    contours: [line()],
    sources: [{ customData: pointsData({ b: { width: 200 } }) }],
  });
  const { outlines } = strokeGlyph(glyph, {});
  assertClose(bounds(outlines).yMax, 100, 0.01);
  // The start keeps the source's width
  const style = strokeStyleForGlyph(glyph, {});
  assert.deepEqual(style.points, [[undefined, { width: 200 }]]);
});

test("glyphs without point values get no point values", () => {
  const glyph = fakePositionedGlyph({ contours: [line()] });
  assert.equal(strokeStyleForGlyph(glyph, {}).points, undefined);
});

test("between sources, point widths are interpolated", () => {
  const glyph = fakePositionedGlyph({
    contours: [line()],
    sources: [
      { customData: pointsData({}) },
      { customData: pointsData({ b: { right: 100 } }) },
    ],
    sourceIndex: undefined,
  });
  const style = strokeStyleForGlyph(glyph, { wght: 500 });
  // Halfway between the source's 40 and the point's 100; left is not set
  assert.deepEqual(style.points, [[undefined, { right: 70 }]]);
  const { outlines } = strokeGlyph(glyph, { wght: 500 });
  assertClose(bounds(outlines).yMin, -70, 0.01);
  assertClose(bounds(outlines).yMax, 40, 0.01);
});

test("between sources whose points differ, only the source numbers are used", () => {
  const glyph = fakePositionedGlyph({
    contours: [line()],
    sources: [
      { customData: pointsData({}) },
      { customData: pointsData({ b: { width: 200 } }) },
    ],
    sourceContours: [
      [line()],
      [{ points: [on(0, 0), on(100, 0), withId(on(200, 0), "b")], isClosed: false }],
    ],
    sourceIndex: undefined,
  });
  const style = strokeStyleForGlyph(glyph, { wght: 500 });
  assert.equal(style.points, undefined);
  assert.equal(style.width, 80);
});

test("a source uses the join of the default source's point", () => {
  const corner = (id) => ({
    points: [on(0, 0), withId(on(200, 0), id), on(200, 200)],
    isClosed: false,
  });
  const glyph = fakePositionedGlyph({
    contours: [corner("other")],
    sources: [
      { customData: pointsData({ c: { join: "bevel" } }) },
      { customData: pointsData({ other: { join: "round", width: 30 } }) },
    ],
    sourceContours: [[corner("c")], [corner("other")]],
    sourceIndex: 1,
  });
  const style = strokeStyleForGlyph(glyph, {});
  assert.deepEqual(style.points[0][1], { width: 30, join: "bevel" });
});

test("selected points: on-curve points, of open and closed contours", () => {
  const path = fakePath([
    { points: [on(0, 0), off(50, 50), on(100, 0)], isClosed: false },
    { points: [on(0, 0), on(10, 0), on(0, 10)], isClosed: true },
  ]);
  const indices = selectedPointIndices(
    new Set(["point/2", "point/1", "component/0", "point/3"])
  );
  assert.deepEqual(indices, [1, 2, 3]);
  assert.deepEqual(centerlinePoints(path, indices), [
    { pointIndex: 2, contourIndex: 0, contourPointIndex: 2, isClosed: false },
    { pointIndex: 3, contourIndex: 1, contourPointIndex: 0, isClosed: true },
  ]);
  // All on-curve points of the closed contours of the selected points
  assert.deepEqual(closedContourPoints(path, indices), [3, 4, 5]);
});

test("closed contours become centerlines when marked in the default source", () => {
  const ring = (id) => ({
    points: [withId(on(0, 0), id), on(100, 0), on(100, 100), on(0, 100)],
    isClosed: true,
  });
  const glyph = fakePositionedGlyph({
    contours: [ring("b")],
    sources: [
      { customData: pointsData({ a: { centerline: true } }) },
      { customData: {} },
    ],
    sourceContours: [[ring("a")], [ring("b")]],
    sourceIndex: 1,
  });
  // The second source has no marks of its own; the default source's count
  const { outlines, strokedClosed } = strokeGlyph(glyph, {});
  assert.ok(outlines.length > 0);
  assert.deepEqual([...strokedClosed.own], [0]);
  const described = describeSelectedPoints(glyph, {}, new Set(["point/2"]));
  assert.equal(described.closedCenterline, true);
  // Unmarked, it stays an outline
  const plain = fakePositionedGlyph({ contours: [ring("b")] });
  assert.deepEqual(strokeGlyph(plain, {}).outlines, []);
  assert.equal(
    describeSelectedPoints(plain, {}, new Set(["point/2"])).closedCenterline,
    false
  );
});

test("changing one field of a point", () => {
  assert.deepEqual(pointValuesForField({ left: 3 }, "width", 50), {
    width: 50,
    left: undefined,
    right: undefined,
  });
  // The width keeps applying to the other side
  assert.deepEqual(pointValuesForField({ width: 50 }, "left", 10), {
    left: 10,
    width: undefined,
    right: 25,
  });
  assert.deepEqual(pointValuesForField({ right: 5 }, "left", 10), {
    left: 10,
    width: undefined,
  });
  assert.deepEqual(pointValuesForField({ join: "round" }, "join", ""), {
    join: undefined,
  });
});

function editableGlyph(contoursPerSource) {
  return {
    sources: contoursPerSource.map((_, i) => ({ layerName: `l${i}` })),
    layers: Object.fromEntries(
      contoursPerSource.map((contours, i) => [
        `l${i}`,
        { glyph: { path: fakePath(contours) } },
      ])
    ),
  };
}

test("point values are written to every source being edited, joins to the default", () => {
  const contour = (id) => ({
    points: [on(0, 0), id ? withId(on(100, 0), id) : on(100, 0), on(100, 100)],
    isClosed: false,
  });
  const glyph = editableGlyph([[contour("a")], [contour()], [contour()]]);
  editPointValues(glyph, [1, 2], [1], () => ({ width: 30, join: "round" }), {
    defaultIndex: 0,
  });
  const idOf = (i) => glyph.layers[`l${i}`].glyph.path.pointAttributes[1].identifier;
  assert.equal(idOf(0), "a");
  assert.equal(typeof idOf(1), "string");
  assert.deepEqual(glyph.sources[0].customData[STROKE_KEY].points, {
    a: { join: "round" },
  });
  assert.deepEqual(glyph.sources[1].customData[STROKE_KEY].points, {
    [idOf(1)]: { width: 30 },
  });
  assert.deepEqual(glyph.sources[2].customData[STROKE_KEY].points, {
    [idOf(2)]: { width: 30 },
  });
});

test("a duplicated identifier gets a new one when written, and stale values go", () => {
  const glyph = editableGlyph([
    [
      { points: [withId(on(0, 0), "a"), on(100, 0)], isClosed: false },
      { points: [withId(on(0, 50), "a"), on(100, 50)], isClosed: false },
    ],
  ]);
  glyph.sources[0].customData = pointsData({ a: { width: 10 }, gone: { width: 5 } });
  editPointValues(glyph, [0], [2], (stored) => {
    // The copy has no values of its own
    assert.equal(stored, undefined);
    return { width: 70 };
  });
  const attrs = glyph.layers.l0.glyph.path.pointAttributes;
  assert.equal(attrs[0].identifier, "a");
  assert.notEqual(attrs[2].identifier, "a");
  assert.deepEqual(glyph.sources[0].customData[STROKE_KEY].points, {
    a: { width: 10 },
    [attrs[2].identifier]: { width: 70 },
  });
});

test("the sources being edited need the same points", () => {
  const glyph = editableGlyph([
    [line()],
    [line()],
    [{ points: [on(0, 0), on(1, 1), on(2, 2)], isClosed: false }],
  ]);
  glyph.sources[2].inactive = false;
  assert.deepEqual(editingSourceIndices(glyph, 1, ["l0", "l1", "l2"]), [1, 0]);
  assert.deepEqual(editingSourceIndices(glyph, 1, []), [1]);
});

test("the panel shows the widths the stroke has at the selected points", () => {
  const glyph = fakePositionedGlyph({
    contours: [
      {
        points: [on(0, 0), withId(on(100, 0), "m"), on(200, 0), on(300, 0)],
        isClosed: false,
      },
    ],
    sources: [{ customData: pointsData({ m: { width: 160, join: "bevel" } }) }],
  });
  const one = describeSelectedPoints(glyph, {}, new Set(["point/1"]));
  assert.equal(one.count, 1);
  assert.ok(one.editable && one.stored);
  assert.deepEqual(one.fields, {
    width: 160,
    left: 80,
    right: 80,
    join: "bevel",
    miterLimit: "",
  });
  const two = describeSelectedPoints(glyph, {}, new Set(["point/0", "point/3"]));
  assert.ok(!two.stored);
  assert.equal(two.fields.width, 80);
  assert.equal(two.fields.join, "");
  const mixed = describeSelectedPoints(glyph, {}, new Set(["point/0", "point/1"]));
  assert.equal(mixed.fields.width, undefined);
  assert.equal(describeSelectedPoints(glyph, {}, new Set(["component/0"])), null);
});
