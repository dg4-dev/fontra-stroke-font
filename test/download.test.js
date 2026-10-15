import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { expandDesignspace } from "../cli/expand.js";
import { joinPath } from "../cli/expand-font.js";
import { parseDesignspace } from "../cli/formats/designspace.js";
import { readGlif } from "../cli/formats/glif.js";
import { parseXMLPlist } from "../cli/formats/plist.js";
import { layerGlyphFiles } from "../cli/formats/ufo.js";
import { parseXML } from "../cli/formats/xml.js";
import { expandedFontZip, projectName } from "../src/download.js";
import { affineTransform, fontFiles, ufoContours } from "../src/font-files.js";
import { fakeFontController, fontControllerFromData } from "./fake-font.js";
import { unzip } from "./unzip.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures", "expand");
const designspace = join(fixtures, "designspace", "Test.designspace");

const tempFolder = () => mkdtempSync(join(tmpdir(), "stroke-font-"));

// A copy of the fixtures, with each file's text changed by change(path, text)
function variant(change) {
  const folder = tempFolder();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else {
        const target = join(folder, relative(fixtures, path));
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(
          target,
          change(relative(fixtures, path), readFileSync(path, "utf-8"))
        );
      }
    }
  };
  walk(fixtures);
  return join(folder, "designspace", "Test.designspace");
}

// Every glyph of every source of a designspace, read back: "source/glyph" →
// what fontmake would see of it. Left aside: the identifiers of components,
// which Fontra does not keep, and code points, which Fontra writes into the
// glyph in every source (the fixtures have them in some only; fontmake reads
// those of the default source)
function builtGlyphs(read, designspacePath) {
  const folder = designspacePath.includes("/")
    ? designspacePath.slice(0, designspacePath.lastIndexOf("/"))
    : "";
  const glyphs = {};
  for (const source of parseDesignspace(read(designspacePath)).sources) {
    const ufo = joinPath(folder, source.filename);
    for (const [glyphName, path] of layerGlyphFiles(read, ufo, source.layer)) {
      const text = read(path);
      const { outline, lib } = readGlif(text);
      const element = parseXML(text);
      glyphs[`${source.name}/${glyphName}`] = {
        outline: outline.map((item) => {
          if (item.contour) {
            return item.contour;
          }
          const { identifier, ...attributes } = item.element.attributes;
          return { [item.element.name]: attributes };
        }),
        lib,
        rest: element.children
          .filter((child) => !["outline", "lib", "unicode"].includes(child.name))
          .map((child) => [child.name, child.attributes]),
      };
    }
  }
  return glyphs;
}

// The CLI on the font on disk, and the download on the same font read
// through a font controller
async function bothWays(designspacePath) {
  const out = tempFolder();
  const cli = expandDesignspace(designspacePath, out);
  const cliRead = (path) => {
    try {
      return readFileSync(join(out, ...path.split("/")), "utf-8");
    } catch (e) {
      return undefined;
    }
  };
  const download = await expandedFontZip(fakeFontController(designspacePath), {
    name: "Test",
    pause: async () => {},
  });
  const files = unzip(download.bytes);
  const editorRead = (path) => files.get(`Test-expanded/${path}`);
  return {
    cli,
    download,
    files,
    cliGlyphs: builtGlyphs(cliRead, "Test.designspace"),
    editorGlyphs: builtGlyphs(editorRead, "Test.designspace"),
  };
}

test("the download has the same outlines as the CLI's copy", async () => {
  const { cli, download, files, cliGlyphs, editorGlyphs } = await bothWays(designspace);
  assert.deepEqual(editorGlyphs, cliGlyphs);
  assert.equal(Object.keys(editorGlyphs).length, 7);
  assert.equal(download.glyphs, cli.glyphs);
  assert.deepEqual(download.warnings, cli.warnings);
  assert.deepEqual(download.twists, cli.twists);
  assert.equal(download.fileName, "Test-expanded.zip");
  assert.deepEqual(
    [...files.keys()].filter((path) => !path.includes(".ufo/")),
    ["Test-expanded/Test.designspace"]
  );
  // The default source's UFO holds the sparse source as a layer
  const layers = parseXMLPlist(
    files.get("Test-expanded/Test-Light.ufo/layercontents.plist")
  );
  assert.deepEqual(layers, [
    ["public.default", "glyphs"],
    ["Medium", "glyphs.M_edium"],
  ]);
  const info = parseXMLPlist(files.get("Test-expanded/Test-Bold.ufo/fontinfo.plist"));
  assert.equal(info.familyName, "Test");
  assert.equal(info.styleName, "Bold");
  assert.equal(info.unitsPerEm, 1000);
  assert.equal(info.ascender, 800);
  assert.equal(info.descender, -200);
});

