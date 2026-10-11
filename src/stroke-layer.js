// The visualization layer that fills the stroked shape of the open contours
// (centerlines) of the glyph being edited.

import { strokeStyleForGlyph } from "./current-source.js";
import { strokeOffsetContour } from "./geometry/offset.js";

export const LAYER_IDENTIFIER = "fontra-plugin.stroke-font.preview";

// Below Fontra's own path fill (500), path strokes (490, 500) and nodes (500),
// so that the centerline stays visible on top of the preview.
const LAYER_Z_INDEX = 480;

export function makeStrokeLayerDefinition() {
  return {
    identifier: LAYER_IDENTIFIER,
    name: "Stroke preview",
    selectionFunc: (visContext, layer) =>
      visContext.glyphsBySelectionMode?.editing || [],
    // Not user switchable through Fontra's own menu: that needs an action
    // registry entry, which plugins cannot reach. Visibility is driven by the
    // plugin's sidebar panel instead.
    userSwitchable: false,
    zIndex: LAYER_Z_INDEX,
    screenParameters: {},
    colors: { fillColor: "hsla(215, 90%, 45%, 0.3)" },
    colorsDarkMode: { fillColor: "hsla(215, 90%, 65%, 0.35)" },
    draw: ({ context, positionedGlyph, parameters, model }) => {
      const location = model?.getLocationForGlyph?.(positionedGlyph?.glyphName);
      drawStrokePreview(context, positionedGlyph, location, parameters.fillColor);
    },
  };
}

export function drawStrokePreview(context, positionedGlyph, location, fillColor) {
  const path = positionedGlyph?.glyph?.path;
  if (!path?.numContours) {
    return;
  }
  const style = strokeStyleForGlyph(positionedGlyph, location);
  if (!style) {
    return;
  }
  const outlines = strokeOpenContours(path, style);
  if (!outlines.length) {
    return;
  }
  context.beginPath();
  for (const contour of outlines) {
    appendContour(context, contour);
  }
  context.fillStyle = fillColor;
  // The bands, joins and caps overlap and all run counter-clockwise
  context.fill("nonzero");
}

/**
 * Stroked outlines of the open contours of a Fontra path.
 */
export function strokeOpenContours(path, style) {
  const outlines = [];
  for (let contourIndex = 0; contourIndex < path.numContours; contourIndex++) {
    if (path.contourInfo[contourIndex].isClosed) {
      continue;
    }
    let contour;
    try {
      contour = path.getUnpackedContour(contourIndex);
    } catch (e) {
      // A contour that is being drawn can be momentarily malformed; skip it
      // rather than break drawing.
      continue;
    }
    outlines.push(...strokeOffsetContour(contour, style).contours);
  }
  return outlines;
}

function appendContour(context, contour) {
  const points = contour.points;
  context.moveTo(points[0].x, points[0].y);
  let controls = [];
  for (let i = 1; i <= points.length; i++) {
    const point = points[i % points.length];
    if (point.type) {
      controls.push(point);
      continue;
    }
    if (controls.length === 2) {
      const [c1, c2] = controls;
      context.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, point.x, point.y);
    } else {
      context.lineTo(point.x, point.y);
    }
    controls = [];
  }
  context.closePath();
}
