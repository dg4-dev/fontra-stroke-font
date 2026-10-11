import assert from "node:assert/strict";
import { test } from "node:test";

import {
  mergeBreakLayouts,
  mergePieceCounts,
  outlineSignature,
  strokeCompatibly,
} from "../src/geometry/compatible.js";
import { strokeOffsetContour } from "../src/geometry/offset.js";
import { off, on, winding } from "./helpers.js";

const openContour = (...points) => ({ points, isClosed: false });
const style = (overrides = {}) => ({
  width: 80,
  cap: "round",
  join: "miter",
  miterLimit: 4,
  ...overrides,
});

const hairpin = openContour(on(0, 0), off(0, 150), off(150, 150), on(150, 0));
const sCurve = openContour(
  on(0, 0),
  off(0, 120),
  off(100, 120),
  on(100, 60, true),
  off(100, 0),
  off(200, 0),
  on(200, 120)
);

function assertCompatible(inputs) {
  const { results, compatible, problems } = strokeCompatibly(inputs);
  assert.deepEqual(problems, []);
  assert.equal(compatible, true);
  const signatures = results.map((result) => outlineSignature(result.contours));
  assert.ok(signatures.every((s) => s === signatures[0]));
  return results;
}

test("alone, a twisting source and a plain one have different points", () => {
  const thin = strokeOffsetContour(hairpin, style({ width: 60 }));
  const thick = strokeOffsetContour(hairpin, style({ width: 140 }));
  assert.notEqual(outlineSignature(thin.contours), outlineSignature(thick.contours));
});

test("a twisting source and a plain one become compatible", () => {
  const [thin, thick] = assertCompatible([
    { contour: hairpin, style: style({ width: 60 }) },
    { contour: hairpin, style: style({ width: 140 }) },
  ]);
  // The thin source keeps its shape: the added zone is empty
  assert.equal(thin.twists.length, 0);
  assert.equal(thick.twists.length, 1);
  assert.notEqual(winding({ x: 75, y: 105 }, thin.contours), 0);
  assert.equal(winding({ x: 75, y: 60 }, thin.contours), 0);
});

test("different piece counts are made the same", () => {
  const curve = openContour(on(0, 0), off(0, 300), off(300, 300), on(300, 0));
  assertCompatible([
    { contour: curve, style: style({ width: 20 }) },
    { contour: curve, style: style({ width: 180 }) },
  ]);
});

test("miter and bevel corners have the same points", () => {
  const corner = openContour(on(0, 0), on(100, 0), on(100, 100));
  const [miter, bevel] = assertCompatible([
    { contour: corner, style: style({ miterLimit: 10 }) },
    { contour: corner, style: style({ miterLimit: 1.2 }) },
  ]);
  assert.notEqual(winding({ x: 138, y: -38 }, miter.contours), 0);
  assert.equal(winding({ x: 138, y: -38 }, bevel.contours), 0);
});

test("zones on both sides of an S curve, in some sources only", () => {
  const moved = openContour(
    on(0, 0),
    off(0, 200),
    off(100, 200),
    on(100, 60, true),
    off(100, -100),
    off(200, 0),
    on(200, 120)
  );
  assertCompatible([
    { contour: sCurve, style: style({ width: 40 }) },
    { contour: sCurve, style: style({ width: 130 }) },
    { contour: moved, style: style({ width: 100 }) },
  ]);
});

test("centerlines with different segments are reported", () => {
  const { compatible, problems } = strokeCompatibly([
    { contour: openContour(on(0, 0), on(100, 0)), style: style() },
    { contour: openContour(on(0, 0), on(50, 0), on(100, 0)), style: style() },
  ]);
  assert.equal(compatible, false);
  assert.match(problems[0], /different number of segments/);
});

test("a zero width in one source is reported", () => {
  const { compatible, problems } = strokeCompatibly([
    { contour: hairpin, style: style({ width: 0 }) },
    { contour: hairpin, style: style({ width: 80 }) },
  ]);
  assert.equal(compatible, false);
  assert.match(problems[0], /zero length/);
});

