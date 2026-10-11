import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_OFFSET_STYLE,
  STROKE_KEY,
  getGlyphStroke,
  getSourceStroke,
  isCenterline,
  normalizeNibAngle,
  resolveOffsetStyle,
  setSourceDefaults,
} from "../src/stroke-data.js";

test("glyphs without stroke settings use the offset method", () => {
  assert.deepEqual(getGlyphStroke(undefined), { type: "offset" });
  assert.deepEqual(getGlyphStroke({}), { type: "offset" });
  assert.deepEqual(getGlyphStroke({ [STROKE_KEY]: { type: "bogus" } }), {
    type: "offset",
  });
});

test("nib glyphs get a valid shape", () => {
  assert.deepEqual(getGlyphStroke({ [STROKE_KEY]: { type: "nib", shape: "rect" } }), {
    type: "nib",
    shape: "rect",
  });
  assert.deepEqual(getGlyphStroke({ [STROKE_KEY]: { type: "nib" } }), {
    type: "nib",
    shape: "ellipse",
  });
});

test("source stroke data is returned as stored", () => {
  const customData = {
    [STROKE_KEY]: {
      defaults: { width: 50 },
      points: { abc: { left: 10 } },
    },
  };
  assert.deepEqual(getSourceStroke(customData), {
    defaults: { width: 50 },
    points: { abc: { left: 10 } },
  });
  assert.deepEqual(getSourceStroke({}), { defaults: {}, points: {} });
  assert.deepEqual(getSourceStroke({ [STROKE_KEY]: "junk" }), {
    defaults: {},
    points: {},
  });
});

test("the offset style falls back to the built-in defaults", () => {
  assert.deepEqual(resolveOffsetStyle({}), DEFAULT_OFFSET_STYLE);
  assert.deepEqual(
    resolveOffsetStyle({
      [STROKE_KEY]: { defaults: { width: "120", cap: "square", join: "nope" } },
    }),
    { ...DEFAULT_OFFSET_STYLE, width: 120, cap: "square" }
  );
});

test("invalid numbers are clamped or ignored", () => {
  const style = resolveOffsetStyle({
    [STROKE_KEY]: { defaults: { width: -5, miterLimit: 0.2 } },
  });
  assert.equal(style.width, 0);
  assert.equal(style.miterLimit, 1);
  const fallback = resolveOffsetStyle({
    [STROKE_KEY]: { defaults: { width: "abc", miterLimit: null } },
  });
  assert.equal(fallback.width, DEFAULT_OFFSET_STYLE.width);
  assert.equal(fallback.miterLimit, DEFAULT_OFFSET_STYLE.miterLimit);
});

test("setSourceDefaults sets and removes values and keeps the rest", () => {
  const customData = {
    other: 1,
    [STROKE_KEY]: { defaults: { width: 50 }, points: { abc: { left: 10 } } },
  };
  setSourceDefaults(customData, { cap: "butt", width: 60 });
  assert.deepEqual(customData[STROKE_KEY], {
    defaults: { width: 60, cap: "butt" },
    points: { abc: { left: 10 } },
  });
  setSourceDefaults(customData, { cap: undefined, width: undefined });
  assert.deepEqual(customData[STROKE_KEY], { points: { abc: { left: 10 } } });
  assert.equal(customData.other, 1);
});

test("setSourceDefaults removes the key when nothing is left", () => {
  const customData = {};
  setSourceDefaults(customData, { width: 70 });
  assert.deepEqual(customData, { [STROKE_KEY]: { defaults: { width: 70 } } });
  setSourceDefaults(customData, { width: undefined });
  assert.deepEqual(customData, {});
});

test("nib angles are kept in [0, 180)", () => {
  assert.equal(normalizeNibAngle(45), 45);
  assert.equal(normalizeNibAngle(180), 0);
  assert.equal(normalizeNibAngle(225), 45);
  assert.equal(normalizeNibAngle(-30), 150);
  assert.ok(Object.is(normalizeNibAngle(-180), 0));
});

test("only open contours are centerlines", () => {
  assert.equal(isCenterline({ points: [], isClosed: false }), true);
  assert.equal(isCenterline({ points: [], isClosed: true }), false);
});
