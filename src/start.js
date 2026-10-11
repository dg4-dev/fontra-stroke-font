// Fontra plugin entry point. Fontra imports this module and calls
// start(editor, pluginPath) once the glyph editor has been set up.

import { StrokeSettings } from "./settings.js";
import { LAYER_IDENTIFIER, makeStrokeLayerDefinition } from "./stroke-layer.js";

export function start(editor, pluginPath) {
  const visualizationLayers = editor.visualizationLayers;
  if (!visualizationLayers?.definitions) {
    console.error("[stroke-font] editor.visualizationLayers is not available");
    return;
  }

  const settings = new StrokeSettings();
  insertLayerDefinition(visualizationLayers.definitions, makeStrokeLayerDefinition());
  visualizationLayers.toggle(LAYER_IDENTIFIER, settings.get("visible"));

  settings.addListener((key, value) => {
    if (key === "visible") {
      visualizationLayers.toggle(LAYER_IDENTIFIER, value);
    }
    editor.canvasController.requestUpdate();
  });
  editor.canvasController.requestUpdate();
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
