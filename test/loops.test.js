import assert from "node:assert/strict";
import { test } from "node:test";

import { strokeCompatibly } from "../src/geometry/compatible.js";
import { signedArea, strokeOffsetContour } from "../src/geometry/offset.js";
import { distanceToSamples, off, on, sampleCenterline, winding } from "./helpers.js";

const KAPPA = 0.5522847498307936;

function style(overrides = {}) {
  return { width: 80, cap: "butt", join: "round", miterLimit: 4, ...overrides };
}

const loop = (...points) => ({ points, isClosed: true });

// A circle of radius r around (cx, cy), counter-clockwise, all points smooth
function circle(r, cx = 0, cy = 0, clockwise = false) {
  const k = r * KAPPA;
  const points = [
    on(cx + r, cy, true),
    off(cx + r, cy + k),
    off(cx + k, cy + r),
    on(cx, cy + r, true),
    off(cx - k, cy + r),
    off(cx - r, cy + k),
    on(cx - r, cy, true),
    off(cx - r, cy - k),
    off(cx - k, cy - r),
    on(cx, cy - r, true),
    off(cx + k, cy - r),
    off(cx + r, cy - k),
  ];
  return clockwise ? loop(points[0], ...points.slice(1).toReversed()) : loop(...points);
}

// Every grid point closer to the centerline than half the width minus a
// margin is filled, and every one farther than half the width plus it is not
function assertCovers(contour, contours, half, box) {
  const centerline = sampleCenterline(contour, 300);
  let inside = 0;
  let outside = 0;
  for (let x = box.xMin; x <= box.xMax; x += 6) {
    for (let y = box.yMin; y <= box.yMax; y += 6) {
      const d = distanceToSamples({ x, y }, centerline);
      const filled = winding({ x, y }, contours) !== 0;
      if (d < half - 1.5) {
        assert.ok(filled, `hole at ${x}, ${y}`);
        inside++;
      } else if (d > half + 1.5) {
        assert.ok(!filled, `filled outside at ${x}, ${y}`);
        outside++;
      }
    }
  }
  assert.ok(inside > 100 && outside > 100);
}

test("a smooth loop is a ring of two edges running in opposite directions", () => {
  for (const clockwise of [false, true]) {
    const contour = circle(200, 0, 0, clockwise);
    const { contours } = strokeOffsetContour(contour, style());
    assert.equal(contours.length, 2);
    const areas = contours.map(signedArea);
    assert.ok(areas[0] * areas[1] < 0, "opposite directions");
    assertCovers(contour, contours, 40, {
      xMin: -280,
      yMin: -280,
      xMax: 280,
      yMax: 280,
    });
    // The hole is empty
    assert.equal(winding({ x: 0, y: 0 }, contours), 0);
  }
});

test("a loop with corners has joins at all of them, its start included", () => {
  // A triangle; with round joins, exactly the points within half the width
  const contour = loop(on(0, 0), on(400, 0), on(200, 300));
  const { contours } = strokeOffsetContour(contour, style());
  // 3 bands and 3 joins, no caps
  assert.equal(contours.length, 6);
  assertCovers(contour, contours, 40, { xMin: -80, yMin: -80, xMax: 480, yMax: 380 });
  assert.equal(winding({ x: 200, y: 100 }, contours), 0);
});

test("a loop's run goes on through its start when that is a smooth point", () => {
  // A D: a straight stem, and a bowl that starts and ends at the stem's
  // corners, with the contour starting in the middle of the bowl
  const contour = loop(
    on(300, 200, true),
    off(300, 330),
    off(220, 400),
    on(100, 400),
    on(100, 0),
    off(220, 0),
    off(300, 70)
  );
  const { contours } = strokeOffsetContour(contour, style({ join: "miter" }));
  // The bowl is one band through the contour's start, the stem another; two joins
  assert.equal(contours.length, 4);
  assertCovers(contour, contours, 40, { xMin: 60, yMin: 60, xMax: 260, yMax: 340 });
});

test("widths of points go round a loop", () => {
  // A loop has no ends: with one point's width, the whole loop would have it
  const contour = circle(200);
  contour.points[0] = { ...contour.points[0], values: { width: 160 } };
  contour.points[6] = { ...contour.points[6], values: { width: 80 } };
  const { contours } = strokeOffsetContour(contour, style());
  // 80 wide (half 40) at the opposite point, 160 at the first; smooth across
  // the contour's start
  assert.notEqual(winding({ x: 270, y: 0 }, contours), 0);
  assert.equal(winding({ x: -250, y: 0 }, contours), 0);
  assert.notEqual(winding({ x: -235, y: 0 }, contours), 0);
  assert.notEqual(winding({ x: 270, y: -5 }, contours), 0);
  assert.notEqual(winding({ x: 270, y: 5 }, contours), 0);
});

test("loops stay compatible between sources", () => {
  const thin = circle(200);
  const thick = circle(200);
  const { compatible } = strokeCompatibly([
    { contour: thin, style: style({ width: 40 }) },
    { contour: thick, style: style({ width: 380 }) },
  ]);
  assert.ok(compatible);
});

test("round a loop, the width changes evenly between a point and the source's", () => {
  // A circle of radius 200, width 160 at its top point (0, 200) only
  const contour = circle(200);
  contour.points[3] = { ...contour.points[3], values: { width: 160 } };
  const { contours } = strokeOffsetContour(contour, style());
  // At the top, 80 out; at the other points, the source's 40
  assert.notEqual(winding({ x: 0, y: 275 }, contours), 0);
  for (const [x, y] of [
    [245, 0],
    [-245, 0],
    [0, -245],
  ]) {
    assert.equal(winding({ x, y }, contours), 0, `${x}, ${y}`);
  }
  // Halfway between the top and the right point (45°), the half width is
  // halfway between theirs: 60, so the outer edge is 260 from the center
  const at = (radius) => ({ x: radius * Math.SQRT1_2, y: radius * Math.SQRT1_2 });
  assert.notEqual(winding(at(257), contours), 0);
  assert.equal(winding(at(263), contours), 0);
});
