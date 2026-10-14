import assert from "node:assert/strict";
import { test } from "node:test";

import { pointAt } from "../src/geometry/bezier.js";
import { centerlineSegments } from "../src/geometry/centerline.js";
import { outlineSignature, strokeCompatibly } from "../src/geometry/compatible.js";
import {
  ellipseContour,
  makeNib,
  nibAlong,
  nibAngleReference,
  rectContour,
  strokeNibContour,
} from "../src/geometry/nib.js";
import { strokeOffsetContour } from "../src/geometry/offset.js";
import { signedArea } from "../src/geometry/shapes.js";
import { convexHull } from "../src/hit-areas.js";
import { bounds, flattenContour, off, on, winding } from "./helpers.js";

const KAPPA = 0.5522847498307936;

const openContour = (...points) => ({ points, isClosed: false });
const loop = (...points) => ({ points, isClosed: true });

function nib(overrides = {}) {
  return {
    type: "nib",
    shape: "ellipse",
    major: 120,
    minor: 30,
    angle: 45,
    ...overrides,
  };
}

function circle(r, cx = 0, cy = 0) {
  const k = r * KAPPA;
  return loop(
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
    off(cx + r, cy - k)
  );
}

const line = openContour(on(0, 0), on(300, 100));
const sCurve = openContour(on(0, 0), off(40, 300), off(360, -200), on(400, 100));
const hairpin = openContour(on(0, 0), off(0, 150), off(150, 150), on(150, 0));
// A corner that turns back almost on itself
const sharpCorner = openContour(on(0, 0), on(300, 0), on(20, 60));
const corner = openContour(on(0, 0), on(200, 0), on(200, 200));

/**
 * The nibs along a centerline, densely sampled: the reference the stroked
 * outlines are checked against. Each sample is a place and the nib there.
 */
function sampleNibs(contour, style, steps = 400, angleReference) {
  const segments = centerlineSegments(contour);
  const { at } = nibAlong(contour, style, segments, { angleReference });
  const samples = [];
  for (const [index, segment] of segments.entries()) {
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      samples.push({ center: pointAt(segment, t), ...at(index, t) });
    }
  }
  return samples;
}

// Whether a point is inside a nib grown (margin > 0) or shrunk (< 0) by margin
function inNib(point, sample, shape, margin) {
  const n = makeNib(sample.major + 2 * margin, sample.minor + 2 * margin, sample.angle);
  if (!(n.a > 0) || !(n.b > 0)) {
    return false;
  }
  const dx = point.x - sample.center.x;
  const dy = point.y - sample.center.y;
  const u = (dx * n.cos + dy * n.sin) / n.a;
  const v = (-dx * n.sin + dy * n.cos) / n.b;
  return shape === "rect"
    ? Math.max(Math.abs(u), Math.abs(v)) <= 1
    : u * u + v * v <= 1;
}

function describe(contour, style) {
  const points = contour.points.map((p) => `${p.type ? "~" : ""}${p.x},${p.y}`);
  return `${points.join(" ")} ${style.shape} ${style.major}×${style.minor} ${style.angle}°`;
}

// Every grid point well inside one of the nibs is filled, and every one well
// outside all of them is not
function assertCoversNibs(
  contour,
  style,
  contours,
  { margin = 1.5, step = 5, reference } = {}
) {
  const samples = sampleNibs(contour, style, 400, reference);
  const box = bounds(contours);
  let inside = 0;
  let outside = 0;
  for (let x = box.xMin - 10; x <= box.xMax + 10; x += step) {
    for (let y = box.yMin - 10; y <= box.yMax + 10; y += step) {
      const point = { x, y };
      const filled = winding(point, contours) !== 0;
      if (samples.some((s) => inNib(point, s, style.shape, -margin))) {
        assert.ok(filled, `hole at ${x}, ${y} (${describe(contour, style)})`);
        inside++;
      } else if (!samples.some((s) => inNib(point, s, style.shape, margin))) {
        assert.ok(
          !filled,
          `filled outside the nibs at ${x}, ${y} (${describe(contour, style)})`
        );
        outside++;
      }
    }
  }
  assert.ok(inside > 50 && outside > 50, `${inside} inside, ${outside} outside`);
}

