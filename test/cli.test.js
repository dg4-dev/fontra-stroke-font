import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

import { expandFontra } from "../cli/expand-fontra.js";
import { expandDesignspace } from "../cli/expand.js";
import { mapValue, parseDesignspace } from "../cli/formats/designspace.js";
import { defaultSourceIndex, serializeFontraJSON } from "../cli/formats/fontra.js";
import { readGlif, removeLibEntry, rewriteGlif } from "../cli/formats/glif.js";
import { outlineSignature } from "../src/geometry/compatible.js";
import { signedArea } from "../src/geometry/offset.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures", "expand");
const designspace = join(fixtures, "designspace", "Test.designspace");
const fontra = join(fixtures, "fontra", "Test.fontra");
const cli = join(here, "..", "cli", "index.js");

function snapshot(folder) {
  const files = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else {
        files[relative(folder, path)] = readFileSync(path, "utf-8");
      }
    }
  };
  walk(folder);
  return files;
}

const tempFolder = () => mkdtempSync(join(tmpdir(), "stroke-font-"));

test("the designspace is read with mapped defaults and layers", () => {
  const { axes, sources } = parseDesignspace(readFileSync(designspace, "utf-8"));
  assert.deepEqual(axes, [{ name: "Weight", default: 30 }]);
  assert.deepEqual(
    sources.map((s) => [s.name, s.filename, s.layer, s.isDefault]),
    [
      ["Light", "../ufos/Test-Light.ufo", null, true],
      ["Medium", "../ufos/Test-Light.ufo", "medium", false],
      ["Bold", "../ufos/Test-Bold.ufo", null, false],
    ]
  );
  assert.equal(
    mapValue(500, [
      [300, 30],
      [700, 70],
    ]),
    50
  );
  assert.equal(
    mapValue(800, [
      [300, 30],
      [700, 70],
    ]),
    170
  );
});

test("expand writes a copy and leaves the input alone", () => {
  const before = snapshot(fixtures);
  const out = tempFolder();
  const report = expandDesignspace(designspace, out);
  assert.deepEqual(snapshot(fixtures), before);
  assert.equal(report.glyphs, 2); // n and period
  assert.deepEqual(report.warnings, []);
  assert.deepEqual(readdirSync(out).sort(), [
    "Test-Bold.ufo",
    "Test-Light.ufo",
    "Test.designspace",
  ]);
  // The sources now point at the copies next to the designspace
  const text = readFileSync(join(out, "Test.designspace"), "utf-8");
  assert.match(text, /filename="Test-Light.ufo"/);
  assert.doesNotMatch(text, /\.\.\/ufos/);
});

test("open contours become compatible closed outlines in every source", () => {
  const out = tempFolder();
  expandDesignspace(designspace, out);
  const paths = [
    "Test-Light.ufo/glyphs/n.glif",
    "Test-Light.ufo/glyphs.medium/n.glif",
    "Test-Bold.ufo/glyphs/n.glif",
  ];
  const glyphs = paths.map((path) => readGlif(readFileSync(join(out, path), "utf-8")));
  const signatures = glyphs.map((glyph) =>
    outlineSignature(
      glyph.outline.filter((item) => item.contour).map((item) => item.contour)
    )
  );
  assert.equal(new Set(signatures).size, 1);
  for (const glyph of glyphs) {
    const contours = glyph.outline.filter((item) => item.contour);
    assert.ok(contours.every((item) => item.contour.isClosed));
    // band + two caps, then the closed contour that was already there
    assert.equal(contours.length, 4);
    for (const item of contours.slice(0, 3)) {
      assert.ok(signedArea(item.contour) > 0);
    }
    // The component stays, after the contours
    assert.equal(glyph.outline.at(-1).element.name, "component");
    assert.equal(glyph.outline.at(-1).element.attributes.identifier, "c1");
    assert.equal(glyph.lib["public.truetype.overlap"], true);
  }
  // Cap from the default source (round): the Bold source's own "square" is ignored
  const bold = glyphs[2].outline.filter((item) => item.contour);
  assert.equal(bold[1].contour.points.length, 12);
  // Width per source: Light 40, Bold 160
  const xs = (glyph) => glyph.outline[0].contour.points.map((p) => p.x);
  assert.equal(Math.min(...xs(glyphs[0])), 80);
  assert.equal(Math.min(...xs(glyphs[2])), 20);
});

