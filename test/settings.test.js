import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_SETTINGS, StrokeSettings } from "../src/settings.js";

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

test("defaults, then stored values", () => {
  assert.equal(
    new StrokeSettings(memoryStorage()).get("visible"),
    DEFAULT_SETTINGS.visible
  );
  const storage = memoryStorage({
    "fontra-plugin-stroke-font.settings": JSON.stringify({ visible: false, junk: 1 }),
  });
  assert.equal(new StrokeSettings(storage).get("visible"), false);
});

test("changes are saved and reported once", () => {
  const storage = memoryStorage();
  const settings = new StrokeSettings(storage);
  const seen = [];
  settings.addListener((key, value) => seen.push([key, value]));
  settings.set("visible", false);
  settings.set("visible", false);
  assert.deepEqual(seen, [["visible", false]]);
  assert.deepEqual(JSON.parse(storage.data["fontra-plugin-stroke-font.settings"]), {
    visible: false,
  });
  assert.throws(() => settings.set("nope", 1));
});

test("broken or missing storage does not break the settings", () => {
  const broken = memoryStorage({ "fontra-plugin-stroke-font.settings": "{not json" });
  assert.equal(new StrokeSettings(broken).get("visible"), true);
  const throwing = {
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("denied");
    },
  };
  const settings = new StrokeSettings(throwing);
  settings.set("visible", false);
  assert.equal(settings.get("visible"), false);
  assert.equal(new StrokeSettings(undefined).get("visible"), true);
});
