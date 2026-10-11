import assert from "node:assert/strict";
import { test } from "node:test";

import { findStrokeSource, strokeStyleForGlyph } from "../src/current-source.js";
import { insertLayerDefinition } from "../src/start.js";
import { STROKE_KEY } from "../src/stroke-data.js";
import {
  LAYER_IDENTIFIER,
  drawStrokePreview,
  makeStrokeLayerDefinition,
} from "../src/stroke-layer.js";
import { FakeContext, fakePositionedGlyph } from "./fakes.js";
import { on } from "./helpers.js";

const line = { points: [on(0, 0), on(200, 0)], isClosed: false };
const square = {
  points: [on(0, 0), on(100, 0), on(100, 100), on(0, 100)],
  isClosed: true,
};

test("open contours are filled; closed ones are left to Fontra", () => {
  const context = new FakeContext();
  const glyph = fakePositionedGlyph({
    contours: [square, line],
    sources: [
      { customData: { [STROKE_KEY]: { defaults: { width: 40, cap: "butt" } } } },
    ],
  });
  drawStrokePreview(context, glyph, {}, "red");
  const moves = context.calls.filter(([name]) => name === "moveTo");
  // One band for the line, nothing for the square
  assert.equal(moves.length, 1);
  assert.deepEqual(context.calls.at(-1), ["fill", "nonzero", "red"]);
  const ys = context.calls
    .filter(([name]) => name === "moveTo" || name === "lineTo")
    .map((call) => call[2]);
  assert.deepEqual(
    [...new Set(ys)].sort((a, b) => a - b),
    [-20, 20]
  );
});

test("nothing is drawn without open contours", () => {
  const context = new FakeContext();
  drawStrokePreview(context, fakePositionedGlyph({ contours: [square] }), {}, "red");
  assert.deepEqual(context.calls, []);
});

test("nib glyphs are not drawn yet", () => {
  const context = new FakeContext();
  const glyph = fakePositionedGlyph({
    contours: [line],
    glyphCustomData: { [STROKE_KEY]: { type: "nib" } },
  });
  drawStrokePreview(context, glyph, {}, "red");
  assert.deepEqual(context.calls, []);
});

test("a malformed contour is skipped", () => {
  const context = new FakeContext();
  const glyph = fakePositionedGlyph({ contours: [line, line] });
  const getUnpacked = glyph.glyph.path.getUnpackedContour;
  glyph.glyph.path.getUnpackedContour = (index) => {
    if (index === 0) {
      throw new Error("broken");
    }
    return getUnpacked(index);
  };
  drawStrokePreview(context, glyph, {}, "red");
  assert.ok(context.calls.some(([name]) => name === "fill"));
});

test("the source being edited gives the values", () => {
  const sources = [
    { customData: { [STROKE_KEY]: { defaults: { width: 40 } } } },
    { customData: { [STROKE_KEY]: { defaults: { width: 120 } } } },
  ];
  const atBold = fakePositionedGlyph({ sources, sourceIndex: 1 });
  assert.deepEqual(findStrokeSource(atBold, {}), {
    varGlyph: atBold.varGlyph,
    sourceIndex: 1,
    atSource: true,
  });
  assert.equal(strokeStyleForGlyph(atBold, {}).width, 120);
});

test("between sources, the nearest source gives the values", () => {
  const sources = [
    { customData: { [STROKE_KEY]: { defaults: { width: 40 } } } },
    { customData: { [STROKE_KEY]: { defaults: { width: 120 } } } },
  ];
  const between = fakePositionedGlyph({
    sources,
    sourceIndex: undefined,
    nearestSourceIndex: 1,
  });
  const found = findStrokeSource(between, { wght: 600 });
  assert.equal(found.sourceIndex, 1);
  assert.equal(found.atSource, false);
  assert.equal(strokeStyleForGlyph(between, {}).width, 120);
});

test("the layer is inserted by zIndex and replaces an older copy", () => {
  const definitions = [
    { identifier: "a", zIndex: 100 },
    { identifier: LAYER_IDENTIFIER, zIndex: 480, old: true },
    { identifier: "b", zIndex: 490 },
    { identifier: "c", zIndex: 500 },
  ];
  insertLayerDefinition(definitions, makeStrokeLayerDefinition());
  assert.deepEqual(
    definitions.map((d) => d.identifier),
    ["a", LAYER_IDENTIFIER, "b", "c"]
  );
  assert.equal(definitions[1].old, undefined);
});

test("the layer draws the positioned glyph at the model's location", () => {
  const layer = makeStrokeLayerDefinition();
  const context = new FakeContext();
  const seen = [];
  const glyph = fakePositionedGlyph({ contours: [line], sourceIndex: undefined });
  glyph.varGlyph.findNearestSourceForSourceLocation = (location) => {
    seen.push(location);
    return 0;
  };
  layer.draw({
    context,
    positionedGlyph: glyph,
    parameters: { fillColor: "blue" },
    model: { getLocationForGlyph: (name) => ({ wght: 700, name }) },
  });
  assert.deepEqual(seen, [{ wght: 700, name: "a" }]);
  assert.deepEqual(context.calls.at(-1), ["fill", "nonzero", "blue"]);
});

test("the panel description of the selected glyph", async () => {
  const { describeStrokeSource } = await import("../src/current-source.js");
  assert.equal(describeStrokeSource(undefined, {}), null);
  const glyph = fakePositionedGlyph({
    sources: [
      { name: "", layerName: "light-layer", customData: {} },
      { name: "Bold", customData: { [STROKE_KEY]: { defaults: { width: 120 } } } },
    ],
    sourceIndex: 1,
  });
  const state = describeStrokeSource(glyph, {});
  assert.equal(state.glyphName, "a");
  assert.equal(state.sourceName, "Bold");
  assert.equal(state.atSource, true);
  assert.equal(state.method, "offset");
  assert.deepEqual(state.stored, { width: 120 });
  assert.equal(state.style.width, 120);
  assert.equal(state.style.cap, "round");

  const between = fakePositionedGlyph({
    sources: glyph.varGlyph.sources,
    sourceIndex: undefined,
    nearestSourceIndex: 0,
  });
  const nearest = describeStrokeSource(between, {});
  assert.equal(nearest.atSource, false);
  // A source without a name of its own falls back to its layer name
  assert.equal(nearest.sourceName, "light-layer");
});