test("the rest of a glif is kept as it was", () => {
  const out = tempFolder();
  expandDesignspace(designspace, out);
  const original = readFileSync(
    join(fixtures, "ufos", "Test-Light.ufo", "glyphs", "n.glif"),
    "utf-8"
  );
  const expanded = readFileSync(
    join(out, "Test-Light.ufo", "glyphs", "n.glif"),
    "utf-8"
  );
  const outside = (text) =>
    text
      .replace(/<outline>[\s\S]*<\/outline>/, "")
      .replace(/\s*<key>public\.truetype\.overlap<\/key>\s*<true\/>/, "");
  assert.equal(outside(expanded), outside(original));
  // Glyphs without open contours are not touched
  for (const name of ["o.glif"]) {
    assert.equal(
      readFileSync(join(out, "Test-Light.ufo", "glyphs", name), "utf-8"),
      readFileSync(join(fixtures, "ufos", "Test-Light.ufo", "glyphs", name), "utf-8")
    );
  }
});

test("a lone point becomes a dot", () => {
  const out = tempFolder();
  expandDesignspace(designspace, out);
  const glyph = readGlif(
    readFileSync(join(out, "Test-Light.ufo", "glyphs", "period.glif"), "utf-8")
  );
  assert.equal(glyph.outline.length, 1);
  assert.equal(glyph.outline[0].contour.points.length, 12);
  assert.equal(glyph.lib["public.truetype.overlap"], true);
});

test("glyphs with expanded glyphs as components get the overlap flag too", () => {
  const folder = tempFolder();
  const out = tempFolder();
  const composite = (name, outline) =>
    `<?xml version='1.0' encoding='UTF-8'?>\n<glyph name="${name}" format="2">\n` +
    `  <advance width="500"/>\n  <outline>\n${outline}  </outline>\n</glyph>\n`;
  const component = (base) => `    <component base="${base}"/>\n`;
  const added = {
    // Components only, of a glyph with a centerline
    colon: composite("colon", component("period") + component("period")),
    // Through another composite glyph
    ellipsis: composite("ellipsis", component("colon")),
    // An outline and a component, which ufo2ft decomposes
    i: composite(
      "i",
      '    <contour>\n      <point x="0" y="0" type="line"/>\n' +
        '      <point x="50" y="0" type="line"/>\n' +
        '      <point x="50" y="300" type="line"/>\n    </contour>\n' +
        component("period")
    ),
    // A component of a glyph without centerlines
    oo: composite("oo", component("o")),
  };
  for (const [path, text] of Object.entries(snapshot(fixtures))) {
    const target = join(folder, path);
    mkdirSync(dirname(target), { recursive: true });
    const isDefaultLayer =
      /Test-(Light|Bold)\.ufo[\\/]glyphs[\\/]contents\.plist$/.test(path);
    writeFileSync(
      target,
      isDefaultLayer
        ? text.replace(
            "</dict>",
            Object.keys(added)
              .map((name) => `  <key>${name}</key>\n  <string>${name}.glif</string>\n`)
              .join("") + "</dict>"
          )
        : text
    );
    if (isDefaultLayer) {
      for (const [name, glif] of Object.entries(added)) {
        writeFileSync(join(dirname(target), `${name}.glif`), glif);
      }
    }
  }
  const report = expandDesignspace(
    join(folder, "designspace", "Test.designspace"),
    out
  );
  assert.equal(report.glyphs, 2); // n and period, as before
  for (const ufo of ["Test-Light.ufo", "Test-Bold.ufo"]) {
    const read = (name) =>
      readFileSync(join(out, ufo, "glyphs", `${name}.glif`), "utf-8");
    for (const name of ["colon", "ellipsis", "i"]) {
      const { outline, lib } = readGlif(read(name));
      assert.equal(lib["public.truetype.overlap"], true, `${ufo} ${name}`);
      // The outline is left as it was
      assert.equal(outline.length, readGlif(added[name]).outline.length);
    }
    assert.equal(read("oo"), added.oo);
  }
});

