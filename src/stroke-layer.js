// The visualization layer that shows the stroked shape of the open contours
// (centerlines) of the glyph being edited.

import { strokeGlyph } from "./glyph-strokes.js";

export const LAYER_IDENTIFIER = "fontra-plugin.stroke-font.preview";

// Below Fontra's own path fill (500), path strokes (490, 500) and nodes (500),
// so that the centerline stays visible on top of the preview.
const LAYER_Z_INDEX = 480;

/**
 * @param {object} [options]
 * @param {object} [options.settings] display settings (see settings.js)
 * @param {object} [options.componentGlyphs] see glyph-strokes.js
 */
export function makeStrokeLayerDefinition({ settings, componentGlyphs } = {}) {
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
    // Sizes in screen pixels; Fontra converts them to glyph units
    screenParameters: { markerRadius: 7, markerWidth: 2, outlineWidth: 1.5 },
    // Gray, like the glyph's own filled outlines, so that the handles and
    // the nibs (see handles-layer.js) stand out from it
    colors: {
      fillColor: "hsl(0, 0%, 15%)",
      outlineColor: "hsl(0, 0%, 25%)",
      twistColor: "hsla(5, 90%, 50%, 0.9)",
    },
    colorsDarkMode: {
      fillColor: "hsl(0, 0%, 88%)",
      outlineColor: "hsl(0, 0%, 80%)",
      twistColor: "hsla(5, 90%, 62%, 0.9)",
    },
    draw: ({ context, positionedGlyph, parameters, model }) => {
      const location = model?.getLocationForGlyph?.(positionedGlyph?.glyphName);
      drawStrokePreview(context, positionedGlyph, location, parameters, {
        outlineOnly: settings?.get("outlineOnly") ?? false,
        fillOpacity: settings?.get("fillOpacity") ?? 0.3,
        componentGlyphs,
      });
    },
  };
}

export function drawStrokePreview(
  context,
  positionedGlyph,
  location,
  parameters,
  { outlineOnly = false, fillOpacity = 0.3, componentGlyphs } = {}
) {
  const { outlines, twists } = strokeGlyph(positionedGlyph, location, componentGlyphs);
  if (outlines.length) {
    if (outlineOnly) {
      drawOutline(context, outlines, parameters.outlineColor, parameters.outlineWidth);
    } else {
      context.globalAlpha = fillOpacity;
      context.fillStyle = parameters.fillColor;
      // The bands, joins and caps overlap and all run counter-clockwise
      fillPath(context, outlinesToPath(outlines, context));
      context.globalAlpha = 1;
    }
  }
  // Rings where the stroke twists (bends more sharply than half the width)
  if (twists.length) {
    context.strokeStyle = parameters.twistColor;
    context.lineWidth = parameters.markerWidth;
    for (const { point } of twists) {
      context.beginPath();
      context.arc(point.x, point.y, parameters.markerRadius, 0, 2 * Math.PI);
      context.stroke();
    }
  }
}

let scratchCanvas = null;

/**
 * Draw only the outer edge of overlapping outlines: the edges where outlines
 * overlap would otherwise show as lines inside the shape. The outlines are
 * stroked twice as wide on a scratch canvas, the filled shape is erased from
 * it, and what is left (the outer half of the stroke) is copied over.
 */
export function drawOutline(context, outlines, color, width) {
  const path = outlinesToPath(outlines, context);
  const canvas = context.canvas;
  if (
    typeof OffscreenCanvas !== "function" ||
    !canvas?.width ||
    !context.getTransform
  ) {
    // No scratch canvas: stroke every outline, inner edges included
    context.strokeStyle = color;
    context.lineWidth = width;
    if (path) {
      context.stroke(path);
    } else {
      context.stroke();
    }
    return;
  }
  if (
    !scratchCanvas ||
    scratchCanvas.width !== canvas.width ||
    scratchCanvas.height !== canvas.height
  ) {
    scratchCanvas = new OffscreenCanvas(canvas.width, canvas.height);
  }
  const scratch = scratchCanvas.getContext("2d");
  scratch.setTransform(1, 0, 0, 1, 0, 0);
  scratch.clearRect(0, 0, canvas.width, canvas.height);
  scratch.setTransform(context.getTransform());
  scratch.lineJoin = "round";
  scratch.strokeStyle = color;
  scratch.lineWidth = width * 2;
  scratch.stroke(path);
  scratch.globalCompositeOperation = "destination-out";
  scratch.fill(path, "nonzero");
  scratch.globalCompositeOperation = "source-over";
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.drawImage(scratchCanvas, 0, 0);
  context.restore();
}

function fillPath(context, path) {
  if (path) {
    context.fill(path, "nonzero");
  } else {
    context.fill("nonzero");
  }
}

/**
 * The outlines as a Path2D (or, where Path2D is missing, as the current path
 * of the context, which is then returned as undefined).
 */
export function outlinesToPath(outlines, context) {
  const path = typeof Path2D === "function" ? new Path2D() : null;
  const target = path ?? context;
  if (!path) {
    context.beginPath();
  }
  for (const contour of outlines) {
    appendContour(target, contour);
  }
  return path ?? undefined;
}

/** Add a closed unpacked contour to a Path2D or a canvas context. */
export function appendContour(target, contour) {
  const points = contour.points;
  target.moveTo(points[0].x, points[0].y);
  let controls = [];
  for (let i = 1; i <= points.length; i++) {
    const point = points[i % points.length];
    if (point.type) {
      controls.push(point);
      continue;
    }
    if (controls.length === 2) {
      const [c1, c2] = controls;
      target.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, point.x, point.y);
    } else {
      target.lineTo(point.x, point.y);
    }
    controls = [];
  }
  target.closePath();
}