test("the same, from the data Fontra's designspace backend serves", async () => {
  // test/fixtures/fontra/Test.json: the fixture as read by Fontra's
  // DesignspaceBackend (fontra 2026-10-06), getAxes(), getSources(),
  // getGlyph() and so on, unstructured as sent to the browser
  const data = JSON.parse(
    readFileSync(join(here, "fixtures", "fontra", "Test.json"), "utf-8")
  );
  const { cliGlyphs } = await bothWays(designspace);
  const download = await expandedFontZip(fontControllerFromData(data), {
    name: "Test",
    pause: async () => {},
  });
  const files = unzip(download.bytes);
  const editorGlyphs = builtGlyphs(
    (path) => files.get(`Test-expanded/${path}`),
    "Test.designspace"
  );
  assert.deepEqual(editorGlyphs, cliGlyphs);
  assert.deepEqual(download.warnings, []);
  assert.equal(download.glyphs, 2);
  const unicodes = (path) =>
    parseXML(files.get(`Test-expanded/${path}`))
      .children.filter((child) => child.name === "unicode")
      .map((child) => child.attributes.hex);
  assert.deepEqual(unicodes("Test-Light.ufo/glyphs/n.glif"), ["006E"]);
  assert.deepEqual(unicodes("Test-Bold.ufo/glyphs/n.glif"), ["006E"]);
});

test("twists and warnings are the same as the CLI's", async () => {
  // A much wider Bold twists in the arch of n
  const twisting = variant((path, text) =>
    path.endsWith(join("Test-Bold.ufo", "glyphs", "n.glif"))
      ? text.replace("<integer>160</integer>", "<integer>300</integer>")
      : text
  );
  const { cli, download, cliGlyphs, editorGlyphs } = await bothWays(twisting);
  assert.equal(download.twists.length, 1);
  assert.equal(download.warnings.length, 1);
  assert.deepEqual(download.twists, cli.twists);
  assert.deepEqual(download.warnings, cli.warnings);
  assert.deepEqual(editorGlyphs, cliGlyphs);

  // A source with different contours
  const different = variant((path, text) =>
    path.endsWith(join("Test-Bold.ufo", "glyphs", "n.glif"))
      ? text.replace(/<contour>\s*<point x="0" y="-20"[\s\S]*?<\/contour>/, "")
      : text
  );
  const other = await bothWays(different);
  assert.match(other.download.warnings[0], /^n: the sources have different contours/);
  assert.deepEqual(other.download.warnings, other.cli.warnings);
  assert.deepEqual(other.editorGlyphs, other.cliGlyphs);
});

test("nibs, point values and closed centerlines come out as the CLI's", async () => {
  const designspaces = [
    // n with an elliptical nib that turns between the sources
    variant((path, text) => {
      const nibs = {
        [join("Test-Light.ufo", "glyphs", "n.glif")]: [60, 20, 30],
        [join("Test-Light.ufo", "glyphs.medium", "n.glif")]: [100, 30, 80],
        [join("Test-Bold.ufo", "glyphs", "n.glif")]: [160, 50, 150],
      };
      const nib = Object.entries(nibs).find(([end]) => path.endsWith(end))?.[1];
      if (!nib) {
        return text;
      }
      let written = text.replace(
        /<key>defaults<\/key>\s*<dict>/,
        `<key>defaults</key><dict><key>major</key><integer>${nib[0]}</integer>` +
          `<key>minor</key><integer>${nib[1]}</integer>` +
          `<key>angle</key><integer>${nib[2]}</integer>`
      );
      if (nib[0] === 60) {
        written = written.replace(
          "<key>fontra.glyph.locked</key>",
          "<key>xyz.dg4.stroke</key><dict><key>type</key><string>nib</string>" +
            "<key>shape</key><string>ellipse</string></dict>" +
            "<key>fontra.glyph.locked</key>"
        );
      }
      return written;
    }),
    // A wide point in period, and the square of o stroked as a centerline
    variant((path, text) => {
      if (path.endsWith(join("Test-Light.ufo", "glyphs", "period.glif"))) {
        return text
          .replace('type="move"/>', 'type="move" identifier="dot"/>')
          .replace(
            "<dict>\n    </dict>",
            "<dict><key>xyz.fontra.glyph.source.customData</key><dict>" +
              "<key>xyz.dg4.stroke</key><dict><key>points</key><dict><key>dot</key>" +
              "<dict><key>width</key><integer>300</integer></dict></dict></dict>" +
              "</dict></dict>"
          );
      }
      if (path.endsWith(join("Test-Light.ufo", "glyphs", "o.glif"))) {
        return text
          .replace(
            '<point x="100" y="0" type="line"/>',
            '<point x="100" y="0" type="line" identifier="s1"/>'
          )
          .replace(
            "</outline>",
            "</outline><lib><dict><key>xyz.fontra.glyph.source.customData</key>" +
              "<dict><key>xyz.dg4.stroke</key><dict><key>points</key><dict>" +
              "<key>s1</key><dict><key>centerline</key><true/></dict>" +
              "</dict></dict></dict></dict></lib>"
          );
      }
      return text;
    }),
  ];
  for (const path of designspaces) {
    const { cli, download, cliGlyphs, editorGlyphs } = await bothWays(path);
    assert.deepEqual(editorGlyphs, cliGlyphs);
    assert.deepEqual(download.warnings, cli.warnings);
    assert.deepEqual(download.twists, cli.twists);
  }
});