test("split parameters are merged from all sources", () => {
  const side = (breaks, pieces) => ({ breaks, pieces });
  const merged = mergeBreakLayouts([
    { segments: [{ left: side([0.3, 0.7], [1, 2, 1]), right: side([], [1]) }] },
    { segments: [{ left: side([0.5], [1, 1]), right: side([0.2], [2, 1]) }] },
  ]);
  assert.deepEqual(merged.segments[0].left.breaks, [0.3, 0.5, 0.7]);
  assert.deepEqual(merged.segments[0].right.breaks, [0.2]);
  assert.equal(merged.segments[0].left.pieces, undefined);
  const problems = [];
  assert.equal(
    mergeBreakLayouts([{ segments: [null] }, { segments: [null, null] }], problems),
    null
  );
  assert.equal(problems.length, 1);
});

test("piece counts are merged by taking the largest", () => {
  const side = (pieces) => ({
    breaks: pieces.slice(1).map((_, i) => (i + 1) / 10),
    pieces,
  });
  const merged = mergePieceCounts([
    { segments: [{ left: side([2, 1]), right: side([1]) }, null] },
    { segments: [{ left: side([1, 3]), right: side([4]) }, null] },
  ]);
  assert.deepEqual(merged.segments[0].left.pieces, [2, 3]);
  assert.deepEqual(merged.segments[0].right.pieces, [4]);
  assert.equal(
    mergePieceCounts([
      { segments: [{ left: side([1]), right: side([1]) }] },
      { segments: [null] },
    ]),
    null
  );
});

// Linear interpolation of two compatible outlines, point by point
function interpolateContours(a, b, f) {
  return a.map((contour, i) => ({
    isClosed: true,
    points: contour.points.map((p, j) => {
      const q = b[i].points[j];
      const point = { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f };
      return p.type ? { ...point, type: p.type } : point;
    }),
  }));
}

test("interpolating a twisting and a plain source leaves no cracks", async () => {
  const { nearestSample, sampleCenterline } = await import("./helpers.js");
  // allowance: how far the inner side near a twist may fall short of a stroke
  // drawn at the in-between width. The edge of the twisting source is capped
  // at the bend radius, which is not linear in the width, so in between the
  // inner side there comes out thinner (measured: up to 10 units at 3/4 of
  // the way from width 60 to 140). Everywhere else in-between outlines match
  // a stroke of the in-between width up to the fitting tolerance.
  for (const [contour, thin, thick, allowance] of [
    [hairpin, 60, 140, 10],
    [hairpin, 40, 220, 40],
    [sCurve, 40, 130, 22],
  ]) {
    const [a, b] = assertCompatible([
      { contour, style: style({ width: thin, join: "round" }) },
      { contour, style: style({ width: thick, join: "round" }) },
    ]);
    const centerline = sampleCenterline(contour, 600);
    for (const f of [0.25, 0.5, 0.75]) {
      const contours = interpolateContours(a.contours, b.contours, f);
      const half = (thin + (thick - thin) * f) / 2;
      for (let x = -40; x <= 240; x += 2) {
        for (let y = -40; y <= 240; y += 2) {
          const { distance } = nearestSample({ x, y }, centerline);
          // Inside the thinner source's stroke nothing may be missing at all
          const limit = Math.max(thin / 2 - 1, half - allowance);
          if (distance < limit) {
            assert.notEqual(
              winding({ x, y }, contours),
              0,
              `${thin}/${thick} at ${f}: missing at ${x}, ${y}`
            );
          }
        }
      }
    }
  }
});

test("without twists, in-between outlines match a stroke of the in-between width", async () => {
  const { nearestSample, sampleCenterline } = await import("./helpers.js");
  const curve = openContour(on(0, 0), off(0, 300), off(300, 300), on(300, 0));
  const [a, b] = assertCompatible([
    { contour: curve, style: style({ width: 20, join: "round" }) },
    { contour: curve, style: style({ width: 120, join: "round" }) },
  ]);
  const centerline = sampleCenterline(curve, 800);
  const contours = interpolateContours(a.contours, b.contours, 0.5);
  for (let x = -80; x <= 380; x += 4) {
    for (let y = -80; y <= 300; y += 4) {
      const { distance } = nearestSample({ x, y }, centerline);
      const filled = winding({ x, y }, contours) !== 0;
      if (distance < 35 - 1) {
        assert.ok(filled, `missing at ${x}, ${y}`);
      } else if (distance > 35 + 1) {
        assert.ok(!filled, `extra at ${x}, ${y}`);
      }
    }
  }
});
