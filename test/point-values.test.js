import assert from "node:assert/strict";
import { test } from "node:test";

import { strokeStyleForGlyph } from "../src/current-source.js";
import { strokeGlyph } from "../src/glyph-strokes.js";
import { locatePoint, pathPoints } from "../src/path-points.js";
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