test("progress is reported, and the page gets to respond in between", async () => {
  const stages = [];
  let pauses = 0;
  let clock = 0;
  await expandedFontZip(fakeFontController(designspace), {
    name: "Test",
    onProgress: (stage, done, total) => stages.push([stage, done, total]),
    pause: async () => pauses++,
    // Each look at the clock takes 20 ms
    now: () => (clock += 20),
  });
  assert.deepEqual(stages, [
    ["reading", 3, 3],
    ["expanding", 1, 3],
    ["expanding", 2, 3],
    ["expanding", 3, 3],
    ["zipping", undefined, undefined],
  ]);
  assert.ok(pauses >= 3, String(pauses));
});

test("glyph-level axes and sources are left out, with a warning", async () => {
  const controller = fakeFontController(designspace);
  const getGlyph = controller.getGlyph;
  controller.getGlyph = async (glyphName) => {
    const result = await getGlyph(glyphName);
    if (glyphName === "o") {
      const glyph = result.glyph;
      glyph.axes = [{ name: "curl", minValue: 0, defaultValue: 0, maxValue: 100 }];
      glyph.sources.push({
        name: "curly",
        locationBase: "Light",
        location: { curl: 100 },
        layerName: "curly",
        customData: {},
      });
      glyph.layers.curly = glyph.layers.Light;
    }
    return result;
  };
  const { files, warnings } = await fontFiles(controller, { name: "Test" });
  assert.deepEqual(warnings, [
    "o: the glyph has axes or sources of its own, which are left out of the copy",
  ]);
  // Only the glyph's sources at the font's sources are written
  assert.deepEqual(
    [...files.keys()].filter((path) => path.endsWith("/o.glif")),
    ["Test-Light.ufo/glyphs/o.glif", "Test-Bold.ufo/glyphs/o.glif"]
  );
  assert.doesNotMatch(files.get("Test-Light.ufo/glyphs/o.glif"), /glyph-designspace/);
});

