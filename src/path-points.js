// Reading the points of Fontra paths (VarPackedPath): which contour each
// point is in, whether it is on the curve, and its identifier.

const POINT_TYPE_MASK = 0x07;
const ON_CURVE = 0x00;

/**
 * @param {object} path a Fontra VarPackedPath
 * @returns {{identifier: string|undefined, onCurve: boolean, pointIndex: number}[][]}
 *   per contour, its points; pointIndex is the index in the whole path
 */
export function pathPoints(path) {
  const contours = [];
  let start = 0;
  for (const contour of path?.contourInfo ?? []) {
    const points = [];
    for (let i = start; i <= contour.endPoint; i++) {
      points.push({
        identifier: path.pointAttributes?.[i]?.identifier,
        onCurve: isOnCurveType(path.pointTypes[i]),
        pointIndex: i,
      });
    }
    contours.push(points);
    start = contour.endPoint + 1;
  }
  return contours;
}

function isOnCurveType(pointType) {
  return (pointType & POINT_TYPE_MASK) === ON_CURVE;
}

/**
 * The contour of a point of a path, and the point's index in it.
 * @returns {{contourIndex: number, contourPointIndex: number}|undefined}
 */
export function locatePoint(path, pointIndex) {
  let start = 0;
  for (const [contourIndex, contour] of (path?.contourInfo ?? []).entries()) {
    if (pointIndex <= contour.endPoint) {
      return pointIndex >= start
        ? { contourIndex, contourPointIndex: pointIndex - start }
        : undefined;
    }
    start = contour.endPoint + 1;
  }
  return undefined;
}

/**
 * Whether two paths have the same contours with the same numbers of points,
 * so that their points correspond by index.
 */
export function samePointStructure(a, b) {
  const infoA = a?.contourInfo ?? [];
  const infoB = b?.contourInfo ?? [];
  return (
    infoA.length === infoB.length &&
    infoA.every(
      (contour, i) =>
        contour.endPoint === infoB[i].endPoint && contour.isClosed === infoB[i].isClosed
    )
  );
}

/**
 * Whether a path starts with the contours of another, with the same numbers
 * of points: a component's flattened path starts with the contours of its
 * glyph, followed by those of nested components.
 */
export function startsWithPointStructure(path, start) {
  const info = path?.contourInfo ?? [];
  const startInfo = start?.contourInfo ?? [];
  return (
    startInfo.length <= info.length &&
    startInfo.every(
      (contour, i) =>
        contour.endPoint === info[i].endPoint && contour.isClosed === info[i].isClosed
    )
  );
}
