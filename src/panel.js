// The sidebar panel: preview visibility, the stroke method of the glyph, the
// stroke values of the source being edited, and the values of the selected
// points.

import { describeStrokeSource } from "./current-source.js";
import {
  CLEARED_POINT_VALUES,
  closedContourPoints,
  describeSelectedPoints,
  editPointValues,
  editingSourceIndices,
  pointValuesForField,
  selectedPointIndices,
} from "./point-edit.js";
import {
  CAPS,
  JOINS,
  NIB_KEYS,
  NIB_SHAPES,
  SHARED_OFFSET_KEYS,
  sanitizeStrokeValue,
  setGlyphStroke,
  setSourceDefaults,
} from "./stroke-data.js";
import { FILL_OPACITY_MAX, FILL_OPACITY_MIN } from "./settings.js";
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
  .group {
    display: flex;
    flex-direction: column;
    gap: 0.5em;
  }
  .slider-row {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 0.6em;
    align-items: center;
  }
  .slider-row output {
    min-width: 3em;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  input[type="range"] {
    width: 100%;
    margin: 0;
  }
  input[type="range"]:disabled,
  input[type="checkbox"]:disabled {
    opacity: 0.5;
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
  button {
    justify-self: start;
    padding: 0.2em 0.8em;
    border-radius: 0.25em;
    border: 0.5px solid var(--horizontal-rule-color, #8884);
    background-color: var(--text-input-background-color, #fff);
    color: inherit;
    font: inherit;
  }
  button:disabled {
    opacity: 0.5;
  }
  [hidden] {
    display: none !important;
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
      this._pointState = null;
      this.attachShadow({ mode: "open" });
      this._render();

      settings.addListener(() => this._syncSettings());
      const scheduleUpdate = () => this._scheduleUpdate();
      this.sceneController.sceneSettingsController?.addKeyListener(
        ["selectedGlyphName", "selectedGlyph", "positionedLines", "selection"],
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
      this._pointState = positionedGlyph
        ? describeSelectedPoints(
            positionedGlyph,
            location,
            this.sceneController.selection
          )
        : null;
      this._syncValues();
      this._syncPointValues();
    }

    _render() {
      const root = this.shadowRoot;
      root.innerHTML = "";
      const style = document.createElement("style");
      style.textContent = styles;
      root.appendChild(style);

      this._sourceLabel = el("div", { class: "source" });
      this._note = el("div", { class: "note" });
      this._sharedNote = el("div", { class: "note" });
      this._methodSelect = el("select", {
        id: "stroke-font-method",
        onchange: (event) => this._changeMethod(event.target.value),
      });
      for (const method of ["offset", ...NIB_SHAPES]) {
        this._methodSelect.append(
          el("option", { value: method }, t(`method.${method}`))
        );
      }
      this._methodRow = el(
        "div",
        { class: "fields" },
        el("label", { for: "stroke-font-method" }, t("field.method")),
        this._methodSelect
      );
      this._nibFields = el(
        "div",
        { class: "fields" },
        ...NIB_KEYS.flatMap((key) => this._numberField(key, t(`field.${key}`)))
      );
      this._flatNote = el("div", { class: "note" });
      this._fields = el(
        "div",
        { class: "fields" },
        ...this._numberField("width", t("field.width")),
        ...this._selectField("cap", t("field.cap"), CAPS, "cap"),
        ...this._selectField("join", t("field.join"), JOINS, "join"),
        ...this._numberField("miterLimit", t("field.miterLimit"))
      );

      this._pointsLabel = el("div", { class: "source" });
      this._pointsNote = el("div", { class: "note" });
      this._nibPointFields = el(
        "div",
        { class: "fields" },
        ...NIB_KEYS.flatMap((key) => this._numberField(key, t(`field.${key}`), "point"))
      );
      this._pointFields = el(
        "div",
        { class: "fields" },
        ...this._numberField("width", t("field.width"), "point"),
        ...this._numberField("left", t("field.left"), "point"),
        ...this._numberField("right", t("field.right"), "point"),
        ...this._selectField("join", t("field.join"), ["", ...JOINS], "join", "point"),
        ...this._numberField("miterLimit", t("field.miterLimit"), "point")
      );
      this._clearButton = el(
        "button",
        { type: "button", onclick: () => this._clearPointValues() },
        t("points.clear")
      );
      this._closedCheckbox = el("input", {
        type: "checkbox",
        id: "stroke-font-point-closedCenterline",
        onchange: (event) => this._setClosedCenterline(event.target.checked),
      });
      this._closedRow = el(
        "div",
        { class: "row" },
        this._closedCheckbox,
        el(
          "label",
          { for: "stroke-font-point-closedCenterline" },
          t("points.closedCenterline")
        )
      );

      const panel = el(
        "div",
        { class: "panel" },
        el("div", { class: "title" }, t("panel.title")),
        el(
          "div",
          { class: "group" },
          this._checkbox("visible", t("setting.visible")),
          this._checkbox("outlineOnly", t("setting.outlineOnly")),
          this._opacitySlider(),
          this._checkbox("otherGlyphs", t("setting.otherGlyphs")),
          this._checkbox("handles", t("setting.handles")),
          this._checkbox("nibs", t("setting.nibs"))
        ),
        el("hr"),
        this._methodRow,
        this._sourceLabel,
        this._note,
        this._fields,
        this._nibFields,
        this._flatNote,
        this._sharedNote,
        el("hr"),
        this._pointsLabel,
        this._pointsNote,
        this._closedRow,
        this._pointFields,
        this._nibPointFields,
        this._clearButton,
        el("hr"),
        el("div", { class: "hint" }, t("panel.hint"))
      );
      root.appendChild(panel);
      this._syncSettings();
      this._syncValues();
      this._syncPointValues();
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

    _opacitySlider() {
      const id = "stroke-font-fillOpacity";
      const output = el("output", { for: id });
      const input = el("input", {
        "type": "range",
        id,
        "min": Math.round(FILL_OPACITY_MIN * 100),
        "max": Math.round(FILL_OPACITY_MAX * 100),
        "step": 1,
        "data-range-setting": "fillOpacity",
        "oninput": (event) =>
          this.settings.set("fillOpacity", event.target.value / 100),
      });
      input._output = output;
      return el(
        "div",
        { class: "slider-row" },
        el("label", { for: id }, t("setting.fillOpacity")),
        input,
        output
      );
    }

    // target "source" changes the source's value, "point" the selected points'
    _numberField(key, label, target = "source") {
      const id = `stroke-font-${target}-${key}`;
      const input = el("input", {
        "type": "number",
        id,
        // No min or step: the values are checked by sanitizeStrokeValue(), and
        // with them the browser would flag values such as interpolated widths
        // as invalid, in the browser's language rather than Fontra's
        "step": "any",
        "data-key": key,
        // While typing, the field is not refreshed from the glyph
        "oninput": () => (input.dataset.typing = "true"),
        // "change" fires on Enter or when leaving the field, so that typing a
        // number makes one undo step rather than one per keystroke
        "onchange": (event) => {
          delete input.dataset.typing;
          this._onChange(target, key, event.target.value);
        },
        "onblur": () => {
          if (input.dataset.typing) {
            delete input.dataset.typing;
            this._syncValues();
            this._syncPointValues();
          }
        },
      });
      return [el("label", { for: id }, label), input];
    }

    _selectField(key, label, choices, stringPrefix, target = "source") {
      const id = `stroke-font-${target}-${key}`;
      const select = el("select", {
        id,
        "data-key": key,
        "onchange": (event) => this._onChange(target, key, event.target.value),
      });
      for (const choice of choices) {
        const text =
          choice === "" ? t("point.sourceValue") : t(`${stringPrefix}.${choice}`);
        select.append(el("option", { value: choice }, text));
      }
      return [el("label", { for: id }, label), select];
    }

    _onChange(target, key, value) {
      if (target === "point") {
        this._changePointValue(key, value);
      } else {
        this._changeValue(key, value);
      }
    }

    _syncSettings() {
      for (const input of this.shadowRoot.querySelectorAll("input[data-setting]")) {
        input.checked = !!this.settings.get(input.dataset.setting);
      }
      const visible = this.settings.get("visible");
      const outlineOnly = this.settings.get("outlineOnly");
      this.shadowRoot.querySelector('[data-setting="outlineOnly"]').disabled = !visible;
      for (const input of this.shadowRoot.querySelectorAll(
        "input[data-range-setting]"
      )) {
        const percent = Math.round(this.settings.get(input.dataset.rangeSetting) * 100);
        input.value = String(percent);
        input._output.textContent = `${percent}%`;
        input.disabled = !visible || outlineOnly;
      }
    }

    _syncValues() {
      if (!this._fields) {
        return;
      }
      const state = this._state;
      const isNib = state?.method === "nib";
      const editable = !!state?.atSource;
      this._methodSelect.value = isNib ? state.shape : "offset";
      this._methodSelect.disabled = !state;
      if (!state) {
        this._sourceLabel.textContent = t("source.noGlyph");
        this._note.textContent = "";
      } else {
        this._sourceLabel.textContent = state.atSource
          ? t("source.current", state.sourceName)
          : t("source.between");
        this._note.textContent = state.atSource ? "" : t("source.notAtSource");
      }
      // Cap and join are written to the default source (see stroke-data.js)
      this._sharedNote.textContent =
        editable && !isNib && !state.isDefaultSource
          ? t("source.sharedStyle", state.defaultSourceName)
          : "";
      this._flatNote.textContent =
        isNib && state.shape === "rect" ? t("source.flatNib") : "";
      this._fields.hidden = isNib;
      this._nibFields.hidden = !isNib;
      for (const fields of [this._fields, this._nibFields]) {
        fields.setAttribute("aria-disabled", String(!editable));
        for (const input of fields.querySelectorAll("[data-key]")) {
          const key = input.dataset.key;
          const value = state?.style[key];
          const text = value === undefined ? "" : formatValue(value);
          // Leave a field alone while it is being typed into
          if (!input.dataset.typing && input.value !== text) {
            input.value = text;
          }
          input.disabled =
            !editable || (key === "miterLimit" && state.style.join !== "miter");
        }
      }
    }

    _syncPointValues() {
      if (!this._pointFields) {
        return;
      }
      const state = this._pointState;
      const sourceState = this._state;
      const editable = !!state?.editable;
      this._pointsLabel.textContent = state
        ? t("points.title", state.count)
        : t("points.noneTitle");
      // Between sources, the note above the source's values already says why
      // nothing can be changed
      const isNib = state?.method === "nib";
      this._pointsNote.textContent = !state
        ? t("points.none")
        : sourceState && !sourceState.isDefaultSource && state.editable && !isNib
          ? t("points.sharedJoin", sourceState.defaultSourceName)
          : "";
      this._pointFields.hidden = !state || isNib;
      this._nibPointFields.hidden = !state || !isNib;
      this._clearButton.hidden = !state;
      // Only for points on closed contours; mixed when some of those contours
      // are centerlines and some are not
      this._closedRow.hidden = state?.closedCenterline === undefined;
      this._closedCheckbox.checked = state?.closedCenterline === true;
      this._closedCheckbox.indeterminate = state?.closedCenterline === null;
      this._closedCheckbox.disabled = !editable;
      this._clearButton.disabled = !editable || !state.stored;
      const pointFields = isNib ? this._nibPointFields : this._pointFields;
      pointFields.setAttribute("aria-disabled", String(!editable));
      for (const input of pointFields.querySelectorAll("[data-key]")) {
        const key = input.dataset.key;
        const value = state?.fields[key];
        const text = value === undefined ? "" : formatValue(value);
        if (!input.dataset.typing && input.value !== text) {
          input.value = text;
        }
        if (input.tagName === "INPUT") {
          // Several points with different values, or the source's miter limit
          input.placeholder =
            value === undefined
              ? "—"
              : key === "miterLimit" && state
                ? formatValue(state.sourceStyle.miterLimit)
                : "";
        }
        input.disabled = !editable;
      }
    }

    async _changePointValue(key, rawValue) {
      const state = this._pointState;
      const sourceState = this._state;
      if (!state?.editable || !sourceState?.atSource) {
        return;
      }
      let value;
      if (rawValue !== "") {
        value = sanitizeStrokeValue(key, rawValue);
        if (value === undefined) {
          this._syncPointValues();
          return;
        }
      }
      if (value === undefined && key !== "join" && key !== "miterLimit") {
        // An emptied width or nib field: nothing to change
        this._syncPointValues();
        return;
      }
      const undoKey = NIB_KEYS.includes(key)
        ? "undo.pointNib"
        : key === "join"
          ? "undo.pointJoin"
          : key === "miterLimit"
            ? "undo.pointMiterLimit"
            : "undo.pointWidth";
      await this._editPoints(
        (stored) => pointValuesForField(stored, key, value),
        t(undoKey)
      );
    }

    async _clearPointValues() {
      await this._editPoints(() => CLEARED_POINT_VALUES, t("undo.pointClear"));
    }

    async _setClosedCenterline(on) {
      const path =
        this.sceneController.sceneModel?.getSelectedPositionedGlyph?.()?.glyph?.path;
      const pointIndices = closedContourPoints(
        path,
        selectedPointIndices(this.sceneController.selection)
      );
      await this._editPoints(
        () => ({ centerline: on ? true : undefined }),
        t("undo.closedCenterline"),
        pointIndices
      );
    }

    async _editPoints(makeValues, undoLabel, points) {
      const sourceState = this._state;
      const pointIndices =
        points ?? selectedPointIndices(this.sceneController.selection);
      const varGlyph =
        this.sceneController.sceneModel?.getSelectedPositionedGlyph?.()?.varGlyph;
      const sourceIndices = editingSourceIndices(
        varGlyph,
        sourceState.sourceIndex,
        this.sceneController.editingLayerNames ?? []
      );
      try {
        await this.sceneController.editNamedGlyphAndRecordChanges(
          sourceState.glyphName,
          (glyph) => {
            editPointValues(glyph, sourceIndices, pointIndices, makeValues, {
              defaultIndex: sourceState.defaultSourceIndex,
            });
            return undoLabel;
          }
        );
      } catch (e) {
        console.error("[stroke-font] could not change the point values", e);
      }
      this.update();
    }

    async _changeMethod(choice) {
      const state = this._state;
      if (!state) {
        return;
      }
      const type = choice === "offset" ? "offset" : "nib";
      try {
        await this.sceneController.editNamedGlyphAndRecordChanges(
          state.glyphName,
          (glyph) => {
            if (!glyph.customData) {
              glyph.customData = {};
            }
            setGlyphStroke(glyph.customData, type, choice);
            return t("undo.method");
          }
        );
      } catch (e) {
        console.error("[stroke-font] could not change the stroke method", e);
      }
      this.update();
    }

    async _changeValue(key, rawValue) {
      const state = this._state;
      if (!state?.atSource) {
        return;
      }
      const value = sanitizeStrokeValue(key, rawValue);
      if (value === undefined || value === state.style[key]) {
        // Invalid input or no change: show the value in use again
        this._syncValues();
        return;
      }
      const { glyphName } = state;
      const sourceIndex = SHARED_OFFSET_KEYS.includes(key)
        ? state.defaultSourceIndex
        : state.sourceIndex;
      try {
        await this.sceneController.editNamedGlyphAndRecordChanges(
          glyphName,
          (glyph) => {
            const source = glyph.sources[sourceIndex];
            if (!source.customData) {
              source.customData = {};
            }
            setSourceDefaults(source.customData, { [key]: value });
            return t(NIB_KEYS.includes(key) ? "undo.nib" : `undo.${key}`);
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

// Interpolated numbers can have long fractions; two decimals are enough
function formatValue(value) {
  return typeof value === "number"
    ? String(Math.round(value * 100) / 100)
    : String(value);
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
