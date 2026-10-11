import assert from "node:assert/strict";
import { test } from "node:test";

import { pointAt } from "../src/geometry/bezier.js";
import { centerlineSegments } from "../src/geometry/centerline.js";
import { strokeCompatibly } from "../src/geometry/compatible.js";
import { strokeOffsetContour } from "../src/geometry/offset.js";
import { findTwistZones } from "../src/geometry/twist.js";
import { monotoneCubic, widthProfile } from "../src/geometry/widths.js";
import { off, on, winding } from "./helpers.js";

const KAPPA = 0.5522847498307936;

function style(overrides = {}) {
  return { width: 80, cap: "butt", join: "miter", miterLimit: 4, ...overrides };
}

const openContour = (...points) => ({ points, isClosed: false });
const valued = (point, values) => ({ ...point, values });

function assertClose(actual, expected, tolerance, message) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message ?? ""} expected ${expected} ± ${tolerance}, got ${actual}`
  );
}

test("the width curve goes through its knots without overshooting", () => {
  const curve = monotoneCubic([
    { x: 0, y: 10 },
    { x: 100, y: 50 },
    { x: 150, y: 50 },
    { x: 300, y: 20 },
  ]);
  assert.equal(curve(0), 10);
  assert.equal(curve(100), 50);
  assert.equal(curve(300), 20);
  for (let x = 0; x <= 300; x += 1) {
    const y = curve(x);
    assert.ok(y >= 10 - 1e-9 && y <= 50 + 1e-9, `${y} at ${x}`);
  }
  // Flat between two equal knots
  assert.equal(curve(125), 50);
  assert.ok(curve.isConstantBetween(100, 150));
  assert.ok(!curve.isConstantBetween(0, 100));
  // Before and after the knots
  assert.equal(curve(-10), 10);
  assert.equal(curve(400), 20);
  assert.equal(curve.max, 50);
});

test("the width curve is smooth through a knot", () => {
  const curve = monotoneCubic([
    { x: 0, y: 10 },
    { x: 100, y: 30 },
    { x: 200, y: 60 },
  ]);
  const h = 1e-4;
  const before = (curve(100) - curve(100 - h)) / h;
  const after = (curve(100 + h) - curve(100)) / h;
  assertClose(before, after, 1e-3, "slope");
});

test("without point widths, the width is the source's all along", () => {
  const contour = openContour(on(0, 0), off(100, 100), off(200, 100), on(300, 0));
  const profile = widthProfile(contour, centerlineSegments(contour), style());
  for (const t of [0, 0.3, 1]) {
    assert.equal(profile.segments[0].left(t), 40);
    assert.equal(profile.segments[0].right(t), 40);
  }
  assert.ok(profile.segments[0].constant.left);
  assert.equal(profile.max, 40);
});

test("end points without a width use the source's; middle ones are interpolated", () => {
  const contour = openContour(
    on(0, 0),
    valued(on(100, 0), { width: 160 }),
    on(200, 0),
    on(300, 0)
  );
  const profile = widthProfile(contour, centerlineSegments(contour), style());
  assert.deepEqual(profile.atPoint(0), { left: 40, right: 40 });
  assert.deepEqual(profile.atPoint(1), { left: 80, right: 80 });
  assert.deepEqual(profile.atPoint(3), { left: 40, right: 40 });
  const middle = profile.atPoint(2).left;
  assert.ok(middle > 40 && middle < 80, `${middle}`);
});

test("left and right widths are separate", () => {
  const contour = openContour(
    valued(on(0, 0), { left: 10 }),
    valued(on(100, 0), { right: 30, width: 100 })
  );
  const profile = widthProfile(contour, centerlineSegments(contour), style());
  assert.deepEqual(profile.atPoint(0), { left: 10, right: 40 });
  assert.deepEqual(profile.atPoint(1), { left: 50, right: 30 });
});

test("a line's width changes evenly between two end widths", () => {
  const contour = openContour(
    valued(on(0, 0), { width: 40 }),
    valued(on(300, 0), { width: 120 })
  );
  const { contours } = strokeOffsetContour(contour, style());
  for (let x = 10; x <= 290; x += 10) {
    const half = 20 + (40 * x) / 300;
    for (const sign of [1, -1]) {
      assert.notEqual(winding({ x, y: sign * (half - 1) }, contours), 0, `inside ${x}`);
      assert.equal(winding({ x, y: sign * (half + 1) }, contours), 0, `outside ${x}`);
    }
  }
});

test("a point added without a width does not change the stroke", () => {
  // A line, and a curve split in two at its middle (de Casteljau)
  const p = [
    { x: 0, y: 0 },
    { x: 0, y: 200 },
    { x: 300, y: 200 },
    { x: 300, y: 0 },
  ];
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const p01 = mid(p[0], p[1]);
  const p12 = mid(p[1], p[2]);
  const p23 = mid(p[2], p[3]);
  const p012 = mid(p01, p12);
  const p123 = mid(p12, p23);
  const split = mid(p012, p123);
  const ends = [{ width: 30 }, { width: 110 }];
  const cases = [
    [
      openContour(valued(on(0, 0), ends[0]), valued(on(300, 0), ends[1])),
      openContour(valued(on(0, 0), ends[0]), on(90, 0), valued(on(300, 0), ends[1])),
    ],
    [
      openContour(
        valued(on(p[0].x, p[0].y), ends[0]),
        off(p[1].x, p[1].y),
        off(p[2].x, p[2].y),
        valued(on(p[3].x, p[3].y), ends[1])
      ),
      openContour(
        valued(on(p[0].x, p[0].y), ends[0]),
        off(p01.x, p01.y),
        off(p012.x, p012.y),
        on(split.x, split.y, true),
        off(p123.x, p123.y),
        off(p23.x, p23.y),
        valued(on(p[3].x, p[3].y), ends[1])
      ),
    ],
  ];
  for (const [whole, withPoint] of cases) {
    const a = strokeOffsetContour(whole, style({ cap: "round" })).contours;
    const b = strokeOffsetContour(withPoint, style({ cap: "round" })).contours;
    let differences = 0;
    let filled = 0;
    for (let x = -80; x <= 380; x += 5) {
      for (let y = -80; y <= 300; y += 5) {
        const inA = winding({ x, y }, a) !== 0;
        const inB = winding({ x, y }, b) !== 0;
        if (inA !== inB) {
          differences++;
        }
        filled += inA ? 1 : 0;
      }
    }
    assert.ok(filled > 300);
    // Only grid points within a unit or so of the edge may differ
    assert.ok(differences <= 3, `${differences} differences`);
  }
});

test("a round cap with different side widths stays within both edges", () => {
  const values = { left: 10, right: 50 };
  const contour = openContour(valued(on(0, 0), values), valued(on(300, 0), values));
  const { contours } = strokeOffsetContour(contour, style({ cap: "round" }));
  // Left of the line (y > 0) the stroke is 10 wide, right of it 50
  assert.equal(winding({ x: 300, y: 15 }, contours), 0);
  assert.equal(winding({ x: 0, y: 15 }, contours), 0);
  assert.notEqual(winding({ x: 300, y: -45 }, contours), 0);
  // The caps are half circles over the ends of the edges
  assert.notEqual(winding({ x: 325, y: -20 }, contours), 0);
  assert.equal(winding({ x: 335, y: -20 }, contours), 0);
  assert.notEqual(winding({ x: -25, y: -20 }, contours), 0);
});

test("a round join does not stick out on the narrow inner side", () => {
  const values = { left: 10, right: 50 };
  // Turning left: the left side (10) is inside the corner
  const contour = openContour(
    valued(on(0, 0), values),
    valued(on(200, 0), values),
    valued(on(200, 200), values)
  );
  const { contours } = strokeOffsetContour(contour, style({ join: "round" }));
  assert.equal(winding({ x: 170, y: 30 }, contours), 0);
  // The outer side is rounded with the outer width
  assert.notEqual(winding({ x: 230, y: -30 }, contours), 0);
  assert.equal(winding({ x: 240, y: -40 }, contours), 0);
});

test("a corner can have its own join and miter limit", () => {
  const corner = (values) =>
    openContour(on(0, 0), valued(on(200, 0), values), on(200, 200));
  const tip = { x: 235, y: -35 };
  assert.notEqual(
    winding(tip, strokeOffsetContour(corner(undefined), style()).contours),
    0
  );
  assert.equal(
    winding(tip, strokeOffsetContour(corner({ join: "bevel" }), style()).contours),
    0
  );
  assert.equal(
    winding(tip, strokeOffsetContour(corner({ miterLimit: 1.2 }), style()).contours),
    0
  );
});

test("twists are found where the local width is wider than the bend", () => {
  // A quarter circle of radius 100, from 40 wide to 300 wide
  const contour = openContour(
    valued(on(100, 0), { width: 40 }),
    off(100, 100 * KAPPA),
    off(100 * KAPPA, 100),
    valued(on(0, 100), { width: 300 })
  );
  const segments = centerlineSegments(contour);
  const profile = widthProfile(contour, segments, style());
  const zones = findTwistZones(segments[0], (side, t) => profile.segments[0][side](t));
  assert.equal(zones.length, 1);
  assert.equal(zones[0].side, "left");
  assert.ok(zones[0].t0 > 0.2 && zones[0].t1 === 1, JSON.stringify(zones));
  const { twists } = strokeOffsetContour(contour, style());
  assert.equal(twists.length, 1);
  assert.ok(pointAt(segments[0], zones[0].t0).y > 20);
});

test("a line whose width changes in one source only stays compatible", () => {
  const plain = openContour(on(0, 0), on(200, 0), on(200, 200));
  const tapered = openContour(
    valued(on(0, 0), { width: 20 }),
    on(200, 0),
    on(200, 200)
  );
  const { results, compatible } = strokeCompatibly([
    { contour: plain, style: style() },
    { contour: tapered, style: style() },
  ]);
  assert.ok(compatible);
  // The plain source fits its straight edges with curves too
  assert.ok(results[0].contours[0].points.some((p) => p.type));
});