test("a round nib draws what the offset method draws with round caps and joins", () => {
  for (const contour of [line, sCurve, hairpin, corner, sharpCorner]) {
    const byNib = strokeNibContour(contour, nib({ major: 80, minor: 80 })).contours;
    const byWidth = strokeOffsetContour(contour, {
      width: 80,
      cap: "round",
      join: "round",
      miterLimit: 4,
    }).contours;
    const box = bounds(byWidth);
    let checked = 0;
    for (let x = box.xMin - 5; x <= box.xMax + 5; x += 4) {
      for (let y = box.yMin - 5; y <= box.yMax + 5; y += 4) {
        const a = winding({ x, y }, byNib) !== 0;
        const b = winding({ x, y }, byWidth) !== 0;
        if (a !== b) {
          // Only where the edges are (within the fitting tolerance)
          const near = [-1, 1].some((dx) =>
            [-1, 1].some(
              (dy) =>
                (winding({ x: x + dx, y: y + dy }, byNib) !== 0) !== a ||
                (winding({ x: x + dx, y: y + dy }, byWidth) !== 0) !== b
            )
          );
          assert.ok(near, `the methods differ at ${x}, ${y}`);
        }
        checked++;
      }
    }
    assert.ok(checked > 500);
  }
});

test("a flat nib draws stems major·|cos(angle)| and bars major·|sin(angle)| thick", () => {
  for (const angle of [30, 45, 70, 120]) {
    const style = nib({ shape: "rect", major: 100, minor: 0, angle });
    const radians = (angle * Math.PI) / 180;
    // A stem: its thickness across, halfway up
    const stem = strokeNibContour(openContour(on(0, 0), on(0, 400)), style).contours;
    const across = filledRun(stem, (s) => ({ x: s, y: 200 }), -200, 200);
    assert.ok(
      Math.abs(across - 100 * Math.abs(Math.cos(radians))) < 0.6,
      `stem ${across}`
    );
    // A bar: its thickness up, halfway along
    const bar = strokeNibContour(openContour(on(0, 0), on(400, 0)), style).contours;
    const up = filledRun(bar, (s) => ({ x: 200, y: s }), -200, 200);
    assert.ok(Math.abs(up - 100 * Math.abs(Math.sin(radians))) < 0.6, `bar ${up}`);
  }
});

// The length of the filled part of a line through the outlines
function filledRun(contours, at, from, to, step = 0.25) {
  let filled = 0;
  for (let s = from; s <= to; s += step) {
    if (winding(at(s), contours) !== 0) {
      filled += step;
    }
  }
  return filled;
}

test("an elliptical nib covers its sweep, without holes, on curves, corners and ends", () => {
  for (const contour of [line, sCurve, hairpin, corner, sharpCorner]) {
    for (const style of [nib(), nib({ angle: 135 }), nib({ major: 160, minor: 10 })]) {
      const { contours } = strokeNibContour(contour, style);
      assertCoversNibs(contour, style, contours);
    }
  }
});

test("a rectangular nib covers its sweep, without holes, where its corner changes", () => {
  for (const contour of [line, sCurve, hairpin, corner, sharpCorner]) {
    for (const style of [
      nib({ shape: "rect" }),
      nib({ shape: "rect", angle: 0, major: 90, minor: 40 }),
      // Nearly flat: a flat nib covers no grid point on its own
      nib({ shape: "rect", minor: 6 }),
    ]) {
      const { contours } = strokeNibContour(contour, style);
      assertCoversNibs(contour, style, contours);
    }
  }
});

test("loops are covered by both nibs", () => {
  const square = loop(on(0, 0), on(300, 0), on(300, 300), on(0, 300));
  for (const contour of [circle(200), square]) {
    for (const style of [
      nib(),
      nib({ shape: "rect" }),
      nib({ shape: "rect", minor: 6 }),
    ]) {
      const { contours } = strokeNibContour(contour, style);
      assertCoversNibs(contour, style, contours, { step: 8 });
    }
  }
});

test("nib values of points change the nib along a curve", () => {
  const contour = openContour(
    { ...on(0, 0), values: { major: 40, angle: 170 } },
    off(100, 200),
    off(300, 200),
    { ...on(400, 0), values: { major: 160, angle: 10 } }
  );
  const style = nib({ minor: 20 });
  const { contours } = strokeNibContour(contour, style);
  assertCoversNibs(contour, style, contours);
  // The angle turns the short way, through 180°, not through 90°
  const samples = sampleNibs(contour, style, 10);
  assert.ok(samples.every((s) => s.angle >= 170 - 1e-9 && s.angle <= 190 + 1e-9));
});