test("the output folder may not be the input folder", () => {
  assert.throws(
    () => expandDesignspace(designspace, join(fixtures, "designspace")),
    /must not be the folder of the input/
  );
});

test("glifs: off-curve kinds, open and closed contours", () => {
  const { outline } = readGlif(`<glyph name="x" format="2"><outline>
    <contour><point x="0" y="0" type="move"/><point x="0" y="50"/><point x="50" y="50" type="qcurve"/><point x="60" y="60"/></contour>
    <contour><point x="0" y="0"/><point x="10" y="0" type="curve" smooth="yes"/><point x="20" y="0"/></contour>
    <contour><point x="0" y="0"/><point x="10" y="10"/></contour>
  </outline></glyph>`);
  assert.deepEqual(outline[0].contour, {
    isClosed: false,
    points: [
      { x: 0, y: 0 },
      { x: 0, y: 50, type: "quad" },
      { x: 50, y: 50 },
      { x: 60, y: 60, type: "cubic" },
    ],
  });
  // The off-curve point at the end leads to the first point (a "curve")
  assert.deepEqual(outline[1].contour.points, [
    { x: 0, y: 0, type: "cubic" },
    { x: 10, y: 0, smooth: true },
    { x: 20, y: 0, type: "cubic" },
  ]);
  assert.ok(outline[2].contour.points.every((p) => p.type === "quad"));
});

test("glifs: the overlap flag is added to any kind of lib", () => {
  const square = {
    isClosed: true,
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10, type: "cubic" },
      { x: 0, y: 10, type: "cubic" },
    ],
  };
  const glif = (lib) =>
    `<?xml version='1.0' encoding='UTF-8'?>\n<glyph name="x" format="2">\n  <outline>\n    <contour>\n      <point x="0" y="0" type="move"/>\n    </contour>\n  </outline>\n${lib}</glyph>\n`;
  for (const lib of [
    "",
    "  <lib>\n    <dict>\n      <key>a</key>\n      <string>b</string>\n    </dict>\n  </lib>\n",
    "  <lib>\n    <dict/>\n  </lib>\n",
    "  <lib>\n    <dict>\n      <key>public.truetype.overlap</key>\n      <false/>\n    </dict>\n  </lib>\n",
  ]) {
    const text = rewriteGlif(glif(lib), new Map([[0, [square]]]), {
      overlapFlag: true,
    });
    const { outline, lib: newLib } = readGlif(text);
    assert.equal(newLib["public.truetype.overlap"], true, lib);
    if (lib.includes("<key>a</key>")) {
      assert.equal(newLib.a, "b");
    }
    assert.deepEqual(outline[0].contour, square);
  }
  // On-curve points after off-curve points are "curve", others "line"
  const text = rewriteGlif(glif(""), new Map([[0, [square]]]));
  assert.match(text, /<point x="0" y="0" type="curve"\/>/);
  assert.match(text, /<point x="10" y="0" type="line"\/>/);
});

test("the command line tool", () => {
  const out = tempFolder();
  const run = (...args) =>
    spawnSync(process.execPath, [cli, ...args], { encoding: "utf-8" });
  const ok = run("expand", designspace, "-o", out);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Expanded 2 glyphs/);
  assert.equal(run("expand", designspace).status, 2);
  assert.equal(run("shrink", designspace, "-o", out).status, 2);
  assert.equal(run("expand", designspace, "-o", out, "--tolerance", "0").status, 2);
  assert.equal(run("--help").status, 0);
  const missing = run("expand", join(out, "nope.designspace"), "-o", tempFolder());
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /^error:/);
  const fontraOut = tempFolder();
  const ok2 = run("expand", fontra, "-o", fontraOut, "--remove-stroke-data");
  assert.equal(ok2.status, 0, ok2.stderr);
  assert.match(ok2.stdout, /Expanded 2 glyphs into .*Test\.fontra/);
  assert.doesNotMatch(
    readFileSync(join(fontraOut, "Test.fontra", "glyphs", "n.json"), "utf-8"),
    /xyz\.dg4\.stroke/
  );
});

