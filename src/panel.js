// The sidebar panel: preview visibility and the stroke values of the source
// being edited.

import { describeStrokeSource } from "./current-source.js";
import {
  CAPS,
  JOINS,
  MIN_MITER_LIMIT,
  sanitizeOffsetValue,
  setSourceDefaults,
} from "./stroke-data.js";
import { t } from "./strings.js";

export const PANEL_IDENTIFIER = "stroke-font";
const ELEMENT_NAME = "fontra-stroke-font-panel";

const styles = `
  :host {
    display: block;
    height: 100%;
    overflow: hidden auto;
    color: var(--ui-element-foreground-color, inherit);
    font-family: fontra-ui-regular, sans-serif;
  }
  .panel {
    display: flex;
    flex-direction: column;
    gap: 0.9em;
    padding: 1em;
  }
  .title {
    font-weight: bold;
  }
  .row {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.4em;
    align-items: center;
  }
  .fields {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.5em 0.8em;
    align-items: center;
  }
  .fields[aria-disabled="true"] label {
    opacity: 0.5;
  }
  input[type="number"],
  select {
    width: 100%;
    box-sizing: border-box;
    padding: 0.2em 0.4em;
    border-radius: 0.25em;
    border: 0.5px solid var(--horizontal-rule-color, #8884);
    background-color: var(--text-input-background-color, #fff);
    color: var(--text-input-foreground-color, inherit);
    font: inherit;
  }
  input:disabled,
  select:disabled {
    opacity: 0.5;
  }
  hr {
    width: 100%;
    border: none;
    border-top: 1px solid var(--horizontal-rule-color, #8884);
    margin: 0;
  }
  .source {
    font-weight: bold;
    overflow-wrap: anywhere;
  }
  .hint,
  .note {
    opacity: 0.7;
    font-size: 0.9em;
    line-height: 1.4;
  }
  .note:empty {
    display: none;
  }
`;

