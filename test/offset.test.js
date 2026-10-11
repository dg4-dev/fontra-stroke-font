import assert from "node:assert/strict";
import { test } from "node:test";

import { centerlineSegments } from "../src/geometry/centerline.js";
import {
  DEFAULT_TOLERANCE,
  miterRatio,
  signedArea,
  strokeOffsetContour,
} from "../src/geometry/offset.js";
import {
  bounds,
  distanceToSamples,
  flattenContour,
  nearestSample,
  off,
  on,
  sampleCenterline,
  winding,
} from "./helpers.js";

const KAPPA = 0.5522847498307936;

function style(overrides = {}) {
  return { width: 80, cap: "butt", join: "miter", miterLimit: 4, ...overrides };
}

const openContour = (...points) => ({ points, isClosed: false });

// A quarter circle of radius r around the origin, from (r, 0) to (0, r)
function quarterArc(r) {
  return openContour(on(r, 0), off(r, r * KAPPA), off(r * KAPPA, r), on(0, r));
}

function assertClose(actual, expected, tolerance, message) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message ?? ""} expected ${expected} ± ${tolerance}, got ${actual}`
  );
}

test("a straight line becomes a rectangle of the given width", () => {
  const { contours } = strokeOffsetContour(openContour(on(0, 0), on(200, 0)), style());
  assert.equal(contours.length, 1);
  assert.deepEqual(bounds(contours), { xMin: 0, yMin: -40, xMax: 200, yMax: 40 });
  assert.equal(contours[0].points.length, 4);
  assert.ok(contours[0].points.every((p) => !p.type));
});

test("the edges of a curve stay half the width away from the centerline", () => {
  for (const contour of [
    quarterArc(300),
    openContour(on(0, 0), off(60, 300), off(340, -200), on(400, 100)),
  ]) {
    const { contours } = strokeOffsetContour(contour, style());
    const centerline = sampleCenterline(contour, 2000);
    const band = contours[0];
    // Points on the band's curved edges (the straight ends are the butt caps)
    let checked = 0;
    for (const p of flattenContour(band, 64)) {
      const d = distanceToSamples(p, centerline);
      const atEnd =
        Math.hypot(p.x - contour.points[0].x, p.y - contour.points[0].y) < 40.5 ||
        Math.hypot(p.x - contour.points.at(-1).x, p.y - contour.points.at(-1).y) < 40.5;
      if (!atEnd) {
        assertClose(d, 40, DEFAULT_TOLERANCE + 0.05, "edge distance");
        checked++;
      }
    }
    assert.ok(checked > 100);
  }
});

test("an arc's edges are arcs of radius r ± half the width", () => {
  const { contours } = strokeOffsetContour(quarterArc(300), style());
  const radii = flattenContour(contours[0], 64).map((p) => Math.hypot(p.x, p.y));
  // 0.03% of 340 is the error of the cubic quarter circle itself
  assert.ok(radii.every((r) => Math.abs(r - 260) < 0.6 || Math.abs(r - 340) < 0.6));
});

test("the number of pieces can be given per segment", () => {
  const contour = openContour(
    on(0, 0),
    on(100, 0, true),
    off(200, 0),
    off(200, 100),
    on(200, 200)
  );
  const auto = strokeOffsetContour(contour, style());
  assert.equal(auto.subdivisions[0], 1);
  const forced = strokeOffsetContour(contour, style(), {
    subdivisions: [undefined, 3],
  });
  assert.deepEqual(forced.subdivisions, [1, 3]);
  // 1 line + 3 cubics on each edge, joined by the two ends
  const band = forced.contours[0];
  assert.equal(band.points.filter((p) => !p.type).length, 10);
  assert.equal(band.points.filter((p) => p.type).length, 12);
});

test("a tighter tolerance uses more pieces", () => {
  const contour = openContour(on(0, 0), off(0, 300), off(300, 300), on(300, 0));
  const loose = strokeOffsetContour(contour, style({ width: 200 }), { tolerance: 5 });
  const tight = strokeOffsetContour(contour, style({ width: 200 }), {
    tolerance: 0.05,
  });
  assert.ok(tight.subdivisions[0] > loose.subdivisions[0]);
});

test("all contours are counter-clockwise", () => {
  for (const join of ["miter", "round", "bevel"]) {
    for (const cap of ["butt", "round", "square"]) {
      for (const contour of [
        openContour(on(0, 0), on(100, 0), on(100, 100)),
        openContour(on(0, 0), on(100, 0), on(100, -100)),
        openContour(on(0, 0), off(50, 100), off(150, 100), on(200, 0), on(300, 50)),
      ]) {
        const { contours } = strokeOffsetContour(contour, style({ join, cap }));
        for (const c of contours) {
          assert.ok(signedArea(c) > 0, `${join}/${cap}`);
        }
      }
    }
  }
});

test("butt, square and round caps", () => {
  const line = openContour(on(0, 0), on(200, 0));
  const butt = strokeOffsetContour(line, style({ cap: "butt" })).contours;
  assert.deepEqual(bounds(butt), { xMin: 0, yMin: -40, xMax: 200, yMax: 40 });

  const square = strokeOffsetContour(line, style({ cap: "square" })).contours;
  assert.equal(square.length, 3);
  assert.deepEqual(bounds(square), { xMin: -40, yMin: -40, xMax: 240, yMax: 40 });

  const round = strokeOffsetContour(line, style({ cap: "round" })).contours;
  assert.equal(round.length, 3);
  const b = bounds(round);
  assertClose(b.xMin, -40, 0.05);
  assertClose(b.xMax, 240, 0.05);
  // The rounded end is a half disk: inside within the radius, outside beyond it
  assert.equal(winding({ x: -39, y: 0 }, round) !== 0, true);
  assert.equal(winding({ x: -28, y: 28 }, round) !== 0, true);
  assert.equal(winding({ x: -30, y: 30 }, round), 0);
});

test("caps follow the direction of the ends", () => {
  // Vertical line going up, square caps extend below and above
  const { contours } = strokeOffsetContour(
    openContour(on(0, 0), on(0, 100)),
    style({ cap: "square" })
  );
  assert.deepEqual(bounds(contours), { xMin: -40, yMin: -40, xMax: 40, yMax: 140 });
});

test("a retracted handle still gives the end its direction", () => {
  // The first handle sits on the start point; the curve leaves towards +y
  const { contours } = strokeOffsetContour(
    openContour(on(0, 0), off(0, 0), off(0, 100), on(100, 100)),
    style({ cap: "square" })
  );
  const b = bounds(contours);
  assertClose(b.yMin, -40, 1e-6);
});

test("miter, bevel and round joins at a right angle", () => {
  const corner = openContour(on(0, 0), on(100, 0), on(100, 100));
  // Turning left at (100, 0): the outer side is at the bottom right

  const miter = strokeOffsetContour(corner, style({ join: "miter" })).contours;
  assert.equal(miter.length, 3);
  assert.notEqual(winding({ x: 138, y: -38 }, miter), 0);
  const miterBounds = bounds(miter);
  assert.equal(miterBounds.xMax, 140);
  assert.equal(miterBounds.yMin, -40);

  const bevel = strokeOffsetContour(corner, style({ join: "bevel" })).contours;
  assert.equal(bevel.length, 3);
  // Beyond the bevel line x - y = 140 nothing is filled
  assert.equal(winding({ x: 138, y: -38 }, bevel), 0);
  assert.notEqual(winding({ x: 115, y: -15 }, bevel), 0);

  const round = strokeOffsetContour(corner, style({ join: "round" })).contours;
  assert.equal(round.length, 3);
  assert.notEqual(winding({ x: 127, y: -27 }, round), 0);
  assert.equal(winding({ x: 130, y: -30 }, round), 0);
});

test("the miter limit switches between miter and bevel", () => {
  // 90° corner: ratio 1 / sin(45°) = √2
  const corner = openContour(on(0, 0), on(100, 0), on(100, 100));
  assertClose(miterRatio({ x: 1, y: 0 }, { x: 0, y: 1 }), Math.SQRT2, 1e-12);
  const tip = { x: 138, y: -38 };
  const above = strokeOffsetContour(corner, style({ miterLimit: 1.42 })).contours;
  assert.notEqual(winding(tip, above), 0);
  const below = strokeOffsetContour(corner, style({ miterLimit: 1.41 })).contours;
  assert.equal(winding(tip, below), 0);

  // 60° between the lines: ratio 1 / sin(30°) = 2
  const sharp = openContour(
    on(0, 0),
    on(100, 0),
    on(100 - 100 * Math.cos(Math.PI / 3), 100 * Math.sin(Math.PI / 3))
  );
  assertClose(
    miterRatio({ x: 1, y: 0 }, { x: -Math.cos(Math.PI / 3), y: Math.sin(Math.PI / 3) }),
    2,
    1e-12
  );
  // The miter tip lies 2 × 40 = 80 units from the corner, bisecting the outside
  const sharpTip = {
    x: 100 + 79 * Math.cos(Math.PI / 6),
    y: -79 * Math.sin(Math.PI / 6),
  };
  assert.notEqual(
    winding(sharpTip, strokeOffsetContour(sharp, style({ miterLimit: 2.01 })).contours),
    0
  );
  assert.equal(
    winding(sharpTip, strokeOffsetContour(sharp, style({ miterLimit: 1.99 })).contours),
    0
  );
});

test("smooth points do not make a join", () => {
  // A line flowing into a curve through a smooth point
  const contour = openContour(
    on(0, 0),
    on(100, 0, true),
    off(160, 0),
    off(200, 40),
    on(200, 100)
  );
  const { contours } = strokeOffsetContour(contour, style({ join: "round" }));
  assert.equal(contours.length, 1);
});

test("a corner point between curves makes a join", () => {
  const contour = openContour(
    on(0, 0),
    off(50, 50),
    off(100, 50),
    on(150, 0),
    off(200, 50),
    off(250, 50),
    on(300, 0)
  );
  const { contours } = strokeOffsetContour(contour, style({ join: "bevel" }));
  assert.equal(contours.length, 3);
});

test("a round stroke covers exactly the points within half the width", () => {
  const contour = openContour(
    on(0, 0),
    on(200, 0),
    off(300, 0),
    off(300, 150),
    on(200, 200, true),
    off(150, 225),
    off(80, 300),
    on(50, 250)
  );
  const { contours } = strokeOffsetContour(
    contour,
    style({ cap: "round", join: "round" })
  );
  const centerline = sampleCenterline(contour, 400);
  let inside = 0;
  for (let x = -60; x <= 360; x += 7) {
    for (let y = -60; y <= 360; y += 7) {
      const d = distanceToSamples({ x, y }, centerline);
      const filled = winding({ x, y }, contours) !== 0;
      if (d < 40 - 1) {
        assert.ok(filled, `hole at ${x}, ${y}`);
        inside++;
      } else if (d > 40 + 1) {
        assert.ok(!filled, `filled outside at ${x}, ${y}`);
      }
    }
  }
  assert.ok(inside > 200);
});

test("no holes inside sharp miter and bevel strokes", () => {
  const contour = openContour(
    on(0, 0),
    on(200, 0),
    on(50, 60),
    off(0, 200),
    off(200, 250),
    on(250, 150)
  );
  const centerline = sampleCenterline(contour, 400);
  for (const join of ["miter", "bevel"]) {
    const { contours } = strokeOffsetContour(contour, style({ join, cap: "butt" }));
    for (let x = -60; x <= 320; x += 6) {
      for (let y = -60; y <= 320; y += 6) {
        const { sample, distance } = nearestSample({ x, y }, centerline);
        // Points closest to a corner or an end are left to the join and cap
        // shapes, which do not cover all of that disk (unlike round ones).
        if (distance < 39 && !sample.isVertex) {
          assert.notEqual(
            winding({ x, y }, contours),
            0,
            `${join}: hole at ${x}, ${y}`
          );
        }
      }
    }
  }
});

test("zero-length segments are skipped", () => {
  const contour = openContour(on(0, 0), on(100, 0), on(100, 0), on(200, 0));
  const { contours, subdivisions } = strokeOffsetContour(contour, style());
  assert.deepEqual(subdivisions, [1, 0, 1]);
  assert.deepEqual(bounds(contours), { xMin: 0, yMin: -40, xMax: 200, yMax: 40 });
  assert.equal(centerlineSegments(contour).length, 3);
});

test("a lone point becomes a dot with round or square caps", () => {
  const dot = openContour(on(10, 20));
  assert.deepEqual(strokeOffsetContour(dot, style({ cap: "butt" })).contours, []);
  const round = strokeOffsetContour(dot, style({ cap: "round" })).contours;
  assert.equal(round.length, 1);
  const b = bounds(round);
  assertClose(b.xMin, -30, 0.05);
  assertClose(b.yMax, 60, 0.05);
  const square = strokeOffsetContour(dot, style({ cap: "square" })).contours;
  assert.deepEqual(bounds(square), { xMin: -30, yMin: -20, xMax: 50, yMax: 60 });
});

test("closed contours and zero widths give nothing", () => {
  assert.deepEqual(
    strokeOffsetContour(
      { points: [on(0, 0), on(100, 0), on(0, 100)], isClosed: true },
      style()
    ).contours,
    []
  );
  assert.deepEqual(
    strokeOffsetContour(openContour(on(0, 0), on(100, 0)), style({ width: 0 }))
      .contours,
    []
  );
});
