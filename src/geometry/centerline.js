// Splitting a centerline into segments. No Fontra or DOM dependencies.
//
// A contour is given in Fontra's "unpacked" form:
//   { points: [{ x, y, type?, smooth? }, ...], isClosed }
// where type is undefined for on-curve points and "quad" or "cubic" for
// off-curve points. The split follows Fontra's iterContourDecomposedSegments():
// - off-curve points before the first on-curve point of an open contour, and
//   after its last one, are ignored
// - a run of quadratic off-curve points gets implied on-curve points halfway
//   between them (TrueType)
// - a cubic segment with one off-curve point is a quadratic one; with more
//   than two, only the first and the last are used
// - a closed contour without on-curve points is a quadratic "blob"
//
// Quadratic segments are returned as their exact cubic equivalent, so the
// result only has "line" and "cubic" segments.
//
// An on-curve point with implied: true stands for an implied one (a rounded
// centerline writes them out, see corners.js): it has no index either.

import { quadToCubic } from "./bezier.js";

/**
 * @param {{points: object[], isClosed: boolean}} contour
 * @returns {{type: "line"|"cubic", points: {x: number, y: number}[],
 *   startIndex?: number, endIndex?: number, endSmooth: boolean}[]}
 *   startIndex / endIndex are the indices of the on-curve points at the ends
 *   of the segment (undefined for implied on-curve points). endSmooth tells
 *   whether the curve may be expected to continue smoothly into the next
 *   segment: the smooth flag of the end point, or true for an implied point.
 */
export function centerlineSegments(contour) {
  const points = contour.points;
  const numPoints = points.length;
  const firstOnCurve = points.findIndex((point) => !point.type);
  if (firstOnCurve < 0) {
    if (!contour.isClosed || !numPoints) {
      return [];
    }
    return quadBlobSegments(points);
  }

  const segments = [];
  const lastStep = contour.isClosed ? numPoints : numPoints - 1 - firstOnCurve;
  let indices = [firstOnCurve];
  let type = "line";
  for (let step = 1; step <= lastStep; step++) {
    const index = (firstOnCurve + step) % numPoints;
    indices.push(index);
    const pointType = points[index].type;
    if (!pointType) {
      segments.push(...decompose(type, indices, points));
      indices = [index];
      type = "line";
    } else {
      type = pointType;
    }
  }
  // Remaining indices after the last on-curve point are dangling off-curve
  // points of an open contour; Fontra ignores them as well.
  return segments;
}

function decompose(type, indices, points) {
  const coords = indices.map((index) => ({ x: points[index].x, y: points[index].y }));
  const own = (index) => (points[index].implied ? undefined : index);
  const startIndex = own(indices[0]);
  const endIndex = own(indices.at(-1));
  const endSmooth = !!points[indices.at(-1)].smooth;
  if (type === "line" || coords.length === 2) {
    return [{ type: "line", points: coords, startIndex, endIndex, endSmooth }];
  }
  if (type === "cubic" && coords.length >= 4) {
    return [
      {
        type: "cubic",
        points: [coords[0], coords[1], coords.at(-2), coords.at(-1)],
        startIndex,
        endIndex,
        endSmooth,
      },
    ];
  }
  // Quadratic, possibly with several off-curve points (or a cubic segment
  // with a single off-curve point)
  return quadSegments(coords, startIndex, endIndex, endSmooth);
}

function quadSegments(coords, startIndex, endIndex, endSmooth) {
  const segments = [];
  let start = coords[0];
  const last = coords.length - 1;
  for (let i = 1; i < last; i++) {
    const control = coords[i];
    const isLastControl = i === last - 1;
    const end = isLastControl
      ? coords[last]
      : { x: (control.x + coords[i + 1].x) / 2, y: (control.y + coords[i + 1].y) / 2 };
    segments.push({
      type: "cubic",
      points: quadToCubic(start, control, end),
      startIndex: i === 1 ? startIndex : undefined,
      endIndex: isLastControl ? endIndex : undefined,
      endSmooth: isLastControl ? endSmooth : true,
    });
    start = end;
  }
  return segments;
}

function quadBlobSegments(points) {
  const coords = points.map(({ x, y }) => ({ x, y }));
  const first = coords[0];
  const last = coords.at(-1);
  const mid = { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
  const segments = quadSegments([mid, ...coords, mid], undefined, undefined, true);
  return segments;
}