test("a glyph that twists in some sources only gets a warning", () => {
  const folder = tempFolder();
  const out = tempFolder();
  // Copy the fixtures with a much wider Bold
  for (const [path, text] of Object.entries(snapshot(fixtures))) {
    const target = join(folder, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
      target,
      path.endsWith(join("Test-Bold.ufo", "glyphs", "n.glif"))
        ? text.replace("<integer>160</integer>", "<integer>300</integer>")
        : text
    );
  }
  const report = expandDesignspace(
    join(folder, "designspace", "Test.designspace"),
    out
  );
  assert.equal(report.warnings.length, 1);
  assert.match(report.warnings[0], /^n, contour 1: twists in some sources only/);
  assert.equal(report.twists.length, 1);
  assert.match(report.twists[0], /^n \(Bold\), contour 1: twists around \(250, \d+\)/);
});

test("points are stroked with their own widths", () => {
  const folder = tempFolder();
  const out = tempFolder();
  const lib = `<key>xyz.fontra.glyph.source.customData</key>
      <dict><key>xyz.dg4.stroke</key><dict><key>points</key><dict>
        <key>dot</key><dict><key>width</key><integer>300</integer></dict>
      </dict></dict></dict>`;
  for (const [path, text] of Object.entries(snapshot(fixtures))) {
    const target = join(folder, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
      target,
      path.endsWith(join("Test-Light.ufo", "glyphs", "period.glif"))
        ? text
            .replace('type="move"/>', 'type="move" identifier="dot"/>')
            .replace("<dict>\n    </dict>", `<dict>${lib}</dict>`)
        : text
    );
  }
  assert.equal(
    readGlif(
      readFileSync(
        join(folder, "ufos", "Test-Light.ufo", "glyphs", "period.glif"),
        "utf-8"
      )
    ).outline[0].contour.points[0].attrs.identifier,
    "dot"
  );
  const report = expandDesignspace(
    join(folder, "designspace", "Test.designspace"),
    out
  );
  assert.deepEqual(report.warnings, []);
  const dot = readGlif(
    readFileSync(join(out, "Test-Light.ufo", "glyphs", "period.glif"), "utf-8")
  ).outline[0].contour;
  assert.equal(Math.max(...dot.points.map((p) => p.x)), 250);
});

test("closed contours marked as centerlines are stroked, in every source", () => {
  const folder = tempFolder();
  const out = tempFolder();
  // Mark the square of o as a centerline in the default source (Light) only
  const lib = `<lib><dict><key>xyz.fontra.glyph.source.customData</key>
      <dict><key>xyz.dg4.stroke</key><dict><key>points</key><dict>
        <key>s1</key><dict><key>centerline</key><true/></dict>
      </dict></dict></dict></dict></lib>`;
  for (const [path, text] of Object.entries(snapshot(fixtures))) {
    const target = join(folder, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
      target,
      path.endsWith(join("Test-Light.ufo", "glyphs", "o.glif"))
        ? text
            .replace(
              '<point x="100" y="0" type="line"/>',
              '<point x="100" y="0" type="line" identifier="s1"/>'
            )
            .replace("</outline>", `</outline>${lib}`)
        : text
    );
  }
  const report = expandDesignspace(
    join(folder, "designspace", "Test.designspace"),
    out
  );
  assert.deepEqual(report.warnings, []);
  const outlines = ["Test-Light.ufo", "Test-Bold.ufo"].map(
    (ufo) => readGlif(readFileSync(join(out, ufo, "glyphs", "o.glif"), "utf-8")).outline
  );
  // 4 bands and 4 joins instead of the square
  for (const outline of outlines) {
    assert.equal(outline.length, 8);
  }
  assert.equal(
    outlineSignature(outlines[0].map((item) => item.contour)),
    outlineSignature(outlines[1].map((item) => item.contour))
  );
});

