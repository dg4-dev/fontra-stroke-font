// Fontra plugin entry point. Fontra imports this module and calls
// start(editor, pluginPath) once the glyph editor has been set up.

import { ComponentGlyphs } from "./glyph-strokes.js";
import {
  HANDLES_LAYER_IDENTIFIER,
  makeHandlesLayerDefinition,
} from "./handles-layer.js";
import { makeGlyphExpander, wrapGlyphLayers } from "./other-glyphs.js";
import { PANEL_IDENTIFIER, definePanelElement } from "./panel.js";
import { StrokeSettings } from "./settings.js";
import { t } from "./strings.js";
import { LAYER_IDENTIFIER, makeStrokeLayerDefinition } from "./stroke-layer.js";
import { StrokeWidthTool, TOOL_IDENTIFIER } from "./width-tool.js";

export function start(editor, pluginPath) {
  const visualizationLayers = editor.visualizationLayers;
  if (!visualizationLayers?.definitions) {
    console.error("[stroke-font] editor.visualizationLayers is not available");
    return;
  }

  const settings = new StrokeSettings();
  const componentGlyphs = new ComponentGlyphs(editor.fontController, () =>
    editor.canvasController.requestUpdate()
  );
  insertLayerDefinition(
    visualizationLayers.definitions,
    makeStrokeLayerDefinition({ settings, componentGlyphs })
  );
  visualizationLayers.toggle(LAYER_IDENTIFIER, settings.get("visible"));
  // The other glyphs of the text: Fontra's own layers draw them
  wrapGlyphLayers(
    visualizationLayers.definitions,
    makeGlyphExpander(settings, componentGlyphs)
  );
  const tool = new StrokeWidthTool(editor, `${pluginPath}/tool-icon.svg`);
  insertLayerDefinition(
    visualizationLayers.definitions,
    makeHandlesLayerDefinition({ tool, settings })
  );
  visualizationLayers.toggle(HANDLES_LAYER_IDENTIFIER, true);
  visualizationLayers.requestUpdate?.();

  settings.addListener((key, value) => {
    if (key === "visible") {
      visualizationLayers.toggle(LAYER_IDENTIFIER, value);
    }
    editor.canvasController.requestUpdate();
  });
  editor.canvasController.requestUpdate();

  addPanel(editor, settings, pluginPath);
  addTool(editor, tool);
}

function addTool(editor, tool) {
  if (typeof editor.addEditTool !== "function") {
    console.warn("[stroke-font] edit tools are not supported by this Fontra");
    return;
  }
  if (editor.tools?.[TOOL_IDENTIFIER]) {
    return;
  }
  try {
    editor.addEditTool(tool);
  } catch (e) {
    console.error("[stroke-font] could not add the stroke width tool", e);
    return;
  }
  // Fontra makes every new tool button look selected and fixes that when it
  // selects its first tool, which happened before plugins start. Fontra also
  // looks up the button's tooltip in its own translation table.
  const button = document.querySelector(
    `#edit-tools > .tool-button[data-tool="${TOOL_IDENTIFIER}"]`
  );
  if (button) {
    button.classList.toggle(
      "selected",
      editor.selectedToolIdentifier === TOOL_IDENTIFIER
    );
    button.setAttribute("title", t("tool.title"));
  }
}

function addPanel(editor, settings, pluginPath) {
  if (typeof editor.addSidebarPanel !== "function") {
    console.warn("[stroke-font] sidebar panels are not supported by this Fontra");
    return;
  }
  const PanelElement = definePanelElement();
  const panel = new PanelElement(editor, settings, `${pluginPath}/icon.svg`);
  try {
    editor.addSidebarPanel(panel, "right");
  } catch (e) {
    console.error("[stroke-font] could not add sidebar panel", e);
    return;
  }
  // Fontra looks up the tab tooltip in its own translation table, which does
  // not know about plugins; set it directly.
  const tab = document.querySelector(
    `.sidebar-tab[data-sidebar-name="${PANEL_IDENTIFIER}"]`
  );
  tab?.setAttribute("title", t("sidebar.tab"));
}

export function insertLayerDefinition(definitions, newLayerDef) {
  // Same ordering rule as Fontra's registerVisualizationLayerDefinition()
  const existingIndex = definitions.findIndex(
    (layerDef) => layerDef.identifier === newLayerDef.identifier
  );
  if (existingIndex >= 0) {
    definitions.splice(existingIndex, 1);
  }
  let index = 0;
  for (; index < definitions.length; index++) {
    if (newLayerDef.zIndex < definitions[index].zIndex) {
      break;
    }
  }
  definitions.splice(index, 0, newLayerDef);
}
