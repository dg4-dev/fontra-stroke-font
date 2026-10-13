// The visualization layer that draws the handles of the glyph being edited:
// while the stroke width tool is selected, or with every tool when the
// setting asks for it. In a glyph of the nib method, it also draws the nib
// of each point, with the tool or when the setting asks for it.

import { KNOB_DISTANCE } from "./nib-handles.js";
import { glyphHandles } from "./width-tool.js";

export const HANDLES_LAYER_IDENTIFIER = "fontra-plugin.stroke-font.width-handles";

// Above Fontra's nodes (500), so the handles can be seen and grabbed
const LAYER_Z_INDEX = 600;

/**
 * @param {{tool: object, settings: object}} options the width tool (for
 *   whether it is active, and the hovered and dragged handles) and the
 *   display settings
 */
export function makeHandlesLayerDefinition({ tool, settings }) {
  return {
    identifier: HANDLES_LAYER_IDENTIFIER,
    name: "Stroke width handles",
    selectionFunc: (visContext, layer) =>
      visContext.glyphsBySelectionMode?.editing || [],
    userSwitchable: false,
    zIndex: LAYER_Z_INDEX,
    screenParameters: {
      handleRadius: 3.5,
      hoverRadius: 5.5,
      lineWidth: 1,
      fontSize: 11,
      labelOffset: 10,
      // Scaled to glyph units like the others, it tells how big a pixel is
      knobDistance: KNOB_DISTANCE,
    },
    colors: {
      handleColor: "hsl(215, 90%, 45%)",
      lineColor: "hsla(215, 90%, 45%, 0.5)",
      hoverColor: "hsl(25, 95%, 50%)",
      labelColor: "hsl(215, 30%, 20%)",
    },
    colorsDarkMode: {
      handleColor: "hsl(215, 90%, 68%)",
      lineColor: "hsla(215, 90%, 68%, 0.5)",
      hoverColor: "hsl(25, 95%, 60%)",
      labelColor: "hsl(215, 30%, 90%)",
    },
    draw: ({ context, positionedGlyph, parameters, model }) => {
      const showHandles = tool?.isActive || settings?.get("handles");
      const showNibs = tool?.isActive || settings?.get("nibs");
      if (!showHandles && !showNibs) {
        return;
      }
      const location = model?.getLocationForGlyph?.(positionedGlyph?.glyphName);
      const { handles, nibs } = glyphHandles(
        positionedGlyph,
        location,
        (parameters.knobDistance ?? KNOB_DISTANCE) / KNOB_DISTANCE
      );
      if (nibs && showNibs) {
        drawNibs(context, nibs, parameters);
      }
      if (showHandles) {
        drawHandles(context, handles, parameters, tool);
      }
    },
  };
}

/** The outline of the nib of each point. */
export function drawNibs(context, nibs, parameters) {
  context.lineWidth = parameters.lineWidth;
  context.strokeStyle = parameters.lineColor;
  context.beginPath();
  for (const { contour } of nibs) {
    const points = contour.points;
    context.moveTo(points[0].x, points[0].y);
    for (let i = 1; i <= points.length; i++) {
      const point = points[i % points.length];
      if (point.type) {
        const next = points[(i + 1) % points.length];
        const end = points[(i + 2) % points.length];
        context.bezierCurveTo(point.x, point.y, next.x, next.y, end.x, end.y);
        i += 2;
      } else {
        context.lineTo(point.x, point.y);
      }
    }
    context.closePath();
  }
  context.stroke();
}

export function drawHandles(context, handles, parameters, tool) {
  const active =
    tool?.draggedHandle ?? (tool?.isActive ? tool.hoveredHandle : undefined);
  context.lineWidth = parameters.lineWidth;
  context.strokeStyle = parameters.lineColor;
  context.beginPath();
  for (const { anchor, handle } of handles) {
    context.moveTo(anchor.x, anchor.y);
    context.lineTo(handle.x, handle.y);
  }
  context.stroke();
  for (const item of handles) {
    const isActive =
      item.pointIndex === active?.pointIndex && item.side === active?.side;
    const color = isActive ? parameters.hoverColor : parameters.handleColor;
    const radius = isActive ? parameters.hoverRadius : parameters.handleRadius;
    context.beginPath();
    context.arc(item.handle.x, item.handle.y, radius, 0, 2 * Math.PI);
    if (item.axis === "rotate") {
      // The turning knob is a ring, unlike the handles that size the nib
      context.strokeStyle = color;
      context.lineWidth = parameters.lineWidth * 1.5;
      context.stroke();
    } else {
      context.fillStyle = color;
      context.fill();
    }
  }
  // The value being dragged, next to its handle
  if (tool?.draggedHandle && tool.dragLabel !== undefined) {
    const item = handles.find(
      (h) =>
        h.pointIndex === tool.draggedHandle.pointIndex &&
        h.side === tool.draggedHandle.side
    );
    if (item) {
      const x = item.handle.x + item.normal.x * parameters.labelOffset;
      const y = item.handle.y + item.normal.y * parameters.labelOffset;
      context.save();
      context.translate(x, y);
      // Glyph coordinates are y-up; text is drawn y-down
      context.scale(1, -1);
      context.fillStyle = parameters.labelColor;
      context.font = `${parameters.fontSize}px fontra-ui-regular, sans-serif`;
      context.textAlign =
        item.normal.x < -0.3 ? "right" : item.normal.x > 0.3 ? "left" : "center";
      context.textBaseline = "middle";
      context.fillText(tool.dragLabel, 0, 0);
      context.restore();
    }
  }
}
