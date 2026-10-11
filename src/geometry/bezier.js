// Small vector and Bézier helpers shared by the geometry modules.
// No Fontra or DOM dependencies.

export const EPSILON = 1e-9;

export function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a, s) {
  return { x: a.x * s, y: a.y * s };
}

export function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

export function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}

export function length(a) {
  return Math.hypot(a.x, a.y);
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function lerp(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function normalize(a) {
  const len = length(a);
  return len > EPSILON ? { x: a.x / len, y: a.y / len } : null;
}

/** Left normal of a unit vector: the vector turned 90° counter-clockwise. */
export function leftNormal(t) {
  return { x: -t.y, y: t.x };
}

/** Exact degree elevation of a quadratic Bézier to a cubic one. */
export function quadToCubic(p0, p1, p2) {
  return [p0, lerp(p0, p1, 2 / 3), lerp(p2, p1, 2 / 3), p2];
}

/**
 * Point on a "line" (2 points) or "cubic" (4 points) segment.
 */
export function pointAt(segment, t) {
  const p = segment.points;
  if (segment.type === "line") {
    return lerp(p[0], p[1], t);
  }
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * p[0].x + b * p[1].x + c * p[2].x + d * p[3].x,
    y: a * p[0].y + b * p[1].y + c * p[2].y + d * p[3].y,
  };
}

/**
 * First derivative of a "line" or "cubic" segment.
 */
export function derivativeAt(segment, t) {
  const p = segment.points;
  if (segment.type === "line") {
    return sub(p[1], p[0]);
  }
  const mt = 1 - t;
  return {
    x:
      3 *
      (mt * mt * (p[1].x - p[0].x) +
        2 * mt * t * (p[2].x - p[1].x) +
        t * t * (p[3].x - p[2].x)),
    y:
      3 *
      (mt * mt * (p[1].y - p[0].y) +
        2 * mt * t * (p[2].y - p[1].y) +
        t * t * (p[3].y - p[2].y)),
  };
}

/**
 * Unit tangent at the start of a segment. When the first handle is retracted
 * onto the on-curve point, the direction to the next distinct control point
 * is the limit of the tangent. Returns null for a segment of zero length.
 */
export function startTangent(segment) {
  const [p0, ...rest] = segment.points;
  for (const p of rest) {
    const t = normalize(sub(p, p0));
    if (t) {
      return t;
    }
  }
  return null;
}

/** Unit tangent at the end of a segment; see startTangent(). */
export function endTangent(segment) {
  const points = segment.points;
  const last = points.at(-1);
  for (let i = points.length - 2; i >= 0; i--) {
    const t = normalize(sub(last, points[i]));
    if (t) {
      return t;
    }
  }
  return null;
}

/** Unit tangent anywhere on a segment, with the end point limits. */
export function tangentAt(segment, t) {
  const d = normalize(derivativeAt(segment, t));
  if (d) {
    return d;
  }
  if (t <= 0) {
    return startTangent(segment);
  }
  if (t >= 1) {
    return endTangent(segment);
  }
  // A cusp inside the segment: take the tangent just after it
  return (
    normalize(derivativeAt(segment, Math.min(1, t + 1e-4))) ||
    normalize(derivativeAt(segment, Math.max(0, t - 1e-4))) ||
    startTangent(segment)
  );
}

export function isDegenerateSegment(segment) {
  const [p0, ...rest] = segment.points;
  return rest.every((p) => distance(p, p0) <= EPSILON);
}

/** Second derivative of a "line" or "cubic" segment. */
export function secondDerivativeAt(segment, t) {
  if (segment.type === "line") {
    return { x: 0, y: 0 };
  }
  const [p0, p1, p2, p3] = segment.points;
  const mt = 1 - t;
  return {
    x: 6 * (mt * (p2.x - 2 * p1.x + p0.x) + t * (p3.x - 2 * p2.x + p1.x)),
    y: 6 * (mt * (p2.y - 2 * p1.y + p0.y) + t * (p3.y - 2 * p2.y + p1.y)),
  };
}

/**
 * Signed curvature: positive where the curve turns left (counter-clockwise).
 * Where the first derivative vanishes (a handle retracted onto its point),
 * the curvature just inside the segment is used.
 */
export function curvatureAt(segment, t) {
  for (const u of [t, Math.min(1, t + 1e-4), Math.max(0, t - 1e-4)]) {
    const d1 = derivativeAt(segment, u);
    const speedSquared = d1.x * d1.x + d1.y * d1.y;
    if (speedSquared > EPSILON) {
      const d2 = secondDerivativeAt(segment, u);
      return cross(d1, d2) / (speedSquared * Math.sqrt(speedSquared));
    }
  }
  return 0;
}

/**
 * Intersection of the lines through p with direction u and through q with
 * direction v, or null when they are (nearly) parallel.
 */
export function lineIntersection(p, u, q, v) {
  const denominator = cross(u, v);
  if (Math.abs(denominator) < 1e-9) {
    return null;
  }
  const s = cross(sub(q, p), v) / denominator;
  return add(p, scale(u, s));
}
