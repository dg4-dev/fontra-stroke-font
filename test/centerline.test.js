import assert from "node:assert/strict";
import { test } from "node:test";

import { centerlineSegments } from "../src/geometry/centerline.js";
import { off, on } from "./helpers.js";

const strip = (segments) =>
  segments.map(({ type, points }) => ({
    type,
    points: points.map(({ x, y }) => [x, y]),
  }));

test("lines and cubic curves of an open contour", () => {
  const segments = centerlineSegments({
    points: [on(0, 0), on(100, 0, true), off(150, 0), off(200, 50), on(200, 100)],
    isClosed: false,
  });
  assert.deepEqual(strip(segments), [
    {
      type: "line",
      points: [
        [0, 0],
        [100, 0],
      ],
    },
    {
      type: "cubic",
      points: [
        [100, 0],
        [150, 0],
        [200, 50],
        [200, 100],
      ],
    },
  ]);
  assert.deepEqual(
    segments.map((s) => [s.startIndex, s.endIndex, s.endSmooth]),
    [
      [0, 1, true],
      [1, 4, false],
    ]
  );
});

test("off-curve points before the first and after the last on-curve point are ignored", () => {
  const segments = centerlineSegments({
    points: [off(-50, 0), on(0, 0), on(100, 0), off(150, 0)],
    isClosed: false,
  });
  assert.deepEqual(strip(segments), [
    {
      type: "line",
      points: [
        [0, 0],
        [100, 0],
      ],
    },
  ]);
});

test("closed contours wrap around", () => {
  const segments = centerlineSegments({
    points: [on(0, 0), on(100, 0), on(100, 100)],
    isClosed: true,
  });
  assert.equal(segments.length, 3);
  assert.deepEqual(strip(segments)[2].points, [
    [100, 100],
    [0, 0],
  ]);
});

test("quadratic runs get implied on-curve points and become cubics", () => {
  const segments = centerlineSegments({
    points: [on(0, 0), off(0, 90, "quad"), off(90, 90, "quad"), on(90, 0)],
    isClosed: false,
  });
  assert.equal(segments.length, 2);
  // Implied point halfway between the two off-curve points
  assert.deepEqual(segments[0].points[3], { x: 45, y: 90 });
  assert.equal(segments[0].endSmooth, true);
  assert.equal(segments[0].endIndex, undefined);
  assert.equal(segments[1].startIndex, undefined);
  assert.equal(segments[1].endIndex, 3);
  // Exact degree elevation: control points at 2/3 towards the quad handle
  assert.deepEqual(segments[0].points[1], { x: 0, y: 60 });
  assert.deepEqual(segments[0].points[2], { x: 15, y: 90 });
});

test("a cubic segment with one off-curve point is quadratic", () => {
  const segments = centerlineSegments({
    points: [on(0, 0), off(0, 90), on(90, 90)],
    isClosed: false,
  });
  assert.deepEqual(strip(segments), [
    {
      type: "cubic",
      points: [
        [0, 0],
        [0, 60],
        [30, 90],
        [90, 90],
      ],
    },
  ]);
});

test("a cubic segment with more than two off-curve points uses the first and last", () => {
  const segments = centerlineSegments({
    points: [on(0, 0), off(0, 50), off(20, 80), off(50, 100), on(100, 100)],
    isClosed: false,
  });
  assert.deepEqual(strip(segments), [
    {
      type: "cubic",
      points: [
        [0, 0],
        [0, 50],
        [50, 100],
        [100, 100],
      ],
    },
  ]);
});

test("a closed contour without on-curve points is a quadratic blob", () => {
  const segments = centerlineSegments({
    points: [
      off(0, 0, "quad"),
      off(100, 0, "quad"),
      off(100, 100, "quad"),
      off(0, 100, "quad"),
    ],
    isClosed: true,
  });
  assert.equal(segments.length, 4);
  assert.deepEqual(segments[0].points[0], { x: 0, y: 50 });
  assert.deepEqual(segments.at(-1).points[3], { x: 0, y: 50 });
});

test("an open contour without on-curve points has no segments", () => {
  assert.deepEqual(
    centerlineSegments({
      points: [off(0, 0, "quad"), off(10, 0, "quad")],
      isClosed: false,
    }),
    []
  );
  assert.deepEqual(centerlineSegments({ points: [on(0, 0)], isClosed: false }), []);
});
