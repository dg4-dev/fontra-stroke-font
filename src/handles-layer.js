// The visualization layer that draws the width handles of the glyph being
// edited: while the stroke width tool is selected, or with every tool when
// the setting asks for it.

import { widthHandles } from "./width-tool.js";

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
      if (!tool?.isActive && !settings?.get("handles")) {
        return;
      }
      const location = model?.getLocationForGlyph?.(positionedGlyph?.glyphName);
      drawHandles(context, widthHandles(positionedGlyph, location), parameters, tool);
    },
  };
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
    context.fillStyle = isActive ? parameters.hoverColor : parameters.handleColor;
    context.beginPath();
    context.arc(
      item.handle.x,
      item.handle.y,
      isActive ? parameters.hoverRadius : parameters.handleRadius,
      0,
      2 * Math.PI
    );
    context.fill();
  }
  // The value being dragged, next to its handle
  if (tool?.draggedHandle && tool.dragValue !== undefined) {
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
      context.fillText(String(Math.round(tool.dragValue * 10) / 10), 0, 0);
      context.restore();
    }
  }
}