export function definePanelElement() {
  const existing = customElements.get(ELEMENT_NAME);
  if (existing) {
    return existing;
  }

  class StrokeFontPanel extends HTMLElement {
    constructor(editor, settings, iconPath) {
      super();
      this.identifier = PANEL_IDENTIFIER;
      this.iconPath = iconPath;
      this.editor = editor;
      this.sceneController = editor.sceneController;
      this.settings = settings;
      this._state = null;
      this.attachShadow({ mode: "open" });
      this._render();

      settings.addListener(() => this._syncSettings());
      const scheduleUpdate = () => this._scheduleUpdate();
      this.sceneController.sceneSettingsController?.addKeyListener(
        ["selectedGlyphName", "selectedGlyph", "positionedLines"],
        scheduleUpdate
      );
      this.sceneController.addCurrentGlyphChangeListener?.(scheduleUpdate);
      this.update();
    }

    // Called by Fontra when the sidebar tab is opened/closed
    async toggle(on, focus) {
      if (on) {
        this.update();
      }
    }

    _scheduleUpdate() {
      if (this._updateScheduled) {
        return;
      }
      this._updateScheduled = true;
      setTimeout(() => {
        this._updateScheduled = false;
        this.update();
      }, 50);
    }

    update() {
      const sceneModel = this.sceneController.sceneModel;
      const positionedGlyph = sceneModel?.getSelectedPositionedGlyph?.();
      const location = positionedGlyph
        ? sceneModel.getLocationForGlyph?.(positionedGlyph.glyphName)
        : undefined;
      this._state = describeStrokeSource(positionedGlyph, location);
      this._syncValues();
    }

    _render() {
      const root = this.shadowRoot;
      root.innerHTML = "";
      const style = document.createElement("style");
      style.textContent = styles;
      root.appendChild(style);

      this._sourceLabel = el("div", { class: "source" });
      this._note = el("div", { class: "note" });
      this._fields = el(
        "div",
        { class: "fields" },
        ...this._numberField("width", t("field.width"), { min: 0, step: 1 }),
        ...this._selectField("cap", t("field.cap"), CAPS, "cap"),
        ...this._selectField("join", t("field.join"), JOINS, "join"),
        ...this._numberField("miterLimit", t("field.miterLimit"), {
          min: MIN_MITER_LIMIT,
          step: 0.1,
        })
      );

      const panel = el(
        "div",
        { class: "panel" },
        el("div", { class: "title" }, t("panel.title")),
        this._checkbox("visible", t("setting.visible")),
        el("hr"),
        this._sourceLabel,
        this._note,
        this._fields,
        el("hr"),
        el("div", { class: "hint" }, t("panel.hint"))
      );
      root.appendChild(panel);
      this._syncSettings();
      this._syncValues();
    }

    _checkbox(key, label) {
      const id = `stroke-font-${key}`;
      const input = el("input", {
        "type": "checkbox",
        id,
        "data-setting": key,
        "onchange": (event) => this.settings.set(key, event.target.checked),
      });
      return el("div", { class: "row" }, input, el("label", { for: id }, label));
    }

    _numberField(key, label, { min, step }) {
      const id = `stroke-font-${key}`;
      const input = el("input", {
        "type": "number",
        id,
        min,
        step,
        "data-key": key,
        // "change" fires on Enter or when leaving the field, so that typing a
        // number makes one undo step rather than one per keystroke
        "onchange": (event) => this._changeValue(key, event.target.value),
      });
      return [el("label", { for: id }, label), input];
    }

    _selectField(key, label, choices, stringPrefix) {
      const id = `stroke-font-${key}`;
      const select = el("select", {
        id,
        "data-key": key,
        "onchange": (event) => this._changeValue(key, event.target.value),
      });
      for (const choice of choices) {
        select.append(el("option", { value: choice }, t(`${stringPrefix}.${choice}`)));
      }
      return [el("label", { for: id }, label), select];
    }

    _syncSettings() {
      for (const input of this.shadowRoot.querySelectorAll("input[data-setting]")) {
        input.checked = !!this.settings.get(input.dataset.setting);
      }
    }

    _syncValues() {
      if (!this._fields) {
        return;
      }
      const state = this._state;
      const editable = !!state?.atSource && state.method === "offset";
      if (!state) {
        this._sourceLabel.textContent = t("source.noGlyph");
        this._note.textContent = "";
      } else {
        this._sourceLabel.textContent = t("source.current", state.sourceName);
        this._note.textContent =
          state.method !== "offset"
            ? t("source.nibGlyph")
            : state.atSource
              ? ""
              : t("source.notAtSource", state.sourceName);
      }
      this._fields.setAttribute("aria-disabled", String(!editable));
      for (const input of this._fields.querySelectorAll("[data-key]")) {
        const key = input.dataset.key;
        const value = state ? state.style[key] : "";
        // Leave a field alone while it is being typed into
        if (this.shadowRoot.activeElement !== input && input.value !== String(value)) {
          input.value = String(value);
        }
        input.disabled =
          !editable || (key === "miterLimit" && state.style.join !== "miter");
      }
    }

    async _changeValue(key, rawValue) {
      const state = this._state;
      if (!state?.atSource || state.method !== "offset") {
        return;
      }
      const value = sanitizeOffsetValue(key, rawValue);
      if (value === undefined || value === state.style[key]) {
        // Invalid input or no change: show the value in use again
        this._syncValues();
        return;
      }
      const { glyphName, sourceIndex } = state;
      try {
        await this.sceneController.editNamedGlyphAndRecordChanges(
          glyphName,
          (glyph) => {
            const source = glyph.sources[sourceIndex];
            if (!source.customData) {
              source.customData = {};
            }
            setSourceDefaults(source.customData, { [key]: value });
            return t(`undo.${key}`);
          }
        );
      } catch (e) {
        console.error("[stroke-font] could not change the stroke value", e);
      }
      this.update();
    }
  }

  customElements.define(ELEMENT_NAME, StrokeFontPanel);
  return StrokeFontPanel;
}

function el(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key.startsWith("on") && typeof value === "function") {
      element.addEventListener(key.slice(2), value);
    } else {
      element.setAttribute(key, value);
    }
  }
  element.append(...children);
  return element;
}
