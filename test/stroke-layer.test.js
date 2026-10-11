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
import { off, on } from "./helpers.js";

const line = { points: [on(0, 0), on(200, 0)], isClosed: false };
const PARAMETERS = {
  fillColor: "red",
  twistColor: "orange",
  markerRadius: 5,
  markerWidth: 1,
};
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
  drawStrokePreview(context, glyph, {}, PARAMETERS);
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
  drawStrokePreview(
    context,
    fakePositionedGlyph({ contours: [square] }),
    {},
    PARAMETERS
  );
  assert.deepEqual(context.calls, []);
});

test("nib glyphs are not drawn yet", () => {
  const context = new FakeContext();
  const glyph = fakePositionedGlyph({
    contours: [line],
    glyphCustomData: { [STROKE_KEY]: { type: "nib" } },
  });
  drawStrokePreview(context, glyph, {}, PARAMETERS);
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
  drawStrokePreview(context, glyph, {}, PARAMETERS);
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

test("between sources, the nearest source is found", () => {
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
    parameters: { ...PARAMETERS, fillColor: "blue" },
    model: { getLocationForGlyph: (name) => ({ wght: 700, name }) },
  });
  assert.ok(seen.some((location) => location.wght === 700 && location.name === "a"));
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
  assert.equal(nearest.sourceName, "");
  // A source without a name of its own falls back to its layer name
  assert.equal(nearest.defaultSourceName, "light-layer");
  assert.equal(nearest.defaultSourceIndex, 0);
  assert.equal(state.isDefaultSource, false);
});

test("twisting places get a ring", () => {
  const context = new FakeContext();
  const hairpin = {
    points: [on(0, 0), off(0, 150), off(150, 150), on(150, 0)],
    isClosed: false,
  };
  const glyph = fakePositionedGlyph({
    contours: [hairpin],
    sources: [{ customData: { [STROKE_KEY]: { defaults: { width: 120 } } } }],
  });
  drawStrokePreview(context, glyph, {}, PARAMETERS);
  const arcs = context.calls.filter(([name]) => name === "arc");
  assert.equal(arcs.length, 1);
  assert.ok(Math.abs(arcs[0][1] - 75) < 1);
  assert.equal(arcs[0][3], 5);
  assert.deepEqual(context.calls.at(-1), ["stroke", "orange", 1]);
});

test("between sources, the numbers are interpolated", () => {
  const sources = [
    {
      customData: {
        [STROKE_KEY]: {
          defaults: { width: 40, miterLimit: 2, cap: "butt", join: "bevel" },
        },
      },
    },
    {
      customData: {
        [STROKE_KEY]: { defaults: { width: 120, miterLimit: 6, cap: "square" } },
      },
    },
  ];
  const between = fakePositionedGlyph({ sources, sourceIndex: undefined });
  assert.deepEqual(strokeStyleForGlyph(between, { wght: 500 }), {
    width: 80,
    miterLimit: 4,
    cap: "butt",
    join: "bevel",
  });
  // At a source: its own numbers, the default source's cap and join
  const atBold = fakePositionedGlyph({ sources, sourceIndex: 1 });
  assert.deepEqual(strokeStyleForGlyph(atBold, {}), {
    width: 120,
    miterLimit: 6,
    cap: "butt",
    join: "bevel",
  });
});

test("without a working model, the nearest source gives the numbers", () => {
  const sources = [
    { customData: { [STROKE_KEY]: { defaults: { width: 40 } } } },
    { customData: { [STROKE_KEY]: { defaults: { width: 120 } } } },
  ];
  const between = fakePositionedGlyph({
    sources,
    sourceIndex: undefined,
    nearestSourceIndex: 1,
  });
  between.varGlyph.model = {
    getDeltas() {
      throw new Error("incompatible");
    },
  };
  assert.equal(strokeStyleForGlyph(between, { wght: 500 }).width, 120);
});

test("the fill uses the opacity setting", () => {
  const context = new FakeContext();
  const alphas = [];
  Object.defineProperty(context, "globalAlpha", {
    set: (value) => alphas.push(value),
    get: () => alphas.at(-1),
  });
  drawStrokePreview(
    context,
    fakePositionedGlyph({ contours: [line] }),
    {},
    PARAMETERS,
    {
      fillOpacity: 0.6,
    }
  );
  assert.deepEqual(alphas, [0.6, 1]);
});

test("without a scratch canvas, the edge-only mode strokes every outline", () => {
  const context = new FakeContext();
  drawStrokePreview(
    context,
    fakePositionedGlyph({ contours: [line] }),
    {},
    { ...PARAMETERS, outlineColor: "navy", outlineWidth: 2 },
    { outlineOnly: true }
  );
  assert.ok(!context.calls.some(([name]) => name === "fill"));
  assert.deepEqual(context.calls.at(-1), ["stroke", "navy", 2]);
});
