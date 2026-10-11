import assert from "node:assert/strict";
import { test } from "node:test";

import { centerlineSegments } from "../src/geometry/centerline.js";
import { signedArea, strokeOffsetContour } from "../src/geometry/offset.js";
import { findTwistZones, splitByTurning, turning } from "../src/geometry/twist.js";
import { nearestSample, off, on, sampleCenterline, winding } from "./helpers.js";

const KAPPA = 0.5522847498307936;
const openContour = (...points) => ({ points, isClosed: false });
const style = (overrides = {}) => ({
  width: 80,
  cap: "round",
  join: "round",
  miterLimit: 4,
  ...overrides,
});

// Counter-clockwise quarter circle of radius r: it bends to the left
const quarterArc = (r) =>
  openContour(on(r, 0), off(r, r * KAPPA), off(r * KAPPA, r), on(0, r));
// Up, over and down: it bends to the right, most sharply at the top
const hairpin = openContour(on(0, 0), off(0, 150), off(150, 150), on(150, 0));
// Bends right, then left
const sCurve = openContour(
  on(0, 0),
  off(0, 120),
  off(100, 120),
  on(100, 60, true),
  off(100, 0),
  off(200, 0),
  on(200, 120)
);

const segmentOf = (contour, index = 0) => centerlineSegments(contour)[index];

test("no twist where the radius is larger than half the width", () => {
  assert.deepEqual(findTwistZones(segmentOf(quarterArc(300)), 40), []);
  assert.deepEqual(
    findTwistZones(segmentOf(openContour(on(0, 0), on(100, 0))), 40),
    []
  );
});

test("an arc tighter than half the width twists all along its inner side", () => {
  const zones = findTwistZones(segmentOf(quarterArc(30)), 40);
  assert.equal(zones.length, 1);
  assert.equal(zones[0].side, "left");
  assert.equal(zones[0].t0, 0);
  assert.equal(zones[0].t1, 1);
});

test("a hairpin twists around its sharpest point, between two cusps", () => {
  const zones = findTwistZones(segmentOf(hairpin), 60);
  assert.equal(zones.length, 1);
  const [zone] = zones;
  assert.equal(zone.side, "right");
  assert.ok(zone.t0 > 0.05 && zone.t0 < 0.5, `t0 ${zone.t0}`);
  assert.ok(zone.t1 > 0.5 && zone.t1 < 0.95, `t1 ${zone.t1}`);
  // Symmetric curve, symmetric zone
  assert.ok(Math.abs(zone.t0 + zone.t1 - 1) < 1e-6);
});

test("zones are split into parts that turn by equal angles", () => {
  const segment = segmentOf(quarterArc(100));
  assert.ok(Math.abs(turning(segment, 0, 1) - Math.PI / 2) < 1e-3);
  const [a, mid, b] = splitByTurning(segment, 0, 1, 2);
  assert.equal(a, 0);
  assert.equal(b, 1);
  assert.ok(Math.abs(turning(segment, 0, mid) - Math.PI / 4) < 1e-2);
});

function assertCoversExactly(contour, width, label) {
  const { contours } = strokeOffsetContour(contour, style({ width }));
  const half = width / 2;
  const centerline = sampleCenterline(contour, 600);
  let inside = 0;
  for (let x = -120; x <= 320; x += 5) {
    for (let y = -120; y <= 320; y += 5) {
      const { distance } = nearestSample({ x, y }, centerline);
      const filled = winding({ x, y }, contours) !== 0;
      if (distance < half - 1) {
        assert.ok(filled, `${label}: hole at ${x}, ${y}`);
        inside++;
      } else if (distance > half + 1) {
        assert.ok(!filled, `${label}: filled outside at ${x}, ${y}`);
      }
    }
  }
  assert.ok(inside > 50, label);
}

test("twisting strokes have no holes and nothing extra", () => {
  assertCoversExactly(hairpin, 120, "hairpin");
  assertCoversExactly(hairpin, 200, "wide hairpin");
  assertCoversExactly(quarterArc(30), 80, "tight arc");
  assertCoversExactly(sCurve, 130, "S curve");
});

test("every shape of a twisting stroke is counter-clockwise", () => {
  for (const [contour, width] of [
    [hairpin, 120],
    [hairpin, 200],
    [quarterArc(30), 80],
    [sCurve, 130],
  ]) {
    for (const join of ["miter", "bevel", "round"]) {
      const { contours } = strokeOffsetContour(contour, style({ width, join }));
      // Empty shapes (a band of zero length where a zone starts at the start
      // of a segment) are kept, so that sources keep the same points
      for (const c of contours) {
        assert.ok(signedArea(c) > -1e-6, `width ${width}, ${join}: ${signedArea(c)}`);
      }
      assert.ok(contours.filter((c) => signedArea(c) > 1).length >= 3);
    }
  }
});

test("twist zones are reported with the sharpest point", () => {
  const { twists, layout } = strokeOffsetContour(hairpin, style({ width: 120 }));
  assert.equal(twists.length, 1);
  assert.equal(twists[0].segmentIndex, 0);
  assert.equal(twists[0].side, "right");
  assert.ok(Math.abs(twists[0].point.x - 75) < 1, `x ${twists[0].point.x}`);
  const kinds = layout.segments[0].spans.map((span) => span.kind);
  assert.deepEqual(kinds, ["band", "zone", "band"]);

  const sTwists = strokeOffsetContour(sCurve, style({ width: 130 })).twists;
  assert.deepEqual(
    sTwists.map((twist) => [twist.segmentIndex, twist.side]),
    [
      [0, "right"],
      [1, "left"],
    ]
  );
});

test("a zone turning by more than 90° is split into parts", () => {
  // Half circle of radius 30 drawn as two quarters joined smoothly
  const halfCircle = openContour(
    on(30, 0),
    off(30, 30 * KAPPA),
    off(30 * KAPPA, 30),
    on(0, 30, true),
    off(-30 * KAPPA, 30),
    off(-30, 30 * KAPPA),
    on(-30, 0)
  );
  const wideArc = openContour(on(30, 0), off(30, 60), off(-30, 60), on(-30, 0));
  const { layout } = strokeOffsetContour(wideArc, style({ width: 100 }));
  const zone = layout.segments[0].spans.find((span) => span.kind === "zone");
  assert.ok(zone.parts.length >= 2, `parts ${zone.parts.length}`);
  assertCoversExactly(halfCircle, 80, "half circle");
  assertCoversExactly(wideArc, 100, "wide arc");
});
