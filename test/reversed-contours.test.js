import assert from "node:assert/strict";
import { test } from "node:test";

import { strokeGlyph } from "../src/glyph-strokes.js";
import {
  hasSidedPoints,
  keepSidesOnReversal,
  reversedIdentifiers,
  snapshotPointOrder,
  swapSides,
  wrapContourReversal,
} from "../src/reversed-contours.js";
import { STROKE_KEY } from "../src/stroke-data.js";
import { fakePath, fakePositionedGlyph } from "./fakes.js";
import { bounds, off, on } from "./helpers.js";

const id = (point, identifier) => ({ ...point, attrs: { identifier } });
const open = (...points) => ({ points, isClosed: false });
const closed = (...points) => ({ points, isClosed: true });
const pointsData = (points) => ({ [STROKE_KEY]: { points } });

// As Fontra's doReverseSelectedContours(): a closed contour keeps its start point
function reversed(contour) {
  const points = contour.points.toReversed();
  if (contour.isClosed) {
    points.unshift(points.pop());
  }
  return { ...contour, points };
}

function placesOf(contours) {
  const glyph = { sources: [{ layerName: "a" }], layers: {} };
  glyph.layers.a = { glyph: { path: fakePath(contours) } };
  return snapshotPointOrder(glyph).get("a");
}

const line = open(id(on(0, 0), "p"), on(100, 0), id(on(200, 0), "q"));
const other = open(id(on(0, 300), "r"), id(on(200, 300), "s"));

test("the points of a reversed open contour are found, not those of the others", () => {
  const before = placesOf([line, other]);
  const after = fakePath([reversed(line), other]);
  assert.deepEqual([...reversedIdentifiers(before, after)].sort(), ["p", "q"]);
});

test("a line whose only identified point is one end is seen to turn", () => {
  const before = placesOf([open(id(on(0, 0), "p"), on(200, 0))]);
  const after = fakePath([open(on(200, 0), id(on(0, 0), "p"))]);
  assert.deepEqual([...reversedIdentifiers(before, after)], ["p"]);
});

test("a reversed closed contour is found; a new start point is not a reversal", () => {
  const loop = closed(
    id(on(0, 0), "a"),
    off(50, 0),
    off(100, 50),
    id(on(100, 100), "b"),
    off(50, 100),
    off(0, 50)
  );
  const before = placesOf([loop]);
  assert.deepEqual(
    [...reversedIdentifiers(before, fakePath([reversed(loop)]))].sort(),
    ["a", "b"]
  );
  const turned = closed(...loop.points.slice(3), ...loop.points.slice(0, 3));
  assert.equal(reversedIdentifiers(before, fakePath([turned])).size, 0);
});

test("joining contours: only the contour that was turned around is found", () => {
  // As Fontra's joinContours() joining the starts of the two contours
  const before = placesOf([line, other]);
  const joined = open(...reversed(other).points, ...line.points);
  assert.deepEqual([...reversedIdentifiers(before, fakePath([joined]))].sort(), [
    "r",
    "s",
  ]);
});

test("moving, adding and deleting points is not a reversal", () => {
  const before = placesOf([line, other]);
  const edited = open(id(on(0, 10), "p"), on(50, 20), id(on(200, 0), "q"));
  assert.equal(
    reversedIdentifiers(before, fakePath([edited, open(other.points[0])])).size,
    0
  );
});

test("swapping sides changes only the points with different sides", () => {
  const customData = pointsData({
    p: { left: 10, right: 50 },
    q: { left: 20 },
    r: { width: 40 },
    s: { left: 30, right: 30 },
  });
  assert.equal(swapSides(customData, ["p", "q", "r", "s", "missing"]), true);
  assert.deepEqual(customData[STROKE_KEY].points, {
    p: { left: 50, right: 10 },
    q: { right: 20 },
    r: { width: 40 },
    s: { left: 30, right: 30 },
  });
  assert.equal(swapSides(customData, ["r", "s"]), false);
});

// A horizontal line with 10 on its left and 50 on its right, in two sources
function sidedGlyph() {
  const contour = open(id(on(0, 0), "p"), id(on(200, 0), "q"));
  const sides = { p: { left: 10, right: 50 }, q: { left: 10, right: 50 } };
  return {
    contour,
    positioned: fakePositionedGlyph({
      contours: [contour],
      sources: [
        { customData: { [STROKE_KEY]: { defaults: { cap: "butt" }, points: sides } } },
        { customData: pointsData(structuredClone(sides)) },
      ],
    }),
  };
}