test("a straight segment is the hull of the nibs at its ends, with straight edges", () => {
  const ends = [
    { major: 40, angle: 170 },
    { major: 160, angle: 10 },
  ];
  for (const shape of ["ellipse", "rect"]) {
    const style = nib({ shape, minor: 20 });
    const contour = openContour(
      { ...on(0, 0), values: ends[0] },
      { ...on(400, 0), values: ends[1] }
    );
    const { contours } = strokeNibContour(contour, style);
    // The band, then the nibs at the ends
    assert.ok(
      contours[0].points.every((p) => !p.type),
      shape
    );
    const hull = convexHull(
      contour.points.flatMap((point) => {
        const n = makeNib(point.values.major, 20, point.values.angle, 1);
        return flattenContour(
          shape === "rect" ? rectContour(point, n) : ellipseContour(point, n),
          64
        );
      })
    );
    const box = bounds(contours);
    let inside = 0;
    for (let x = box.xMin - 10; x <= box.xMax + 10; x += 4) {
      for (let y = box.yMin - 10; y <= box.yMax + 10; y += 4) {
        const depth = insideConvex({ x, y }, hull);
        const filled = winding({ x, y }, contours) !== 0;
        if (depth > 1) {
          assert.ok(filled, `${shape}: hole at ${x}, ${y}`);
          inside++;
        } else if (depth < -1) {
          assert.ok(!filled, `${shape}: filled outside at ${x}, ${y}`);
        }
      }
    }
    assert.ok(inside > 100);
  }
});

// How far a point is inside a counter-clockwise convex polygon (negative
// outside)
function insideConvex(point, polygon) {
  let depth = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length > 0) {
      const side =
        ((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)) / length;
      depth = Math.min(depth, side);
    }
  }
  return depth;
}

test("every contour of a nib stroke is counter-clockwise, except a ring's hole", () => {
  for (const contour of [line, sCurve, hairpin, corner, sharpCorner]) {
    for (const style of [nib(), nib({ shape: "rect" })]) {
      for (const outline of strokeNibContour(contour, style).contours) {
        assert.ok(signedArea(outline) > 0);
      }
    }
  }
});

test("a lone point is the nib", () => {
  const point = openContour(on(10, 20));
  const [ellipse] = strokeNibContour(point, nib({ angle: 0 })).contours;
  assert.deepEqual(bounds([ellipse]), { xMin: -50, yMin: 5, xMax: 70, yMax: 35 });
  const [rect] = strokeNibContour(point, nib({ shape: "rect", angle: 90 })).contours;
  const b = bounds([rect]);
  assert.ok(Math.abs(b.xMin + 5) < 1e-9 && Math.abs(b.yMax - 80) < 1e-9);
  assert.deepEqual(strokeNibContour(point, nib({ major: 0, minor: 0 })).contours, []);
});

test("a straight line with an unchanging nib has straight edges", () => {
  for (const shape of ["ellipse", "rect"]) {
    const { contours } = strokeNibContour(line, nib({ shape }));
    const band = contours[0];
    assert.equal(band.points.length, 4);
    assert.ok(band.points.every((p) => !p.type));
  }
});

test("sources with different nibs stroke compatibly", () => {
  for (const shape of ["ellipse", "rect"]) {
    for (const contour of [sCurve, hairpin, circle(150)]) {
      const styles = [
        nib({ shape, major: 60, minor: 20, angle: 20 }),
        nib({ shape, major: 220, minor: 60, angle: 100 }),
      ];
      const { results, compatible, problems } = strokeCompatibly(
        styles.map((style) => ({ contour, style }))
      );
      assert.deepEqual(problems, []);
      assert.ok(compatible);
      assert.equal(
        outlineSignature(results[0].contours),
        outlineSignature(results[1].contours)
      );
      // Each source keeps its own shape
      for (const [i, style] of styles.entries()) {
        assertCoversNibs(contour, style, results[i].contours, { step: 8 });
      }
    }
  }
});

test("a thin elliptical nib twists where the centerline turns along it", () => {
  const style = nib({ major: 160, minor: 10, angle: 0 });
  const { twists, contours } = strokeNibContour(hairpin, style);
  assert.ok(twists.length > 0);
  assertCoversNibs(hairpin, style, contours);
});