test("font data goes where Fontra's designspace backend puts it", async () => {
  const controller = fakeFontController(designspace);
  controller.customData = {
    "public.glyphOrder": ["period", "o"],
    "public.skipExportGlyphs": ["o"],
  };
  controller.getFeatures = async () => ({
    language: "fea",
    text: "languagesystem DFLT dflt;\n",
  });
  controller.getKerning = async () => ({
    kern: {
      groupsSide1: { round: ["o"] },
      groupsSide2: { round: ["o"] },
      sourceIdentifiers: ["Light", "Bold"],
      values: { "@round": { "@round": [-10, null], "n": [5, 7] } },
    },
  });
  controller.getConditionalSubstitutions = async () => ({
    featureTags: ["rclt"],
    rules: [
      {
        name: "heavy",
        conditionSets: [
          { conditions: [{ name: "Weight", minValue: 60, maxValue: 70 }] },
        ],
        substitutions: { n: "o" },
      },
    ],
  });
  controller.sources.Bold.customData = { openTypeOS2WinAscent: 900, other: 1 };
  const { files } = await fontFiles(controller, { name: "Test" });
  const plist = (path) => parseXMLPlist(files.get(path));
  assert.deepEqual(plist("Test-Light.ufo/lib.plist"), {
    "public.glyphOrder": ["period", "o", "n"],
    "public.skipExportGlyphs": ["o"],
  });
  assert.deepEqual(plist("Test-Bold.ufo/groups.plist"), {
    "public.kern1.round": ["o"],
    "public.kern2.round": ["o"],
  });
  assert.deepEqual(plist("Test-Light.ufo/kerning.plist"), {
    "public.kern1.round": { "public.kern2.round": -10, "n": 5 },
  });
  assert.deepEqual(plist("Test-Bold.ufo/kerning.plist"), {
    "public.kern1.round": { n: 7 },
  });
  assert.equal(files.get("Test-Bold.ufo/features.fea"), "languagesystem DFLT dflt;\n");
  assert.equal(plist("Test-Bold.ufo/fontinfo.plist").openTypeOS2WinAscent, 900);
  assert.equal(plist("Test-Bold.ufo/fontinfo.plist").other, undefined);
  const text = files.get("Test.designspace");
  const { axes, sources } = parseDesignspace(text);
  assert.deepEqual(axes, [{ name: "Weight", default: 30 }]);
  assert.deepEqual(
    sources.map((s) => [s.name, s.filename, s.layer, s.isDefault, s.location]),
    [
      ["Light", "Test-Light.ufo", null, true, { Weight: 30 }],
      ["Medium", "Test-Light.ufo", "Medium", false, { Weight: 50 }],
      ["Bold", "Test-Bold.ufo", null, false, { Weight: 70 }],
    ]
  );
  assert.match(text, /<map input="300" output="30"\/>/);
  // An instance at each source that is not sparse
  assert.deepEqual(
    [...text.matchAll(/<instance name="([^"]*)"[^>]*filename="([^"]*)"/g)].map(
      (match) => [match[1], match[2]]
    ),
    [
      ["Test Light", "instances/Test-Light.ufo"],
      ["Test Bold", "instances/Test-Bold.ufo"],
    ]
  );
  assert.match(text, /<rules processing="last">/);
  assert.match(text, /<condition name="Weight" minimum="60" maximum="70"\/>/);
  // contents.plist in the order of the glyphs
  assert.deepEqual(Object.keys(plist("Test-Light.ufo/glyphs/contents.plist")), [
    "period",
    "o",
    "n",
  ]);
});

test("contours are written as Fontra writes them", () => {
  const path = {
    numContours: 2,
    getUnpackedContour: (i) =>
      [
        {
          isClosed: false,
          points: [
            { x: -10, y: 0, type: "cubic" },
            { x: 0, y: 0, attrs: { identifier: "a", other: 1 } },
            { x: 10, y: 0, type: "cubic" },
            { x: 20, y: 0, type: "cubic" },
            { x: 30, y: 0, type: "cubic" },
            { x: 40, y: 0, smooth: true },
            { x: 50, y: 0, type: "quad" },
          ],
        },
        { isClosed: true, points: [{ x: 0, y: 0, type: "quad" }] },
      ][i],
  };
  assert.deepEqual(ufoContours(path), [
    {
      isClosed: false,
      points: [
        { x: 0, y: 0, attrs: { identifier: "a" } },
        { x: 10, y: 0, type: "cubic" },
        { x: 30, y: 0, type: "cubic" },
        { x: 40, y: 0, smooth: true },
      ],
    },
    { isClosed: true, points: [{ x: 0, y: 0, type: "quad" }] },
  ]);
});

test("component transformations become affine transforms as in Fontra", () => {
  assert.deepEqual(
    affineTransform({ translateX: 10, translateY: 20 }),
    [1, 0, 0, 1, 10, 20]
  );
  const [xx, xy, yx, yy, dx, dy] = affineTransform({
    rotation: 90,
    scaleX: 2,
    tCenterX: 10,
  });
  // Turned a quarter around (10, 0) after doubling the width
  const round = (v) => Math.round(v * 1e9) / 1e9 + 0;
  assert.deepEqual([xx, xy, yx, yy, dx, dy].map(round), [0, 2, -1, 0, 10, -20]);
});

test("the name of the copy comes from the project", () => {
  assert.equal(projectName("fonts/MyFamily.designspace"), "MyFamily");
  assert.equal(projectName("C:\\fonts\\My:Font.fontra"), "My_Font");
  assert.equal(projectName("", "Family"), "Family");
  assert.equal(projectName(undefined), "Font");
});
