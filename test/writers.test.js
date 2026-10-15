import assert from "node:assert/strict";
import { test } from "node:test";

import { designspaceXML, parseDesignspace } from "../cli/formats/designspace.js";
import { glifXML, readGlif } from "../cli/formats/glif.js";
import { parseXMLPlist, plistXML } from "../cli/formats/plist.js";
import { userNameToFileName } from "../cli/formats/ufo.js";
import { parseXML } from "../cli/formats/xml.js";

test("plists are read back as they were written", () => {
  const value = {
    name: "a < b & c",
    count: 3,
    scale: 0.039625,
    flags: [true, false],
    nested: { empty: {}, list: [] },
  };
  assert.deepEqual(parseXMLPlist(plistXML(value)), value);
  // Missing values are left out
  assert.deepEqual(parseXMLPlist(plistXML({ a: undefined, b: null, c: [null, 1] })), {
    c: [1],
  });
  assert.throws(() => plistXML({ a: NaN }), /NaN/);
});

test("a glif is read back as it was written", () => {
  const contours = [
    {
      isClosed: false,
      points: [
        { x: 0, y: 0, attrs: { identifier: "p1" } },
        { x: 0, y: 50, type: "quad" },
        { x: 50, y: 50, smooth: true },
      ],
    },
    {
      isClosed: true,
      points: [
        { x: 0, y: 0, type: "cubic" },
        { x: 10, y: 0 },
        { x: 20, y: 0, type: "cubic" },
        { x: 20.5, y: 10 },
      ],
    },
  ];
  const text = glifXML({
    name: "a&b",
    unicodes: [0x61, 0x1f600],
    width: 500,
    note: "<note>",
    anchors: [{ name: "top", x: 250, y: 700 }],
    guidelines: [{ x: 0, y: 500, angle: 0, name: "x-height" }],
    contours,
    components: [
      { base: "acute", transform: [1, 0, 0, 1, 250, 0] },
      { base: "grave", transform: [-1, 0, 0, 1, 0, 0] },
    ],
    lib: { "public.truetype.overlap": true },
  });
  const { outline, lib } = readGlif(text);
  assert.deepEqual(outline[0].contour, {
    isClosed: false,
    points: [
      { x: 0, y: 0, attrs: { identifier: "p1" } },
      { x: 0, y: 50, type: "quad" },
      { x: 50, y: 50, smooth: true },
    ],
  });
  assert.deepEqual(outline[1].contour, contours[1]);
  assert.deepEqual(outline[2].element.attributes, { base: "acute", xOffset: "250" });
  assert.deepEqual(outline[3].element.attributes, { base: "grave", xScale: "-1" });
  assert.deepEqual(lib, { "public.truetype.overlap": true });
  const root = parseXML(text);
  assert.equal(root.attributes.name, "a&b");
  assert.deepEqual(
    root.children.filter((c) => c.name === "unicode").map((c) => c.attributes.hex),
    ["0061", "1F600"]
  );
  assert.equal(root.children.find((c) => c.name === "note").text, "<note>");
  // The order of the elements, as glifLib writes them
  assert.deepEqual(
    root.children.map((c) => c.name),
    ["advance", "unicode", "unicode", "note", "guideline", "anchor", "outline", "lib"]
  );
  // An empty glyph
  assert.deepEqual(readGlif(glifXML({ name: "space", width: 250 })), {
    outline: [],
    lib: {},
  });
});

test("a designspace is read back as it was written", () => {
  const text = designspaceXML({
    axes: [
      {
        name: "Weight",
        tag: "wght",
        minimum: 300,
        default: 400,
        maximum: 700,
        map: [
          [300, 30],
          [400, 40],
          [700, 70],
        ],
        labels: [{ uservalue: 400, name: "Regular", elidable: "true" }],
      },
      { name: "Italic", tag: "ital", values: [0, 1], default: 0 },
    ],
    sources: [
      {
        filename: "A-Regular.ufo",
        name: "Regular",
        stylename: "Regular",
        location: { Weight: 40, Italic: 0 },
      },
      {
        filename: "A-Regular.ufo",
        name: "Bold",
        stylename: "Bold",
        layer: "Bold",
        location: { Weight: 70, Italic: 0 },
      },
    ],
    rules: [
      {
        name: "dollar",
        conditionSets: [[{ name: "Weight", minimum: 60, maximum: 70 }]],
        substitutions: { dollar: "dollar.alt" },
      },
    ],
    rulesProcessingLast: true,
    lib: { "public.skipExportGlyphs": ["x"] },
  });
  const { axes, sources } = parseDesignspace(text);
  assert.deepEqual(axes, [
    { name: "Weight", default: 40 },
    { name: "Italic", default: 0 },
  ]);
  assert.deepEqual(
    sources.map((s) => [s.name, s.filename, s.layer, s.isDefault, s.location]),
    [
      ["Regular", "A-Regular.ufo", null, true, { Weight: 40, Italic: 0 }],
      ["Bold", "A-Regular.ufo", "Bold", false, { Weight: 70, Italic: 0 }],
    ]
  );
  assert.match(text, /<designspace format="5.0">/);
  assert.match(text, /<axis tag="ital" name="Italic" values="0 1" default="0"\/>/);
  assert.match(text, /<label uservalue="400" name="Regular" elidable="true"\/>/);
  assert.match(text, /<rules processing="last">/);
  assert.match(text, /<sub name="dollar" with="dollar.alt"\/>/);
  assert.match(text, /<key>public.skipExportGlyphs<\/key>/);
  // Cross-axis mappings need format 5.1
  const mapped = designspaceXML({
    mappings: [{ input: { Weight: 40 }, output: { Weight: 45 } }],
    sources: [],
  });
  assert.match(mapped, /<designspace format="5.1">/);
  assert.match(mapped, /<input>\s*<dimension name="Weight" xvalue="40"\/>\s*<\/input>/);
});

test("file names follow the UFO convention", () => {
  const taken = new Set();
  assert.equal(userNameToFileName("a", taken, "", ".glif"), "a.glif");
  assert.equal(userNameToFileName("A", taken, "", ".glif"), "A_.glif");
  assert.equal(userNameToFileName("A.alt", taken, "", ".glif"), "A_.alt.glif");
  assert.equal(userNameToFileName(".notdef", taken, "", ".glif"), "_notdef.glif");
  assert.equal(userNameToFileName("con", taken, "", ".glif"), "_con.glif");
  assert.equal(userNameToFileName("a/b:c", taken, "", ".glif"), "a_b_c.glif");
  assert.equal(userNameToFileName("Bold", taken, "glyphs."), "glyphs.B_old");
  // Taken in any case
  assert.equal(userNameToFileName("a", taken, "", ".glif"), "a000000000000001.glif");
  const long = userNameToFileName("x".repeat(300), taken, "", ".glif");
  assert.equal(long.length, 255);
});