// Whether a closed polygon crosses itself (pieces of no length are skipped)
function crossesItself(polygon) {
  const pieces = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (Math.hypot(b.x - a.x, b.y - a.y) > 1e-6) {
      pieces.push([a, b]);
    }
  }
  const side = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 2; j < pieces.length; j++) {
      if (i === 0 && j === pieces.length - 1) {
        continue;
      }
      const [p, q] = pieces[i];
      const [r, s] = pieces[j];
      if (
        side(p, q, r) * side(p, q, s) < -1e-9 &&
        side(r, s, p) * side(r, s, q) < -1e-9
      ) {
        return true;
      }
    }
  }
  return false;
}

// A curve along which the nib turns from 135° to 45°: on its inner side, the
// edge runs backwards for a while, though the curve bends gently
const withValues = (point, values) => ({ ...point, values });
const turning = (angle) =>
  openContour(withValues(on(250, 0), { angle }), off(380, 0), on(400, 250));

test("where a turning nib's edge makes a loop, the loop is cut out", () => {
  const style = nib();
  const contour = turning(135);
  const { twists, contours } = strokeNibContour(contour, style);
  assert.deepEqual(twists, []);
  assert.equal(crossesItself(flattenContour(contours[0])), false);
  assertCoversNibs(contour, style, contours, { step: 4 });
});

test("a source whose edge makes a loop stays compatible with one whose does not", () => {
  const style = nib();
  const contours = [turning(135), turning(45)];
  const { results, compatible, problems } = strokeCompatibly(
    contours.map((contour) => ({ contour, style }))
  );
  assert.deepEqual(problems, []);
  assert.ok(compatible);
  assert.equal(
    outlineSignature(results[0].contours),
    outlineSignature(results[1].contours)
  );
  for (const [i, contour] of contours.entries()) {
    assert.equal(crossesItself(flattenContour(results[i].contours[0])), false);
    assertCoversNibs(contour, style, results[i].contours, { step: 6 });
  }
});

// The first point of the nib placed at the end of an open centerline (the
// last contour), from the end point
function endNibStart(contours, end) {
  const first = contours.at(-1).points[0];
  return { x: first.x - end.x, y: first.y - end.y };
}

test("the nibs placed at points start at the same end in all sources", () => {
  // 170° and 10° are 20° apart, through 180°
  const contour = sCurve;
  for (const shape of ["ellipse", "rect"]) {
    const { results } = strokeCompatibly(
      [170, 10].map((angle) => ({ contour, style: nib({ shape, angle }) }))
    );
    const [a, b] = results.map((result) => endNibStart(result.contours, on(400, 100)));
    // The same side of the end point, not the opposite one
    assert.ok(a.x * b.x + a.y * b.y > 0, `${shape}: ${JSON.stringify([a, b])}`);
  }
});

test("the nib turns the same way round in all sources as in the default one", () => {
  // From 135° to 45°, and from 150° (the short way: up to 225°) to 45°
  const sources = [turning(135), turning(150)];
  const style = nib();
  for (const referenceIndex of [0, 1]) {
    const { results } = strokeCompatibly(
      sources.map((contour) => ({ contour, style })),
      { referenceIndex }
    );
    const [a, b] = results.map((result) => endNibStart(result.contours, on(400, 250)));
    assert.ok(a.x * b.x + a.y * b.y > 0, `reference ${referenceIndex}`);
    // Each source keeps its own shape
    for (const [i, contour] of sources.entries()) {
      const reference = nibAngleReference(sources[referenceIndex], style);
      assertCoversNibs(contour, style, results[i].contours, {
        step: 6,
        reference,
      });
    }
  }
});

const fromCenterline = (point, values) => ({
  ...point,
  values: { ...values, angleBase: "centerline" },
});

