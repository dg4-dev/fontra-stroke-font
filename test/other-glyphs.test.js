import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EDIT_FILL_LAYER_IDENTIFIER,
  WRAPPED_LAYER_IDENTIFIERS,
  makeGlyphExpander,
  makeOutlineFiller,
  makeStrokedTest,
  wrapEditFillLayer,
  wrapGlyphLayers,
} from "../src/other-glyphs.js";
import { StrokeSettings } from "../src/settings.js";
import { STROKE_KEY } from "../src/stroke-data.js";
import { FakePath2D, fakePositionedGlyph } from "./fakes.js";
import { on } from "./helpers.js";

globalThis.Path2D ??= FakePath2D;

const line = { points: [on(0, 0), on(200, 0)], isClosed: false };
const square = {
  points: [on(0, 0), on(100, 0), on(100, 100), on(0, 100)],
  isClosed: true,
};

const memoryStorage = () => ({ getItem: () => null, setItem() {} });

test("Fontra's glyph layers are wrapped once, others are left alone", () => {
  const drawn = [];
  const definitions = [
    {
      identifier: "fontra.context.glyphs",
      zIndex: 200,
      draw: (args) => drawn.push(args),
    },
    { identifier: "fontra.nodes", zIndex: 500, draw: () => {} },
  ];
  const nodes = definitions[1];
  const expand = (positionedGlyph) =>
    positionedGlyph.glyphName === "a" ? { replaced: true } : null;
  assert.equal(wrapGlyphLayers(definitions, expand), 1);
  assert.equal(definitions[1], nodes);
  // Wrapping again does not wrap the wrapper
  assert.equal(wrapGlyphLayers(definitions, expand), 1);
  definitions[0].draw({ positionedGlyph: { glyphName: "a", x: 5, glyph: {} } });
  definitions[0].draw({ positionedGlyph: { glyphName: "b", glyph: { same: true } } });
  assert.equal(drawn.length, 2);
  assert.deepEqual(drawn[0].positionedGlyph, {
    glyphName: "a",
    x: 5,
    glyph: { replaced: true },
  });
  assert.deepEqual(drawn[1].positionedGlyph.glyph, { same: true });
  assert.ok(WRAPPED_LAYER_IDENTIFIERS.includes("fontra.selected.glyph"));
});

test("a glyph with open contours gets a flattened path with the strokes", () => {
  const settings = new StrokeSettings(memoryStorage());
  const expand = makeGlyphExpander(settings, null);
  const positionedGlyph = fakePositionedGlyph({ contours: [square, line] });
  positionedGlyph.glyph.errors = ["kept"];
  const glyph = expand(positionedGlyph, { getLocationForGlyph: () => ({}) });
  // The closed square, then the stroked line (band and two round caps)
  const moves = glyph.flattenedPath2d.calls.filter(([name]) => name === "moveTo");
  assert.equal(moves.length, 4);
  assert.deepEqual(moves[0], ["moveTo", 0, 0]);
  // Everything else comes from the glyph
  assert.deepEqual(glyph.errors, ["kept"]);
  assert.equal(glyph.path, positionedGlyph.glyph.path);
});

test("glyphs without open contours, and the setting off, are drawn as they are", () => {
  const settings = new StrokeSettings(memoryStorage());
  const expand = makeGlyphExpander(settings, null);
  assert.equal(expand(fakePositionedGlyph({ contours: [square] }), null), null);
  settings.set("otherGlyphs", false);
  assert.equal(expand(fakePositionedGlyph({ contours: [line] }), null), null);
});

test("stroked glyphs that Fontra takes for empty ones are drawn, without a placeholder", () => {
  const empty = (positionedGlyph) => !positionedGlyph.isEmpty;
  const definitions = [
    { identifier: "fontra.selected.glyph", selectionFilter: empty, draw() {} },
    { identifier: "fontra.hovered.glyph", selectionFilter: empty, draw() {} },
    {
      identifier: "fontra.empty.selected.glyph",
      selectionFilter: (positionedGlyph) => positionedGlyph.isEmpty,
      draw() {},
    },
    {
      identifier: "fontra.undefined.glyph",
      selectionFilter: (positionedGlyph) =>
        positionedGlyph.isUndefined || positionedGlyph.isEmpty,
      draw() {},
    },
  ];
  const settings = new StrokeSettings(memoryStorage());
  const isStroked = makeStrokedTest(settings);
  wrapGlyphLayers(definitions, () => null, isStroked);
  // Wrapping again keeps Fontra's own filters underneath
  wrapGlyphLayers(definitions, () => null, isStroked);
  const stroke = { ...fakePositionedGlyph({ contours: [line] }), isEmpty: true };
  const blank = { ...fakePositionedGlyph({ contours: [] }), isEmpty: true };
  const undefinedGlyph = { ...blank, isUndefined: true };
  const [selected, hovered, emptyBox, placeholder] = definitions.map(
    (d) => d.selectionFilter
  );
  assert.equal(emptyBox(stroke), false);
  assert.equal(emptyBox(blank), true);
  assert.equal(selected(stroke), true);
  assert.equal(hovered(stroke), true);
  assert.equal(placeholder(stroke), false);
  assert.equal(selected(blank), false);
  assert.equal(placeholder(blank), true);
  assert.equal(placeholder(undefinedGlyph), true);
  // With the strokes of the other glyphs off, Fontra decides as before
  settings.set("otherGlyphs", false);
  assert.equal(selected(stroke), false);
  assert.equal(placeholder(stroke), true);
});

test("the glyph being edited is filled without its closed centerlines", () => {
  const ring = {
    points: [
      { ...on(0, 0), attrs: { identifier: "a" } },
      on(300, 0),
      on(300, 300),
      on(0, 300),
    ],
    isClosed: true,
  };
  const inner = {
    points: [on(400, 0), on(500, 0), on(500, 100), on(400, 100)],
    isClosed: true,
  };
  const marked = { [STROKE_KEY]: { points: { a: { centerline: true } } } };
  const filled = [];
  const definitions = [
    {
      identifier: EDIT_FILL_LAYER_IDENTIFIER,
      draw: ({ positionedGlyph }) => filled.push(positionedGlyph.glyph),
    },
  ];
  const fill = makeOutlineFiller(null);
  assert.equal(wrapEditFillLayer(definitions, fill), true);
  // Wrapping again does not wrap the wrapper
  wrapEditFillLayer(definitions, fill);
  const model = { getLocationForGlyph: () => ({}) };
  const glyph = fakePositionedGlyph({
    contours: [ring, inner],
    sources: [{ name: "Regular", customData: marked }],
  });
  definitions[0].draw({ positionedGlyph: glyph, model });
  // Only the outline is filled, not the ring stroked as a centerline
  const moves = filled[0].closedContoursPath2d.calls.filter(
    ([name]) => name === "moveTo"
  );
  assert.deepEqual(moves, [["moveTo", 400, 0]]);
  assert.equal(filled[0].path, glyph.glyph.path);
  // Without closed centerlines, Fontra fills the glyph as it is
  const plain = fakePositionedGlyph({ contours: [ring, inner] });
  definitions[0].draw({ positionedGlyph: plain, model });
  assert.equal(filled[1], plain.glyph);
  assert.equal(wrapEditFillLayer([], fill), false);
});
