// Fontra plugin entry point. Fontra imports this module and calls
// start(editor, pluginPath) once the glyph editor has been set up.

import { ComponentGlyphs, strokeGlyph } from "./glyph-strokes.js";
import {
  HANDLES_LAYER_IDENTIFIER,
  makeHandlesLayerDefinition,
} from "./handles-layer.js";
import { makeGlyphExpander, makeStrokedTest, wrapGlyphLayers } from "./other-glyphs.js";
import { widenComponentHitAreas, widenHitAreas } from "./hit-areas.js";
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
  // Glyphs of components load later; their glyphs' strokes then change
  let widenAll = () => {};
  const componentGlyphs = new ComponentGlyphs(editor.fontController, () => {
    widenAll();
    editor.canvasController.requestUpdate();
  });
  insertLayerDefinition(
    visualizationLayers.definitions,
    makeStrokeLayerDefinition({ settings, componentGlyphs })
  );
  visualizationLayers.toggle(LAYER_IDENTIFIER, settings.get("visible"));
  // The other glyphs of the text: Fontra's own layers draw them
  wrapGlyphLayers(
    visualizationLayers.definitions,
    makeGlyphExpander(settings, componentGlyphs),
    makeStrokedTest(settings, componentGlyphs)
  );
  const tool = new StrokeWidthTool(editor, `${pluginPath}/tool-icon.svg`);
  insertLayerDefinition(
    visualizationLayers.definitions,
    makeHandlesLayerDefinition({ tool, settings })
  );
  visualizationLayers.toggle(HANDLES_LAYER_IDENTIFIER, true);
  visualizationLayers.requestUpdate?.();

  // Make the glyphs of the text clickable by their stroked shapes
  const sceneModel = editor.sceneController?.sceneModel;
  const sceneSettingsController = editor.sceneController?.sceneSettingsController;
  widenAll = () =>
    widenHitAreas(
      sceneModel?.positionedLines,
      (item) =>
        strokeGlyph(
          item,
          sceneModel.getLocationForGlyph?.(item.glyphName),
          componentGlyphs
        ).outlines,
      componentGlyphs
    );
  sceneSettingsController?.addKeyListener?.("positionedLines", () => widenAll());
  widenAll();
  // Make the components of the glyph being edited clickable by their strokes
  wrapComponentHitTest(sceneModel, componentGlyphs);

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

// Fontra finds the component under the pointer with
// sceneModel.componentSelectionAtPoint(); before it does, the components of
// the glyph being edited get the hit areas of their strokes (see hit-areas.js)
function wrapComponentHitTest(sceneModel, componentGlyphs) {
  const original = sceneModel?.componentSelectionAtPoint;
  if (typeof original !== "function" || original.strokeFontWrapped) {
    return;
  }
  const wrapped = function (...args) {
    try {
      const positionedGlyph = this.getSelectedPositionedGlyph?.();
      if (positionedGlyph?.glyph?.components?.length) {
        widenComponentHitAreas(
          positionedGlyph.glyph,
          strokeGlyph(
            positionedGlyph,
            this.getLocationForGlyph?.(positionedGlyph.glyphName),
            componentGlyphs
          )
        );
      }
    } catch (e) {
      console.error("[stroke-font] could not stroke the components", e);
    }
    return original.apply(this, args);
  };
  wrapped.strokeFontWrapped = true;
  sceneModel.componentSelectionAtPoint = wrapped;
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