test("a flat nib measured from the centerline draws major·|cos(angle)| in any direction", () => {
  for (const [dx, dy] of [
    [400, 0],
    [0, 400],
    [300, 300],
    [-200, 350],
  ]) {
    for (const angle of [0, 60]) {
      const contour = openContour(
        fromCenterline(on(0, 0), { angle }),
        fromCenterline(on(dx, dy), { angle })
      );
      const { contours } = strokeNibContour(
        contour,
        nib({ shape: "rect", major: 100, minor: 0 })
      );
      // Across the middle of the stroke, along its normal
      const length = Math.hypot(dx, dy);
      const normal = { x: -dy / length, y: dx / length };
      const middle = { x: dx / 2, y: dy / 2 };
      const across = filledRun(
        contours,
        (s) => ({ x: middle.x + normal.x * s, y: middle.y + normal.y * s }),
        -120,
        120
      );
      // 0° lies across the centerline: the whole nib
      const expected = 100 * Math.abs(Math.cos((angle * Math.PI) / 180));
      assert.ok(Math.abs(across - expected) < 0.6, `${dx},${dy} ${angle}°: ${across}`);
    }
  }
});

test("a nib measured from the centerline turns with it round a curve", () => {
  // An arch, its nib across the centerline: as thick as the nib is long
  const arch = openContour(
    fromCenterline(on(0, 0), { angle: 0 }),
    off(0, 300),
    off(400, 300),
    fromCenterline(on(400, 0), { angle: 0 })
  );
  const style = nib({ shape: "ellipse", major: 80, minor: 10 });
  const { contours } = strokeNibContour(arch, style);
  assertCoversNibs(arch, style, contours, { step: 6 });
  // At the top the stroke is upright: 80 high, where a nib from horizontal
  // (lying flat at 0°) would be only 10
  const top = filledRun(contours, (s) => ({ x: 200, y: s }), 150, 300);
  assert.ok(Math.abs(top - 80) < 2, `top ${top}`);
});

test("at a corner, a nib measured from the centerline is halfway between in and out", () => {
  const corner = openContour(
    on(0, 0),
    fromCenterline(on(200, 0), { angle: 0 }),
    on(200, 200)
  );
  const segments = centerlineSegments(corner);
  const { at } = nibAlong(corner, nib(), segments);
  // The same nib, a half turn apart
  const sameNib = (angle, expected) =>
    Math.abs(angle - expected - 180 * Math.round((angle - expected) / 180)) < 1e-9;
  // Both segments meet with the same nib at the corner: across the 45°
  // direction halfway between in and out
  assert.equal(at(0, 1).angle, at(1, 0).angle);
  assert.ok(sameNib(at(0, 1).angle, 135));
  // Points measured from horizontal keep their angle
  assert.ok(sameNib(at(0, 0).angle, 45));
  assert.ok(sameNib(at(1, 1).angle, 45));
});

test("between a point measured from horizontal and one from the centerline, the nib turns the short way", () => {
  // The frame turns from horizontal to across the centerline (to 135° at the
  // end, where the line goes at 45°): the nib itself goes from 0° to 120° the
  // short way (back by 60°), not forward by 120° through the direction of
  // the line
  const line = openContour(
    { ...on(0, 0), values: { angle: 0 } },
    off(100, 100),
    off(200, 200),
    fromCenterline(on(300, 300), { angle: -15 })
  );
  const segments = centerlineSegments(line);
  const { at } = nibAlong(line, nib(), segments);
  const start = at(0, 0).angle;
  const end = at(0, 1).angle;
  assert.ok(Math.abs(start) < 1e-9, `start ${start}`);
  assert.ok(Math.abs(end + 60) < 1e-6, `end ${end}`);
  for (let i = 0; i <= 32; i++) {
    const angle = at(0, i / 32).angle;
    assert.ok(angle <= 1e-9 && angle >= -60 - 1e-6, `${i / 32}: ${angle}`);
  }
});

test("from a point measured from the centerline where it turns back, the nib takes the short way round", () => {
  // The centerline comes up at about 60° and goes back down at about 240°:
  // the frame the segment after it goes through is a whole turn away from
  // the point's direction, and was counted from the point's
  const contour = openContour(
    on(700, 1200),
    off(760, 1280),
    off(817, 1316),
    fromCenterline(on(880, 1427), { angle: 90 }),
    off(597, 940),
    off(509, 399),
    on(488, 0)
  );
  const segments = centerlineSegments(contour);
  const { at } = nibAlong(contour, nib({ angle: 0 }), segments);
  const angles = [];
  for (let i = 0; i <= 32; i++) {
    angles.push(at(1, i / 32).angle);
  }
  const turned = Math.max(...angles) - Math.min(...angles);
  assert.ok(turned <= 90, `turned ${turned}°`);
});