test("glyphs of the nib method are stroked with each source's nib", () => {
  for (const shape of ["ellipse", "rect"]) {
    const folder = tempFolder();
    const out = tempFolder();
    // n draws with a nib: smaller and turned in the Medium layer, larger in Bold
    const nibs = { Light: [60, 20, 30], medium: [100, 30, 80], Bold: [160, 50, 150] };
    for (const [path, text] of Object.entries(snapshot(fixtures))) {
      const target = join(folder, path);
      mkdirSync(dirname(target), { recursive: true });
      const source = path.endsWith(join("Test-Light.ufo", "glyphs", "n.glif"))
        ? "Light"
        : path.endsWith(join("glyphs.medium", "n.glif"))
          ? "medium"
          : path.endsWith(join("Test-Bold.ufo", "glyphs", "n.glif"))
            ? "Bold"
            : null;
      let written = text;
      if (source) {
        const [major, minor, angle] = nibs[source];
        written = written.replace(
          /<key>defaults<\/key>\s*<dict>/,
          `<key>defaults</key><dict><key>major</key><integer>${major}</integer>` +
            `<key>minor</key><integer>${minor}</integer>` +
            `<key>angle</key><integer>${angle}</integer>`
        );
      }
      if (source === "Light") {
        written = written.replace(
          "<key>fontra.glyph.locked</key>",
          `<key>xyz.dg4.stroke</key><dict><key>type</key><string>nib</string>` +
            `<key>shape</key><string>${shape}</string></dict>` +
            "<key>fontra.glyph.locked</key>"
        );
      }
      writeFileSync(target, written);
    }
    const report = expandDesignspace(
      join(folder, "designspace", "Test.designspace"),
      out
    );
    // (The larger nibs twist in the arch, which the other test covers)
    assert.ok(report.warnings.every((w) => /twists in some sources only/.test(w)));
    const outlines = [
      join("Test-Light.ufo", "glyphs", "n.glif"),
      join("Test-Light.ufo", "glyphs.medium", "n.glif"),
      join("Test-Bold.ufo", "glyphs", "n.glif"),
    ].map((path) =>
      readGlif(readFileSync(join(out, path), "utf-8"))
        .outline.filter((item) => item.contour)
        .map((item) => item.contour)
    );
    const signatures = outlines.map((contours) => outlineSignature(contours));
    assert.ok(
      signatures.every((signature) => signature === signatures[0]),
      shape
    );
    // The stroke goes up to the top of the arch (y 225) plus half the nib's
    // height there; the Light nib is at most 30 high, Bold's at most 80
    const top = (contours) =>
      Math.max(...contours.flatMap((c) => c.points.map((p) => p.y)));
    assert.ok(top(outlines[0]) < 225 + 31 + 1 && top(outlines[2]) > 225 + 31);
  }
});

test("--remove-stroke-data leaves no stroke settings in the UFOs", () => {
  const out = tempFolder();
  const kept = tempFolder();
  expandDesignspace(designspace, out, { removeStrokeData: true });
  expandDesignspace(designspace, kept);
  const files = snapshot(out);
  for (const [path, text] of Object.entries(files)) {
    assert.doesNotMatch(text, /xyz\.dg4\.stroke/, path);
  }
  // The outlines are the same as without it
  const keptFiles = snapshot(kept);
  for (const [path, text] of Object.entries(files)) {
    if (path.endsWith(".glif")) {
      assert.deepEqual(
        readGlif(text).outline.map((item) => item.contour),
        readGlif(keptFiles[path]).outline.map((item) => item.contour)
      );
    }
  }
  // Other customData stays; customData left empty goes, as Fontra writes it
  const lib = readGlif(files[join("Test-Light.ufo", "glyphs", "n.glif")]).lib;
  assert.deepEqual(lib["xyz.fontra.customData"], { "fontra.glyph.locked": true });
  assert.equal(lib["xyz.fontra.glyph.source.customData"], undefined);
  assert.equal(lib["public.truetype.overlap"], true);
  // Without the option, the settings are kept
  assert.match(
    keptFiles[join("Test-Bold.ufo", "glyphs", "n.glif")],
    /xyz\.dg4\.stroke/
  );
});

