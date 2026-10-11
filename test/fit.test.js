import assert from "node:assert/strict";
import { test } from "node:test";

import { pointAt } from "../src/geometry/bezier.js";
import { fitCubic } from "../src/geometry/fit.js";

test("a cubic is fitted back exactly from its own samples", () => {
  const original = {
    type: "cubic",
    points: [
      { x: 0, y: 0 },
      { x: 30, y: 80 },
      { x: 120, y: 90 },
      { x: 150, y: 10 },
    ],
  };
  const [p0, p1, p2, p3] = original.points;
  const norm = (v) => {
    const l = Math.hypot(v.x, v.y);
    return { x: v.x / l, y: v.y / l };
  };
  const samples = [];
  for (let i = 1; i < 8; i++) {
    samples.push({ u: i / 8, ...pointAt(original, i / 8) });
  }
  const t0 = norm({ x: p1.x - p0.x, y: p1.y - p0.y });
  const t3 = norm({ x: p3.x - p2.x, y: p3.y - p2.y });
  const { points, error } = fitCubic(p0, t0, p3, t3, samples);
  assert.ok(error < 1e-6, `error ${error}`);
  for (const [i, p] of points.entries()) {
    assert.ok(
      Math.hypot(p.x - original.points[i].x, p.y - original.points[i].y) < 1e-6
    );
  }
});

test("a quarter circle is fitted within a small error", () => {
  const r = 500;
  const samples = [];
  for (let i = 1; i < 8; i++) {
    const a = ((Math.PI / 2) * i) / 8;
    samples.push({ u: i / 8, x: r * Math.cos(a), y: r * Math.sin(a) });
  }
  const { error } = fitCubic(
    { x: r, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: r },
    { x: -1, y: 0 },
    samples
  );
  // The best single-cubic quarter circle is off by about 0.03% of the radius
  assert.ok(error < r * 0.0005, `error ${error}`);
});
