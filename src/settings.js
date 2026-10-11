// Small observable settings store for display settings, persisted to
// localStorage. Stroke values are not settings: they are font data, kept in
// the glyph sources (see stroke-data.js).

const STORAGE_KEY = "fontra-plugin-stroke-font.settings";

export const DEFAULT_SETTINGS = Object.freeze({
  visible: true,
});

export class StrokeSettings {
  constructor(storage = safeLocalStorage()) {
    this._storage = storage;
    this._listeners = new Set();
    this._values = { ...DEFAULT_SETTINGS, ...this._load() };
  }

  get(key) {
    return this._values[key];
  }

  set(key, value) {
    if (!(key in DEFAULT_SETTINGS)) {
      throw new Error(`unknown setting: ${key}`);
    }
    value = sanitize(key, value);
    if (this._values[key] === value) {
      return;
    }
    this._values[key] = value;
    this._save();
    for (const listener of this._listeners) {
      listener(key, value);
    }
  }

  addListener(listener) {
    this._listeners.add(listener);
  }

  removeListener(listener) {
    this._listeners.delete(listener);
  }

  _load() {
    try {
      const stored = JSON.parse(this._storage?.getItem(STORAGE_KEY) || "{}");
      const result = {};
      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (key in stored) {
          result[key] = sanitize(key, stored[key]);
        }
      }
      return result;
    } catch (e) {
      return {};
    }
  }

  _save() {
    try {
      this._storage?.setItem(STORAGE_KEY, JSON.stringify(this._values));
    } catch (e) {
      // Storage may be unavailable (private mode, quota); settings stay in memory.
    }
  }
}

function sanitize(key, value) {
  return typeof DEFAULT_SETTINGS[key] === "boolean" ? !!value : value;
}

function safeLocalStorage() {
  try {
    return globalThis.localStorage;
  } catch (e) {
    return undefined;
  }
}