test("glifs: entries are removed from the lib", () => {
  const glif = (dict) =>
    `<glyph name="x" format="2">\n  <outline/>\n  <lib>\n    <dict>\n${dict}    </dict>\n  </lib>\n</glyph>\n`;
  const stroke =
    "        <key>xyz.dg4.stroke</key>\n        <dict>\n" +
    "          <key>points</key>\n          <dict>\n" +
    "            <key>a</key>\n            <dict/>\n          </dict>\n        </dict>\n";
  const other = "        <key>other</key>\n        <real>1.0</real>\n";
  const entry = (content) =>
    `      <key>xyz.fontra.customData</key>\n      <dict>\n${content}      </dict>\n`;
  const keys = ["xyz.fontra.customData", "xyz.dg4.stroke"];
  // Another entry of the same dict stays, as it was
  assert.equal(removeLibEntry(glif(entry(stroke + other)), keys), glif(entry(other)));
  assert.equal(removeLibEntry(glif(entry(other + stroke)), keys), glif(entry(other)));
  // A dict left empty goes too, but not the lib's
  const last = "      <key>last</key>\n      <true/>\n";
  assert.equal(removeLibEntry(glif(entry(stroke) + last), keys), glif(last));
  assert.equal(removeLibEntry(glif(entry(stroke)), keys), glif(""));
  // Nothing to remove
  for (const text of [glif(entry(other)), glif(""), '<glyph name="x"/>']) {
    assert.equal(removeLibEntry(text, keys), text);
  }
  // A key of the same name further down is not the entry
  const nested = glif(
    entry("        <key>deeper</key>\n        <dict>\n" + stroke + "        </dict>\n")
  );
  assert.equal(removeLibEntry(nested, keys), nested);
});

// The glyph in each source, by source name, from a .fontra glyph file
function fontraLayers(path) {
  const glyph = JSON.parse(readFileSync(path, "utf-8"));
  return Object.fromEntries(
    glyph.sources.map((source) => [
      source.name || source.locationBase,
      glyph.layers[source.layerName].glyph,
    ])
  );
}

test("a .fontra font is copied with its centerlines expanded in every source", () => {
  const before = snapshot(fixtures);
  const out = tempFolder();
  const report = expandFontra(fontra, out);
  assert.deepEqual(snapshot(fixtures), before);
  assert.equal(report.glyphs, 2); // n and period
  assert.deepEqual(report.warnings, []);
  assert.equal(report.output, join(out, "Test.fontra"));
  assert.deepEqual(readdirSync(out), ["Test.fontra"]);
  const input = snapshot(fontra);
  const copy = snapshot(join(out, "Test.fontra"));
  assert.deepEqual(Object.keys(copy).sort(), Object.keys(input).sort());
  // Files without centerlines are copied as they are
  for (const path of ["font-data.json", "glyph-info.csv", join("glyphs", "o.json")]) {
    assert.equal(copy[path], input[path]);
  }
  // Glyphs are written the way Fontra writes them
  const nText = copy[join("glyphs", "n.json")];
  assert.equal(nText, serializeFontraJSON(JSON.parse(nText)));

  const layers = fontraLayers(join(out, "Test.fontra", "glyphs", "n.json"));
  const glyphs = [layers.light, layers.Medium, layers.bold];
  const signatures = glyphs.map((glyph) => outlineSignature(glyph.path.contours));
  assert.equal(new Set(signatures).size, 1);
  for (const glyph of glyphs) {
    // band + two caps, then the closed contour that was already there
    assert.equal(glyph.path.contours.length, 4);
    assert.ok(glyph.path.contours.every((contour) => contour.isClosed));
    for (const contour of glyph.path.contours.slice(0, 3)) {
      assert.ok(signedArea(contour) > 0);
    }
    assert.deepEqual(glyph.components, [
      { name: "period", transformation: { translateX: 250, translateY: 400 } },
    ]);
    assert.equal(glyph.xAdvance, 500);
  }
  // Cap from the default source (Light, though Bold comes first): the Bold
  // source's own "square" is ignored
  assert.equal(layers.bold.path.contours[1].points.length, 12);
  // Width per source: Light 40, Bold 160
  const xs = (glyph) => glyph.path.contours[0].points.map((p) => p.x);
  assert.equal(Math.min(...xs(layers.light)), 80);
  assert.equal(Math.min(...xs(layers.bold)), 20);
  // A layer that is not a source's is left as it is, and the stroke settings
  // are kept
  const original = JSON.parse(input[join("glyphs", "n.json")]);
  const expanded = JSON.parse(nText);
  assert.deepEqual(
    expanded.layers["light^background"],
    original.layers["light^background"]
  );
  assert.deepEqual(expanded.customData, original.customData);
  assert.deepEqual(
    expanded.sources.map((source) => source.customData),
    original.sources.map((source) => source.customData)
  );

  const period = fontraLayers(join(out, "Test.fontra", "glyphs", "period.json"));
  assert.equal(period.light.path.contours.length, 1);
  assert.equal(period.light.path.contours[0].points.length, 12);
});

