import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CARRIED_KEY,
  applyCarriedValues,
  attachPointValues,
  glyphIdentifiers,
  renameTakenIdentifiers,
} from "../src/clipboard.js";
import { STROKE_KEY } from "../src/stroke-data.js";
import { fakePath, fakePositionedGlyph } from "./fakes.js";
import { on } from "./helpers.js";

const withAttrs = (point, attrs) => ({ ...point, attrs });
const pointsData = (points) => ({ [STROKE_KEY]: { points } });

test("copied points take their values with them, in the copy only", () => {
  const contour = {
    points: [
      withAttrs(on(0, 0), { identifier: "a" }),
      withAttrs(on(100, 0), { identifier: "b" }),
      on(200, 0),
    ],
    isClosed: false,
  };
  const { varGlyph } = fakePositionedGlyph({
    contours: [contour],
    sources: [
      // The default source has the joins (shared by all sources)
      { customData: pointsData({ a: { width: 30 }, b: { join: "round", width: 5 } }) },
      { customData: pointsData({ a: { width: 60, join: "bevel" } }) },
    ],
  });
  const path = fakePath([contour]);
  const layerGlyphs = [
    { layerName: "layer1", glyph: { path } },
    { glyph: { path } }, // at no source: left as it is
  ];
  const [copied, other] = attachPointValues(layerGlyphs, varGlyph);
  assert.deepEqual(copied.glyph.path.pointAttributes[0], {
    identifier: "a",
    [CARRIED_KEY]: { width: 60 },
  });
  assert.deepEqual(copied.glyph.path.pointAttributes[1], {
    identifier: "b",
    [CARRIED_KEY]: { join: "round" },
  });
  assert.equal(copied.glyph.path.pointAttributes[2], null);
  assert.equal(other, layerGlyphs[1]);
  // The glyph copied from is not changed
  assert.deepEqual(path.pointAttributes[0], { identifier: "a" });
});

test("pasted points whose identifiers are taken get new ones, the same in every layer", () => {
  const layer = () => ({
    glyph: {
      path: fakePath([
        {
          points: [
            withAttrs(on(0, 0), { identifier: "a", [CARRIED_KEY]: { width: 30 } }),
            withAttrs(on(100, 0), { identifier: "b" }),
          ],
          isClosed: false,
        },
      ]),
    },
  });
  const pasted = [layer(), layer()];
  const renamed = renameTakenIdentifiers(pasted, new Set(["a", "x"]));
  const ids = renamed.map((entry) =>
    entry.glyph.path.pointAttributes.map((attrs) => attrs.identifier)
  );
  assert.notEqual(ids[0][0], "a");
  assert.notEqual(ids[0][0], "x");
  assert.deepEqual(ids[0], ids[1]);
  assert.equal(ids[0][1], "b");
  // The carried values stay with the point
  assert.deepEqual(renamed[0].glyph.path.pointAttributes[0][CARRIED_KEY], {
    width: 30,
  });
  // Nothing taken: the same layers
  assert.equal(renameTakenIdentifiers(pasted, []), pasted);
  const { varGlyph } = fakePositionedGlyph({
    contours: [{ points: [withAttrs(on(0, 0), { identifier: "q" })], isClosed: false }],
  });
  assert.deepEqual([...glyphIdentifiers(varGlyph)], ["q"]);
});

test("pasted values go to the sources of the glyph pasted into, and the attribute goes", () => {
  const contour = (width) => ({
    points: [
      withAttrs(on(0, 0), { identifier: "old" }),
      withAttrs(on(100, 0), { identifier: "new", [CARRIED_KEY]: { width } }),
      // A value that is not valid is not written
      withAttrs(on(200, 0), { [CARRIED_KEY]: { width: "wide" } }),
    ],
    isClosed: false,
  });
  const { varGlyph } = fakePositionedGlyph({
    contours: [contour(30)],
    sources: [{ customData: pointsData({ old: { width: 10 } }) }, { customData: {} }],
    sourceContours: [[contour(30)], [contour(70)]],
  });
  assert.equal(applyCarriedValues(varGlyph), 2);
  const stored = varGlyph.sources.map((source) => source.customData[STROKE_KEY].points);
  assert.deepEqual(stored[0], { old: { width: 10 }, new: { width: 30 } });
  assert.deepEqual(stored[1], { new: { width: 70 } });
  for (const layer of Object.values(varGlyph.layers)) {
    assert.ok(
      layer.glyph.path.pointAttributes.every((attrs) => !attrs?.[CARRIED_KEY]),
      "the attribute is removed"
    );
  }
});