test("a reversed centerline keeps its shape, in every source it was reversed in", () => {
  const { contour, positioned } = sidedGlyph();
  const glyph = positioned.varGlyph.glyph;
  const shapeBefore = bounds(strokeGlyph(positioned, {}).outlines);
  assert.deepEqual([shapeBefore.yMin, shapeBefore.yMax], [-50, 10]);

  assert.equal(hasSidedPoints(glyph), true);
  const before = snapshotPointOrder(glyph);
  // Only the first source's layer is reversed
  glyph.layers.layer0.glyph.path = fakePath([reversed(contour)]);
  // Fontra makes a new instance when the glyph changes
  positioned.glyph = { ...positioned.glyph, path: fakePath([reversed(contour)]) };
  const { forward, rollback } = keepSidesOnReversal(glyph, before);

  assert.deepEqual(glyph.sources[0].customData[STROKE_KEY].points.p, {
    left: 50,
    right: 10,
  });
  assert.deepEqual(glyph.sources[1].customData[STROKE_KEY].points.p, {
    left: 10,
    right: 50,
  });
  const shapeAfter = bounds(strokeGlyph(positioned, {}).outlines);
  assert.deepEqual([shapeAfter.yMin, shapeAfter.yMax], [-50, 10]);

  assert.equal(forward.length, 1);
  assert.deepEqual(forward[0].p, ["sources", 0, "customData"]);
  assert.equal(forward[0].a[1].points.p.left, 50);
  assert.equal(rollback[0].a[1].points.p.left, 10);
  // The defaults are kept
  assert.equal(forward[0].a[1].defaults.cap, "butt");
});

// As Fontra's ChangeCollector, as far as the wrapper uses it
class FakeCollector {
  static fromChanges(forward, rollback) {
    return new FakeCollector(forward, rollback);
  }
  constructor(forward, rollback) {
    this.forward = forward;
    this.rollback = rollback;
  }
  get hasChange() {
    return this.forward.length > 0;
  }
  concat(other) {
    return new FakeCollector(
      [...this.forward, ...other.forward],
      [...other.rollback, ...this.rollback]
    );
  }
}

function fakeSceneController(glyph) {
  return {
    finished: [],
    async _editGlyphOrInstance(glyphName, editFunc, senderID, doInstance) {
      const result = await editFunc(async () => {}, glyph);
      this.finished.push(result);
    },
  };
}

test("every edit that reverses a contour also swaps the sides, in the same change", async () => {
  const { contour, positioned } = sidedGlyph();
  const glyph = positioned.varGlyph.glyph;
  const sceneController = fakeSceneController(glyph);
  assert.equal(wrapContourReversal(sceneController), true);
  const wrapped = sceneController._editGlyphOrInstance;
  assert.equal(wrapContourReversal(sceneController), true);
  assert.equal(sceneController._editGlyphOrInstance, wrapped);

  const reverse = { f: "reverse" };
  await sceneController._editGlyphOrInstance("a", async (send, editedGlyph) => {
    for (const layer of Object.values(editedGlyph.layers)) {
      layer.glyph.path = fakePath([reversed(contour)]);
    }
    return { changes: new FakeCollector([reverse], [reverse]), undoLabel: "Reverse" };
  });
  const [{ changes, undoLabel }] = sceneController.finished;
  assert.equal(undoLabel, "Reverse");
  assert.equal(changes.forward[0], reverse);
  assert.deepEqual(
    changes.forward.slice(1).map((change) => change.p),
    [
      ["sources", 0, "customData"],
      ["sources", 1, "customData"],
    ]
  );
  // The sides are restored before the contour is turned back
  assert.equal(changes.rollback.at(-1), reverse);
  for (const source of glyph.sources) {
    assert.deepEqual(source.customData[STROKE_KEY].points.q, { left: 50, right: 10 });
  }
});

test("edits that reverse nothing, or of glyphs without sides, are left as they are", async () => {
  const { positioned } = sidedGlyph();
  const glyph = positioned.varGlyph.glyph;
  const sceneController = fakeSceneController(glyph);
  wrapContourReversal(sceneController);
  const changes = new FakeCollector([{ f: "move" }], [{ f: "move" }]);
  await sceneController._editGlyphOrInstance("a", async () => ({ changes }));
  assert.equal(sceneController.finished[0].changes, changes);

  const plain = fakePositionedGlyph({ contours: [line] }).varGlyph.glyph;
  assert.equal(hasSidedPoints(plain), false);
});

test("a Fontra without the method is left alone", () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(wrapContourReversal({}), false);
    assert.equal(wrapContourReversal(undefined), false);
  } finally {
    console.warn = warn;
  }
});