test("--remove-stroke-data leaves no stroke settings in the .fontra copy", () => {
  const out = tempFolder();
  expandFontra(fontra, out, { removeStrokeData: true });
  const glyph = JSON.parse(
    readFileSync(join(out, "Test.fontra", "glyphs", "n.json"), "utf-8")
  );
  assert.doesNotMatch(JSON.stringify(glyph), /xyz\.dg4\.stroke/);
  assert.deepEqual(glyph.customData, { "fontra.glyph.locked": true });
  assert.ok(glyph.sources.every((source) => !("customData" in source)));
  assert.equal(glyph.layers.light.glyph.path.contours.length, 4);
});

test("an inactive .fontra source is stroked on its own", () => {
  const folder = join(tempFolder(), "Test.fontra");
  const out = tempFolder();
  for (const [path, text] of Object.entries(snapshot(fontra))) {
    const target = join(folder, path);
    mkdirSync(dirname(target), { recursive: true });
    let written = text;
    if (path === join("glyphs", "n.json")) {
      // Medium is inactive, and has lost the closed contour
      const glyph = JSON.parse(text);
      glyph.sources[2].inactive = true;
      glyph.layers.medium.glyph.path.contours.pop();
      written = JSON.stringify(glyph);
    }
    writeFileSync(target, written);
  }
  const report = expandFontra(folder, out);
  assert.deepEqual(report.warnings, []);
  const layers = fontraLayers(join(out, "Test.fontra", "glyphs", "n.json"));
  assert.equal(layers.Medium.path.contours.length, 3);
  assert.ok(layers.Medium.path.contours.every((contour) => contour.isClosed));
  assert.equal(
    outlineSignature(layers.light.path.contours),
    outlineSignature(layers.bold.path.contours)
  );
});

test("the default source of a .fontra glyph", () => {
  const fontData = {
    axes: {
      axes: [
        {
          name: "Weight",
          defaultValue: 400,
          mapping: [
            [100, 10],
            [400, 40],
            [900, 90],
          ],
        },
        { name: "Width", defaultValue: 100 },
      ],
    },
    sources: { a: { location: { Weight: 10 } }, b: { location: { Weight: 40 } } },
  };
  const glyph = (sources, axes) => ({ sources, axes });
  // Weight 40 in source space; Width at its default when not given
  assert.equal(
    defaultSourceIndex(
      glyph([{ locationBase: "a" }, { locationBase: "b", location: { Width: 100 } }]),
      fontData
    ),
    1
  );
  // Inactive sources are skipped
  assert.equal(
    defaultSourceIndex(
      glyph([{ locationBase: "b", inactive: true }, { location: { Weight: 40 } }]),
      fontData
    ),
    1
  );
  // A glyph axis is at its own default, also when a font axis has its name
  assert.equal(
    defaultSourceIndex(
      glyph(
        [
          { locationBase: "b", location: { Width: 100 } },
          { locationBase: "b", location: { Width: 0 } },
        ],
        [{ name: "Width", minValue: 0, defaultValue: 0, maxValue: 100 }]
      ),
      fontData
    ),
    1
  );
  // No source at the default location: the first
  assert.equal(defaultSourceIndex(glyph([{ locationBase: "a" }]), fontData), 0);
});

test("JSON is written as Fontra writes it", () => {
  // Python: json.dumps(value, indent=0, ensure_ascii=False)
  assert.equal(
    serializeFontraJSON({
      a: [1, { b: "é", t: true, n: null }],
      c: {},
      d: [],
      e: -0.5,
      u: undefined,
    }),
    '{\n"a": [\n1,\n{\n"b": "é",\n"t": true,\n"n": null\n}\n],\n"c": {},\n"d": [],\n"e": -0.5\n}\n'
  );
});
