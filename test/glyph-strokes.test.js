import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ComponentGlyphs,
  strokeGlyph,
  strokeOpenContours,
} from "../src/glyph-strokes.js";
import { STROKE_KEY } from "../src/stroke-data.js";
import { fakePath, fakePositionedGlyph } from "./fakes.js";
import { bounds, on } from "./helpers.js";

const line = { points: [on(0, 0), on(200, 0)], isClosed: false };
const style = { width: 40, cap: "butt", join: "miter", miterLimit: 4 };

test("results are reused while the points and the style stay the same", () => {
  const path = fakePath([line]);
  const first = strokeOpenContours(path, style);
  assert.equal(strokeOpenContours(path, style), first);
  assert.notEqual(strokeOpenContours(path, { ...style, width: 60 }), first);
  // Moving a point in place gives a new result
  path.coordinates[2] = 300;
  const unpack = path.getUnpackedContour;
  path.getUnpackedContour = (i) => {
    const contour = unpack(i);
    contour.points[1].x = 300;
    return contour;
  };
  const moved = strokeOpenContours(path, { ...style, width: 60 });
  assert.equal(bounds(moved.outlines).xMax, 300);
});

function fakeComponentGlyphs(glyphs) {
  const requested = [];
  return {
    requested,
    get(name) {
      requested.push(name);
      return glyphs[name];
    },
  };
}

test("open contours inside components are stroked with their own glyph's values", () => {
  const base = fakePositionedGlyph({
    glyphName: "acute",
    sources: [
      { customData: { [STROKE_KEY]: { defaults: { width: 20, cap: "butt" } } } },
    ],
  });
  const glyph = fakePositionedGlyph({
    contours: [line],
    sources: [
      { customData: { [STROKE_KEY]: { defaults: { width: 80, cap: "butt" } } } },
    ],
    components: [
      {
        name: "acute",
        contours: [{ points: [on(0, 500), on(0, 600)], isClosed: false }],
      },
      {
        name: "box",
        contours: [{ points: [on(0, 0), on(10, 0), on(0, 10)], isClosed: true }],
      },
    ],
  });
  const componentGlyphs = fakeComponentGlyphs({ acute: base.varGlyph });
  const { outlines, twists } = strokeGlyph(glyph, {}, componentGlyphs);
  assert.equal(outlines.length, 2);
  assert.deepEqual(bounds([outlines[0]]), { xMin: 0, yMin: -40, xMax: 200, yMax: 40 });
  assert.deepEqual(bounds([outlines[1]]), {
    xMin: -10,
    yMin: 500,
    xMax: 10,
    yMax: 600,
  });
  assert.deepEqual(twists, []);
  // Components without open contours are not looked up
  assert.deepEqual(componentGlyphs.requested, ["acute"]);
});

test("components are skipped until their glyph is loaded", () => {
  const glyph = fakePositionedGlyph({
    components: [{ name: "acute", contours: [line] }],
  });
  assert.deepEqual(strokeGlyph(glyph, {}, fakeComponentGlyphs({})).outlines, []);
});

test("component glyphs are loaded once and reloaded after a change", async () => {
  const listeners = {};
  let loads = 0;
  let redraws = 0;
  const fontController = {
    async getGlyph(name) {
      loads++;
      return { name, version: loads };
    },
    addGlyphChangeListener(name, listener) {
      listeners[name] = listener;
    },
  };
  const glyphs = new ComponentGlyphs(fontController, () => redraws++);
  assert.equal(glyphs.get("acute"), undefined);
  assert.equal(glyphs.get("acute"), undefined);
  await new Promise((resolve) => setTimeout(resolve));
  assert.deepEqual(glyphs.get("acute"), { name: "acute", version: 1 });
  assert.equal(loads, 1);
  assert.equal(redraws, 1);
  listeners.acute();
  assert.equal(glyphs.get("acute"), undefined);
  await new Promise((resolve) => setTimeout(resolve));
  assert.deepEqual(glyphs.get("acute"), { name: "acute", version: 2 });
});
