import assert from "node:assert/strict";
import { test } from "node:test";

import {
  API_VERSION,
  GLOBAL_NAME,
  makeApi,
  registerApi,
  strokeGlyphSource,
  strokePositionedGlyph,
} from "../src/api.js";
import { strokeContour } from "../src/geometry/stroke.js";
import { strokeGlyph } from "../src/glyph-strokes.js";
import { start } from "../src/start.js";
import { STROKE_KEY } from "../src/stroke-data.js";
import { fakePositionedGlyph } from "./fakes.js";
import { off, on } from "./helpers.js";

const KAPPA = 0.5522847498307936;
const withId = (point, identifier) => ({ ...point, attrs: { identifier } });
const offset = (overrides = {}) => ({
  width: 40,
  cap: "butt",
  join: "miter",
  miterLimit: 4,
  ...overrides,
});
const key = (p) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`;

// A circle of radius r, counter-clockwise, all points smooth
function circle(r) {
  const k = r * KAPPA;
  return {
    points: [
      on(r, 0, true),
      off(r, k),
      off(k, r),
      on(0, r, true),
      off(-k, r),
      off(-r, k),
      on(-r, 0, true),
      off(-r, -k),
      off(-k, -r),
      on(0, -r, true),
      off(k, -r),
      off(r, -k),
    ],
    isClosed: true,
  };
}

// Every point of every edge is a point of one of the outlines
function assertEdgesInOutlines(edges, outlines) {
  const points = new Set(outlines.flatMap((contour) => contour.points.map(key)));
  for (const edge of edges) {
    for (const point of edge.points) {
      assert.ok(points.has(key(point)), `${key(point)} is not in the outlines`);
    }
  }
}

test("the edges of a line are its two sides, without the caps", () => {
  const line = { points: [on(0, 0), on(200, 0)], isClosed: false };
  const { contours, edges } = strokeContour(line, offset({ cap: "round" }));
  // The band and two round caps
  assert.equal(contours.length, 3);
  assert.deepEqual(edges, [
    { side: "left", points: [on(0, 20), on(200, 20)], isClosed: false },
    { side: "right", points: [on(0, -20), on(200, -20)], isClosed: false },
  ]);
});

test("a corner ends the edges; its join has none", () => {
  const corner = { points: [on(0, 0), on(200, 0), on(200, 200)], isClosed: false };
  const { contours, edges } = strokeContour(corner, offset());
  // Two bands and the join
  assert.equal(contours.length, 3);
  assert.deepEqual(
    edges.map((edge) => [edge.side, edge.points[0], edge.points.at(-1)]),
    [
      ["left", on(0, 20), on(200, 20)],
      ["right", on(0, -20), on(200, -20)],
      ["left", on(180, 0), on(180, 200)],
      ["right", on(220, 0), on(220, 200)],
    ]
  );
  assertEdgesInOutlines(edges, contours);
});

test("the edges of a loop without corners are closed and run along it", () => {
  const { contours, edges } = strokeContour(circle(100), offset());
  assert.deepEqual(
    edges.map((edge) => [edge.side, edge.isClosed]),
    [
      ["left", true],
      ["right", true],
    ]
  );
  // Counter-clockwise, the left is inside
  const [left, right] = edges;
  assert.ok(Math.abs(Math.hypot(left.points[0].x, left.points[0].y) - 80) < 1e-6);
  assert.ok(Math.abs(Math.hypot(right.points[0].x, right.points[0].y) - 120) < 1e-6);
  assert.ok(left.points[3].y > 0 && right.points[3].y > 0);
  assertEdgesInOutlines(edges, contours);
});

test("edges have the points of the outlines with every method", () => {
  const curve = {
    points: [on(0, 0), off(50, 200), off(250, 200), on(300, 0, true), on(500, 0)],
    isClosed: false,
  };
  for (const style of [
    offset({ width: 80, join: "round" }),
    { type: "nib", shape: "ellipse", major: 120, minor: 30, angle: 45 },
    { type: "nib", shape: "rect", major: 120, minor: 30, angle: 30 },
  ]) {
    const { contours, edges } = strokeContour(curve, style);
    assert.ok(edges.length >= 2 && edges.length % 2 === 0, style.type);
    assertEdgesInOutlines(edges, contours);
  }
});

test("a glyph read from a file is stroked as in the preview", () => {
  const contours = [
    {
      points: [withId(on(0, 0), "a"), on(200, 0), withId(on(200, 200), "c")],
      isClosed: false,
    },
    // A loop marked as a centerline, and an outline
    {
      points: circle(100).points.map((p, i) => (i ? p : withId(p, "o"))),
      isClosed: true,
    },
    { points: [on(0, 0), on(10, 0), on(0, 10)], isClosed: true },
  ];
  const customData = {
    [STROKE_KEY]: {
      defaults: { width: 60, cap: "round" },
      points: { a: { width: 20 }, c: { join: "round" }, o: { centerline: true } },
    },
  };
  const result = strokeGlyphSource({ contours, customData });
  const preview = strokeGlyph(
    fakePositionedGlyph({ contours, sources: [{ customData }] }),
    {}
  );
  assert.deepEqual(result.outlines, preview.outlines);
  assert.deepEqual(result.centerlines, [0, 1]);
  assert.deepEqual(
    result.edges.map((edge) => [edge.contourIndex, edge.side]),
    [
      [0, "left"],
      [0, "right"],
      [0, "left"],
      [0, "right"],
      [1, "left"],
      [1, "right"],
    ]
  );
  assert.deepEqual(result.twists, []);
});

test("another source takes what all sources share from the default source", () => {
  // Each source's layer has identifiers of its own
  const layer = (prefix) => [
    {
      points: [
        withId(on(0, 0), `${prefix}1`),
        off(50, 200),
        off(250, 200),
        withId(on(300, 0), `${prefix}2`),
        withId(on(400, 200), `${prefix}3`),
      ],
      isClosed: false,
    },
    {
      points: circle(100).points.map((p, i) => (i ? p : withId(p, `${prefix}o`))),
      isClosed: true,
    },
  ];
  const light = layer("l");
  const bold = layer("b");
  const cases = [
    {
      glyphCustomData: {},
      lightData: {
        defaults: { width: 40, cap: "round", join: "miter" },
        points: { l2: { join: "round", width: 30 }, lo: { centerline: true } },
      },
      // Its own cap, join and centerline marks are not used
      boldData: {
        defaults: { width: 90, cap: "butt", join: "bevel" },
        points: { b2: { join: "bevel", width: 100 } },
      },
    },
    {
      glyphCustomData: { [STROKE_KEY]: { type: "nib", shape: "ellipse" } },
      lightData: {
        defaults: { major: 100, minor: 20, angle: 170 },
        points: {
          l3: { angle: 10, angleBase: "centerline" },
          lo: { centerline: true },
        },
      },
      boldData: {
        defaults: { major: 160, minor: 40, angle: 5 },
        points: { b3: { angle: 175 } },
      },
    },
  ];
  for (const { glyphCustomData, lightData, boldData } of cases) {
    const sources = [
      { customData: { [STROKE_KEY]: lightData } },
      { customData: { [STROKE_KEY]: boldData } },
    ];
    const preview = strokeGlyph(
      fakePositionedGlyph({
        contours: bold,
        glyphCustomData,
        sources,
        sourceContours: [light, bold],
        sourceIndex: 1,
      }),
      {}
    );
    const result = strokeGlyphSource({
      contours: bold,
      customData: sources[1].customData,
      glyphCustomData,
      defaultSource: { contours: light, customData: sources[0].customData },
    });
    assert.ok(preview.outlines.length > 2);
    assert.deepEqual(result.outlines, preview.outlines);
    assert.deepEqual(result.centerlines, [0, 1]);
  }
});

test("identifiers may be on the points themselves", () => {
  const contours = [{ points: [on(0, 0), { ...on(200, 0), identifier: "b" }] }];
  const customData = {
    [STROKE_KEY]: { defaults: { cap: "butt" }, points: { b: { width: 100 } } },
  };
  const { edges } = strokeGlyphSource({ contours, customData });
  assert.deepEqual(edges[0].points.at(-1), on(200, 50));
});

test("the glyph in the editor gives the edges of its own and its components' strokes", () => {
  const base = fakePositionedGlyph({
    glyphName: "acute",
    sources: [{ customData: { [STROKE_KEY]: { defaults: { width: 20 } } } }],
  });
  const glyph = fakePositionedGlyph({
    contours: [
      { points: [on(0, 0), on(10, 0), on(0, 10)], isClosed: true },
      { points: [on(0, 0), on(200, 0)], isClosed: false },
    ],
    sources: [{ customData: { [STROKE_KEY]: { defaults: { width: 80 } } } }],
    components: [
      {
        name: "acute",
        contours: [{ points: [on(0, 500), on(0, 600)], isClosed: false }],
      },
    ],
  });
  const componentGlyphs = {
    get: (name) => (name === "acute" ? base.varGlyph : undefined),
  };
  const result = strokePositionedGlyph(glyph, {}, componentGlyphs);
  assert.deepEqual(result.centerlines, [1]);
  assert.deepEqual(
    result.edges.map((edge) => [edge.componentIndex, edge.contourIndex, edge.side]),
    [
      [undefined, 1, "left"],
      [undefined, 1, "right"],
      [0, 0, "left"],
      [0, 0, "right"],
    ]
  );
  assert.deepEqual(result.edges[2].points, [on(-10, 500), on(-10, 600)]);
  // The band and the caps of both
  assert.equal(result.outlines.length, 6);
  // What the caller gets is a copy: the preview keeps its own
  result.edges[0].points[0].x = 1000;
  result.outlines.length = 0;
  const again = strokePositionedGlyph(glyph, {}, componentGlyphs);
  assert.equal(again.edges[0].points[0].x, 0);
  assert.equal(again.outlines.length, 6);
});

test("the registration has a version and is kept when a later one is there", () => {
  const target = {};
  const api = registerApi(undefined, target);
  assert.equal(target[GLOBAL_NAME], api);
  assert.equal(api.apiVersion, API_VERSION);
  assert.equal(API_VERSION, 1);
  assert.ok(Object.isFrozen(api));
  assert.deepEqual(Object.keys(api), [
    "apiVersion",
    "strokePositionedGlyph",
    "strokeGlyphSource",
  ]);
  // Starting again replaces it
  assert.notEqual(registerApi(undefined, target), api);
  const later = { apiVersion: API_VERSION + 1 };
  target[GLOBAL_NAME] = later;
  assert.equal(registerApi(undefined, target), later);
});

test("the registered functions do not throw", () => {
  const api = makeApi(undefined);
  const empty = { outlines: [], edges: [], twists: [], centerlines: [] };
  const error = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(api.strokeGlyphSource(), empty);
    assert.deepEqual(api.strokeGlyphSource({ contours: [{ points: null }] }), empty);
    assert.deepEqual(api.strokePositionedGlyph(undefined), empty);
    assert.deepEqual(api.strokePositionedGlyph({ glyph: { path: 5 } }), empty);
  } finally {
    console.error = error;
  }
});

test("start registers the functions for other plugins", () => {
  const before = globalThis[GLOBAL_NAME];
  const warn = console.warn;
  console.warn = () => {};
  try {
    delete globalThis[GLOBAL_NAME];
    start(
      {
        visualizationLayers: { definitions: [], toggle() {} },
        canvasController: { requestUpdate() {} },
      },
      "."
    );
    assert.equal(globalThis[GLOBAL_NAME]?.apiVersion, API_VERSION);
  } finally {
    console.warn = warn;
    globalThis[GLOBAL_NAME] = before;
    if (before === undefined) {
      delete globalThis[GLOBAL_NAME];
    }
  }
});
