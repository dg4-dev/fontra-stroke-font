import assert from "node:assert/strict";
import { test } from "node:test";

import {
  mergePieceCounts,
  mergeZones,
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

test("zones are merged by side and order", () => {
  const band = { kind: "band", pieces: 1 };
  const zone = (side, parts = 1) => ({
    kind: "zone",
    side,
    parts: Array.from({ length: parts }, () => ({ outer: 1, inner: 1 })),
  });
  const merged = mergeZones([
    { segments: [{ spans: [band, zone("left"), band] }] },
    { segments: [{ spans: [band, zone("left", 2), band, zone("right"), band] }] },
  ]);
  assert.deepEqual(
    merged.segments[0].spans.map((span) => span.kind + (span.side ?? "")),
    ["band", "zoneleft", "band", "zoneright", "band"]
  );
  assert.equal(merged.segments[0].spans[1].parts.length, 2);
  const problems = [];
  assert.equal(
    mergeZones(
      [
        { segments: [{ spans: [band, zone("left"), band, zone("right"), band] }] },
        { segments: [{ spans: [band, zone("right"), band, zone("left"), band] }] },
      ],
      problems
    ),
    null
  );
  assert.equal(problems.length, 1);
});

test("piece counts are merged by taking the largest", () => {
  const merged = mergePieceCounts([
    { segments: [{ spans: [{ kind: "band", pieces: 2 }] }, null] },
    { segments: [{ spans: [{ kind: "band", pieces: 5 }] }, null] },
  ]);
  assert.equal(merged.segments[0].spans[0].pieces, 5);
  assert.equal(
    mergePieceCounts([
      { segments: [{ spans: [{ kind: "band", pieces: 2 }] }] },
      { segments: [null] },
    ]),
    null
  );
});
