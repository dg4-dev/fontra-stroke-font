import assert from "node:assert/strict";
import { test } from "node:test";

import { pointAt, tangentAt } from "../src/geometry/bezier.js";
import { centerlineSegments } from "../src/geometry/centerline.js";
import { strokeCompatibly } from "../src/geometry/compatible.js";
import { MIN_CUT, matchRoundedCorners, roundCorners } from "../src/geometry/corners.js";
import { strokeOffsetContour } from "../src/geometry/offset.js";
import { strokeContour } from "../src/geometry/stroke.js";
import { distanceToSamples, off, on, sampleCenterline, winding } from "./helpers.js";

const offset = { width: 80, cap: "round", join: "miter", miterLimit: 4 };
const ellipse = { type: "nib", shape: "ellipse", major: 80, minor: 30, angle: 30 };
const rect = { type: "nib", shape: "rect", major: 80, minor: 30, angle: 30 };

const corner = (x, y, cornerRadius) => ({ ...on(x, y), values: { cornerRadius } });
const open = (...points) => ({ points, isClosed: false });
const loop = (...points) => ({ points, isClosed: true });

function assertClose(actual, expected, tolerance, message = "") {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message} expected ${expected} ± ${tolerance}, got ${actual}`
  );
}

// The arc segments of a rounded contour, and their points
function arcSegments(rounded) {
  return centerlineSegments(rounded).filter((segment) =>
    ["start", "middle"].includes(rounded.points[segment.startIndex].cornerArc)
  );
}

// Every grid point closer to the rounded centerline than half the width
// minus a margin is filled, and every one farther than half the width plus
// it is not: the stroke of the rounded centerline
function assertCoversRounded(contour, contours, half, box) {
  const centerline = sampleCenterline(roundCorners(contour).contour, 300);
  let inside = 0;
  for (let x = box.xMin; x <= box.xMax; x += 6) {
    for (let y = box.yMin; y <= box.yMax; y += 6) {
      const d = distanceToSamples({ x, y }, centerline);
      const filled = winding({ x, y }, contours) !== 0;
      if (d < half - 1.5) {
        assert.ok(filled, `hole at ${x}, ${y}`);
        inside++;
      } else if (d > half + 1.5) {
        assert.ok(!filled, `filled outside at ${x}, ${y}`);
      }
    }
  }
  assert.ok(inside > 100);
}

// The same for a nib: what the nib covers, moved along the rounded centerline
function assertNibCoversRounded(contour, contours, style, box) {
  const centerline = sampleCenterline(roundCorners(contour).contour, 200);
  const a = style.major / 2;
  const b = style.minor / 2;
  const radians = (style.angle * Math.PI) / 180;
  const norm = (p) => {
    const x = (p.x * Math.cos(radians) + p.y * Math.sin(radians)) / a;
    const y = (-p.x * Math.sin(radians) + p.y * Math.cos(radians)) / b;
    return style.shape === "rect"
      ? Math.max(Math.abs(x), Math.abs(y))
      : Math.hypot(x, y);
  };
  for (let x = box.xMin; x <= box.xMax; x += 8) {
    for (let y = box.yMin; y <= box.yMax; y += 8) {
      let best = Infinity;
      for (const s of centerline) {
        best = Math.min(best, norm({ x: x - s.x, y: y - s.y }));
      }
      const filled = winding({ x, y }, contours) !== 0;
      if (best < 1 - 2 / b) {
        assert.ok(filled, `hole at ${x}, ${y}`);
      } else if (best > 1 + 2 / b) {
        assert.ok(!filled, `filled outside at ${x}, ${y}`);
      }
    }
  }
}

test("without a radius, nothing is rounded", () => {
  const contour = open(on(0, 0), on(200, 0), on(200, 200));
  const rounded = roundCorners(contour);
  assert.equal(rounded.contour, contour);
  assert.deepEqual(rounded.corners, []);
  assert.deepEqual(
    strokeContour(contour, offset).contours,
    strokeOffsetContour(contour, offset).contours
  );
});

test("between two lines, the arc has exactly the radius", () => {
  // Turns of 90°, 45° and 150°
  for (const end of [on(200, 200), on(400, 200), on(-146.4, 200)]) {
    const contour = open(on(0, 0), corner(200, 0, 50), end);
    const { contour: rounded, corners } = roundCorners(contour);
    assert.deepEqual(
      corners.map(({ wanted, radius, shrunk }) => ({ wanted, radius, shrunk })),
      [{ wanted: 50, radius: 50, shrunk: false }]
    );
    const tangentOut = {
      x: (end.x - 200) / Math.hypot(end.x - 200, end.y),
      y: end.y / Math.hypot(end.x - 200, end.y),
    };
    const turn = Math.acos(tangentOut.x);
    // Cut r · tan(φ / 2) from the corner on both lines
    const cut = 50 * Math.tan(turn / 2);
    const start = rounded.points.find((p) => p.cornerArc === "start");
    const last = rounded.points.find((p) => p.cornerArc === "end");
    assertClose(start.x, 200 - cut, 1e-9);
    assertClose(start.y, 0, 1e-9);
    assertClose(last.x, 200 + tangentOut.x * cut, 1e-9);
    assertClose(last.y, tangentOut.y * cut, 1e-9);
    // Every point of the arc is 50 from the center, above the cut point
    const center = { x: 200 - cut, y: 50 };
    const arcs = arcSegments(rounded);
    assert.equal(arcs.length, 2);
    for (const segment of arcs) {
      for (let i = 0; i <= 20; i++) {
        const p = pointAt(segment, i / 20);
        assertClose(Math.hypot(p.x - center.x, p.y - center.y), 50, 0.02);
      }
    }
    // The arc goes on from the lines without a kink
    assertClose(tangentAt(arcs[0], 0).x, 1, 1e-9);
    assertClose(tangentAt(arcs[1], 1).x, tangentOut.x, 1e-9);
  }
});

test("next to curves, the arc touches them where they are cut", () => {
  const contour = open(
    on(0, 0),
    off(100, 100),
    off(150, 100),
    corner(200, 0, 30),
    off(250, 100),
    off(300, 100),
    on(400, 0)
  );
  const { contour: rounded, corners } = roundCorners(contour);
  assert.equal(corners[0].radius, 30);
  const original = centerlineSegments(contour);
  const segments = centerlineSegments(rounded);
  assert.equal(segments.length, 4);
  // The curves are cut: what is left lies on the original curves
  const curveSamples = original.map((segment) => {
    const samples = [];
    for (let i = 0; i <= 2000; i++) {
      samples.push(pointAt(segment, i / 2000));
    }
    return samples;
  });
  for (const [k, index] of [
    [0, 0],
    [1, 3],
  ]) {
    for (let i = 0; i <= 10; i++) {
      const p = pointAt(segments[index], i / 10);
      assert.ok(distanceToSamples(p, curveSamples[k]) < 0.2, `${k} ${i}`);
    }
  }
  // The arc starts and ends along the curves, 30 from one center
  const [first, second] = [segments[1], segments[2]];
  const start = pointAt(first, 0);
  const tangent = tangentAt(segments[0], 1);
  // The corner turns left: the center is on the left of the curve
  const center = { x: start.x - tangent.y * 30, y: start.y + tangent.x * 30 };
  for (const segment of [first, second]) {
    for (let i = 0; i <= 10; i++) {
      const p = pointAt(segment, i / 10);
      assertClose(Math.hypot(p.x - center.x, p.y - center.y), 30, 0.05);
    }
  }
  assertClose(tangentAt(first, 0).x, tangent.x, 1e-6);
  assertClose(tangentAt(first, 0).y, tangent.y, 1e-6);
  const after = tangentAt(segments[3], 0);
  assertClose(tangentAt(second, 1).x, after.x, 1e-4);
  assertClose(tangentAt(second, 1).y, after.y, 1e-4);
});

test("a radius that does not fit is made smaller, and reported", () => {
  // The segment after the corner is 100 long: at 90°, the arc cuts its radius
  const contour = open(on(0, 0), corner(300, 0, 150), on(300, 100));
  const { corners } = roundCorners(contour);
  assert.equal(corners[0].shrunk, true);
  assert.equal(corners[0].wanted, 150);
  assertClose(corners[0].radius, 100 - MIN_CUT, 1e-9);
  // Along a curve too
  const curved = open(
    on(0, 0),
    corner(300, 0, 200),
    off(300, 40),
    off(280, 80),
    on(250, 100)
  );
  const result = roundCorners(curved);
  assert.equal(result.corners[0].shrunk, true);
  assert.ok(result.corners[0].radius > 10 && result.corners[0].radius < 200);
  assert.deepEqual(strokeContour(curved, offset).corners, result.corners);
});

test("two corners share the segment between them", () => {
  // 100 between the corners: the small radius keeps its own, the large one
  // gets the rest
  const shared = roundCorners(
    open(on(0, 0), corner(100, 0, 20), corner(100, 100, 150), on(0, 100))
  );
  assert.equal(shared.corners[0].radius, 20);
  assertClose(shared.corners[1].radius, 100 - MIN_CUT - 20, 1e-9);
  // Both too large: each gets half
  const halves = roundCorners(
    open(on(0, 0), corner(100, 0, 90), corner(100, 100, 150), on(0, 100))
  );
  assertClose(halves.corners[0].radius, (100 - MIN_CUT) / 2, 1e-9);
  assertClose(halves.corners[1].radius, (100 - MIN_CUT) / 2, 1e-9);
});

test("the stroke is that of the rounded centerline, with the width", () => {
  for (const radius of [0, 10, 40, 60, 150]) {
    const box = { xMin: -60, yMin: -60, xMax: 460, yMax: 260 };
    for (const contour of [
      open(on(0, 0), corner(200, 0, radius), on(200, 200)),
      open(on(0, 0), corner(200, 0, radius), on(20, 60)),
      open(
        on(0, 0),
        off(100, 100),
        off(150, 100),
        corner(200, 0, radius),
        off(250, 100),
        off(300, 100),
        on(400, 0)
      ),
    ]) {
      const { contours, twists } = strokeContour(contour, offset);
      // A radius under half the width keeps the inner side a corner, and
      // is no twist
      assert.equal(twists.length, 0);
      assertCoversRounded(contour, contours, 40, box);
    }
  }
});

test("with a radius under half the width, the inner side stays a corner", () => {
  // The inner edges of the two lines cross at (160, 40)
  const contour = open(on(0, 0), corner(200, 0, 10), on(200, 200));
  const { contours } = strokeContour(contour, { ...offset, cap: "butt" });
  assert.equal(winding({ x: 158, y: 42 }, contours), 0);
  for (const [x, y] of [
    [158, 38],
    [162, 42],
    [162, 38],
  ]) {
    assert.notEqual(winding({ x, y }, contours), 0, `${x}, ${y}`);
  }
  // The outer edge is an arc of 10 + 40 around (190, 10)
  const at = (r) => ({ x: 190 + r * Math.SQRT1_2, y: 10 - r * Math.SQRT1_2 });
  assert.notEqual(winding(at(48.5), contours), 0);
  assert.equal(winding(at(51.5), contours), 0);
});

test("nibs are swept round the arc", () => {
  for (const style of [ellipse, rect]) {
    for (const radius of [0, 10, 40, 150]) {
      const contour = open(on(0, 0), corner(200, 0, radius), on(200, 200));
      const { contours } = strokeContour(contour, style);
      assertNibCoversRounded(contour, contours, style, {
        xMin: -60,
        yMin: -60,
        xMax: 260,
        yMax: 260,
      });
    }
  }
});

test("the corners of loops are rounded, the start included", () => {
  for (const radius of [0, 10, 60]) {
    const square = loop(
      ...[on(0, 0), on(300, 0), on(300, 300), on(0, 300)].map((p) => ({
        ...p,
        values: { cornerRadius: radius },
      }))
    );
    const rounded = roundCorners(square);
    assert.equal(rounded.corners.length, 4);
    // The first point is where the arc of the first corner ends
    assert.equal(rounded.contour.points[0].cornerArc, "end");
    assert.equal(rounded.contour.points.length, 4 * 7);
    const { contours } = strokeContour(square, offset);
    // Without corners left, the loop is a ring of two edges
    assert.equal(contours.length, 2);
    assertCoversRounded(square, contours, 40, {
      xMin: -60,
      yMin: -60,
      xMax: 360,
      yMax: 360,
    });
    assert.equal(winding({ x: 150, y: 150 }, contours), 0);
    for (const style of [ellipse, rect]) {
      assertNibCoversRounded(square, strokeContour(square, style).contours, style, {
        xMin: -60,
        yMin: -60,
        xMax: 360,
        yMax: 360,
      });
    }
  }
  // One rounded corner: the others keep their joins
  const triangle = loop(on(0, 0), corner(400, 0, 50), on(200, 300));
  const { contours } = strokeContour(triangle, { ...offset, join: "round" });
  assertCoversRounded(triangle, contours, 40, {
    xMin: -60,
    yMin: -60,
    xMax: 460,
    yMax: 360,
  });
});

test("a corner rounded in some sources has the same points in all", () => {
  const shape = (radius) =>
    open(
      on(0, 0),
      off(100, 100),
      off(150, 100),
      radius === undefined ? on(200, 0) : corner(200, 0, radius),
      on(300, -100)
    );
  // The source without a radius gets 0
  const matched = matchRoundedCorners([shape(undefined), shape(40)]);
  assert.equal(matched[0].points[3].values.cornerRadius, 0);
  assert.equal(matched[1].points[3].values.cornerRadius, 40);
  const styles = [
    (w) => ({ ...offset, width: w }),
    (w) => ({ ...ellipse, major: w, minor: w / 3 }),
    (w) => ({ ...rect, major: w, minor: w / 3 }),
  ];
  for (const style of styles) {
    for (const [a, b] of [
      [undefined, 30],
      [0, 80],
      [10, 100],
    ]) {
      const { compatible, problems } = strokeCompatibly([
        { contour: shape(a), style: style(60) },
        { contour: shape(b), style: style(140) },
      ]);
      assert.deepEqual(problems, []);
      assert.ok(compatible, `${a} ${b}`);
    }
  }
  // Radius 0: the stroke of a point turning round, round outside and sharp
  // inside
  const zero = open(on(0, 0), corner(200, 0, 0), on(200, 200));
  const { contours } = strokeContour(zero, offset);
  assertCoversRounded(zero, contours, 40, {
    xMin: -60,
    yMin: -60,
    xMax: 260,
    yMax: 260,
  });
  // Round outside, without the miter's tip
  assert.equal(winding({ x: 232, y: -32 }, contours), 0);
  assert.notEqual(winding({ x: 226, y: -26 }, contours), 0);
  // Sharp inside
  assert.notEqual(winding({ x: 158, y: 38 }, contours), 0);
  assert.equal(winding({ x: 158, y: 42 }, contours), 0);
});

test("implied on-curve points stay implied", () => {
  // A quadratic run before the corner
  const contour = open(
    on(0, 0),
    off(50, 100, "quad"),
    off(150, 100, "quad"),
    corner(200, 0, 20),
    on(300, 0)
  );
  const { contour: rounded } = roundCorners(contour);
  const implied = rounded.points.filter((p) => p.implied);
  assert.equal(implied.length, 1);
  const segments = centerlineSegments(rounded);
  assert.equal(segments[0].endIndex, undefined);
  assert.equal(segments[1].startIndex, undefined);
  // So the width along the run changes from its first point to the corner,
  // nearly as without rounding (the run ends a little before the corner):
  // as a point of its own, the implied point would take the source's width
  contour.points[0] = { ...contour.points[0], values: { width: 120 } };
  const half = (stroked) => {
    let y = 75;
    while (winding({ x: 62.5, y }, stroked.contours) !== 0) {
      y += 0.25;
    }
    return y;
  };
  const plain = { ...contour, points: contour.points.map((p) => ({ ...p })) };
  plain.points[3] = on(200, 0);
  assertClose(
    half(strokeContour(contour, { ...offset, width: 40 })),
    half(strokeContour(plain, { ...offset, width: 40 })),
    2
  );
});
