import assert from "node:assert/strict";
import { test } from "node:test";

import { CAPS, JOINS } from "../src/stroke-data.js";
import { currentLanguage, strings, translate } from "../src/strings.js";

// Language codes offered by Fontra (src-js/fontra-core/src/localization.js)
const FONTRA_LANGUAGES = [
  "en",
  "zh-CN",
  "zh-TW",
  "ja",
  "de",
  "nl",
  "fr",
  "it",
  "es-ES",
  "es-419",
  "pt-BR",
  "pt-PT",
  "tl",
  "ru",
];

test("every table uses one of Fontra's language codes", () => {
  for (const language of Object.keys(strings)) {
    assert.ok(FONTRA_LANGUAGES.includes(language), language);
  }
});

test("every table has exactly the English keys", () => {
  const keys = Object.keys(strings.en).sort();
  for (const [language, table] of Object.entries(strings)) {
    assert.deepEqual(Object.keys(table).sort(), keys, language);
  }
});

test("every cap and join has a label", () => {
  for (const cap of CAPS) {
    assert.ok(`cap.${cap}` in strings.en, cap);
  }
  for (const join of JOINS) {
    assert.ok(`join.${join}` in strings.en, join);
  }
});

test("placeholders are kept in every language", () => {
  for (const [language, table] of Object.entries(strings)) {
    for (const [key, text] of Object.entries(table)) {
      const expected = strings.en[key].match(/\{\d+\}/g) || [];
      assert.deepEqual(text.match(/\{\d+\}/g) || [], expected, `${language} ${key}`);
    }
  }
});

test("the language comes from Fontra's localStorage key", () => {
  const storage = {
    getItem: (key) => (key === "fontra-language-language" ? "ja" : null),
  };
  assert.equal(currentLanguage(storage), "ja");
  assert.equal(currentLanguage({ getItem: () => null }), "en");
  assert.equal(currentLanguage(undefined), "en");
  const throwing = {
    getItem() {
      throw new Error("denied");
    },
  };
  assert.equal(currentLanguage(throwing), "en");
});

test("arguments fill the placeholders", () => {
  assert.equal(translate("source.current", "en", "Bold"), "Source: Bold");
  assert.equal(translate("source.current", "ja", "Bold"), "ソース: Bold");
  assert.equal(translate("source.current", "en"), "Source: {0}");
});

test("unknown languages and keys fall back like Fontra", () => {
  assert.equal(translate("panel.title", "tl"), "Stroke font");
  assert.equal(translate("panel.title", "xx"), "Stroke font");
  assert.equal(translate("no.such.key", "ja"), "no.such.key");
});
