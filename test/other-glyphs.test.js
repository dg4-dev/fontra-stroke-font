import assert from "node:assert/strict";
import { test } from "node:test";

import {
  WRAPPED_LAYER_IDENTIFIERS,
  makeGlyphExpander,
  wrapGlyphLayers,
} from "../src/other-glyphs.js";
import { StrokeSettings } from "../src/settings.js";
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
