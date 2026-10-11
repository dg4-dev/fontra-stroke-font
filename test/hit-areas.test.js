import assert from "node:assert/strict";
import { test } from "node:test";

import { strokeGlyph } from "../src/glyph-strokes.js";
import { convexHull, widenHitAreas } from "../src/hit-areas.js";
import { fakePositionedGlyph } from "./fakes.js";
import { on } from "./helpers.js";

test("the convex hull leaves out points inside it", () => {
  const hull = convexHull([
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 5, y: 5 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ]);
  assert.deepEqual(hull, [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ]);
});

test("glyphs with centerlines can be clicked on their strokes", () => {
  // A narrow glyph of one straight centerline, which Fontra takes for empty
  // and gives a box over its advance width
  const line = { points: [on(10, 0), on(10, 500)], isClosed: false };
  const stroked = {
    ...fakePositionedGlyph({ contours: [line] }),
    x: 1000,
    y: 0,
    isEmpty: true,
    bounds: { xMin: 1000, yMin: -200, xMax: 1020, yMax: 800 },
  };
  stroked.glyph.flattenedPath = stroked.glyph.path;
  const plain = {
    ...fakePositionedGlyph({ contours: [{ ...line, isClosed: true }] }),
    bounds: { xMin: 0, yMin: 0, xMax: 10, yMax: 10 },
  };
  const lines = [
    {
      glyphs: [plain, stroked],
      bounds: { xMin: 0, yMin: -200, xMax: 1020, yMax: 800 },
    },
  ];
  const count = widenHitAreas(lines, (item) => strokeGlyph(item, {}).outlines);
  assert.equal(count, 1);
  // The stroke is 80 wide with round caps: 40 on each side of x = 10
  assert.deepEqual(stroked.bounds, { xMin: 970, yMin: -200, xMax: 1050, yMax: 800 });
  assert.equal(stroked.isEmpty, false);
  const hull = stroked.glyph._representationCache.convexHull;
  assert.ok(hull.length >= 4);
  assert.ok(Math.min(...hull.map((p) => p.x)) <= -29.9);
  assert.equal(lines[0].bounds.xMax, 1050);
  // Glyphs without centerlines are left alone
  assert.equal(plain.glyph._representationCache, undefined);
  assert.deepEqual(plain.bounds, { xMin: 0, yMin: 0, xMax: 10, yMax: 10 });
});
