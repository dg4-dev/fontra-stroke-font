// The font open in Fontra as the files of a designspace and its UFOs, held
// in memory, so that the download from the editor can expand them with the
// same code as the CLI. No DOM dependencies: everything is read through
// Fontra's font controller, whatever format the font is saved in.
//
// The data goes where Fontra's own designspace backend puts it
// (fontra/backends/designspace.py): each font source that is not sparse
// gets a UFO, and each sparse one a layer in the default source's UFO. A
// glyph's source at a font source goes to that source's layer, with the
// glyph's customData (in the default source) and the source's customData in
// the glyph's lib, under the same keys. The copy is meant for building:
// glyph-level axes and sources, layers that are not sources, background
// images and guidelines of the font are left out. Fontra does not keep a
// designspace's instances, so the copy gets one at each source.

import { GLYPH_CUSTOM_DATA_KEY, SOURCE_CUSTOM_DATA_KEY } from "../cli/expand-font.js";
import { designspaceXML, mapValue } from "../cli/formats/designspace.js";
import { glifXML } from "../cli/formats/glif.js";
import { plistXML } from "../cli/formats/plist.js";
import { userNameToFileName } from "../cli/formats/ufo.js";

const VARIABLE_COMPONENTS_KEY = "com.black-foundry.variable-components";
const GLYPH_NOTE_KEY = "fontra.glyph.note";
const FEATURE_TAGS_KEY = "com.github.fonttools.varLib.featureVarsFeatureTag";
const CROSS_AXIS_MAPPING_INFO_KEY = "xyz.fontra.cross-axis-mapping-info";

// Fontra's font info → UFO fontinfo (fontInfoNameMapping in designspace.py)
const FONT_INFO_NAMES = [
  ["familyName", "familyName"],
  ["versionMajor", "versionMajor"],
  ["versionMinor", "versionMinor"],
  ["copyright", "copyright"],
  ["trademark", "trademark"],
  ["description", "openTypeNameDescription"],
  ["sampleText", "openTypeNameSampleText"],
  ["designer", "openTypeNameDesigner"],
  ["designerURL", "openTypeNameDesignerURL"],
  ["manufacturer", "openTypeNameManufacturer"],
  ["manufacturerURL", "openTypeNameManufacturerURL"],
  ["licenseDescription", "openTypeNameLicense"],
  ["licenseInfoURL", "openTypeNameLicenseURL"],
  ["vendorID", "openTypeOS2VendorID"],
];

// UFO fontinfo attributes that Fontra keeps in the font info's customData
// (ufoInfoAttributesToRoundTripFamilyLevel)
const FAMILY_INFO_KEYS = new Set([
  "openTypeNameUniqueID",
  "openTypeHeadCreated",
  "openTypeNameVersion",
  "openTypeNamePreferredFamilyName",
  "openTypeNameWWSFamilyName",
  "openTypeOS2CodePageRanges",
  "openTypeOS2UnicodeRanges",
  "openTypeOS2FamilyClass",
  "openTypeOS2Type",
  "postscriptWindowsCharacterSet",
  "openTypeOS2Panose",
  "openTypeOS2Selection",
  "openTypeOS2WeightClass",
  "openTypeOS2WidthClass",
]);

// ... and in each font source's customData (ufoInfoAttributesToRoundTrip)
const SOURCE_INFO_KEYS = new Set([
  "openTypeHheaAscender",
  "openTypeHheaCaretOffset",
  "openTypeHheaCaretSlopeRise",
  "openTypeHheaCaretSlopeRun",
  "openTypeHheaDescender",
  "openTypeHheaLineGap",
  "openTypeOS2StrikeoutPosition",
  "openTypeOS2StrikeoutSize",
  "openTypeOS2SubscriptXOffset",
  "openTypeOS2SubscriptXSize",
  "openTypeOS2SubscriptYOffset",
  "openTypeOS2SubscriptYSize",
  "openTypeOS2SuperscriptXOffset",
  "openTypeOS2SuperscriptXSize",
  "openTypeOS2SuperscriptYOffset",
  "openTypeOS2SuperscriptYSize",
  "openTypeOS2TypoAscender",
  "openTypeOS2TypoDescender",
  "openTypeOS2TypoLineGap",
  "openTypeOS2WinAscent",
  "openTypeOS2WinDescent",
  "openTypeVheaCaretOffset",
  "openTypeVheaCaretSlopeRise",
  "openTypeVheaCaretSlopeRun",
  "openTypeVheaVertTypoLineGap",
  "postscriptUnderlinePosition",
  "postscriptUnderlineThickness",
  "openTypeNameCompatibleFullName",
  "openTypeNamePreferredSubfamilyName",
  "openTypeNameWWSSubfamilyName",
  "postscriptBlueFuzz",
  "postscriptBlueScale",
  "postscriptBlueShift",
  "postscriptBlueValues",
  "postscriptFamilyBlues",
  "postscriptFamilyOtherBlues",
  "postscriptForceBold",
  "postscriptIsFixedPitch",
  "postscriptOtherBlues",
  "postscriptSlantAngle",
  "postscriptStemSnapH",
  "postscriptStemSnapV",
]);

const LINE_METRICS = ["ascender", "capHeight", "xHeight", "descender"];
const VERTICAL_LINE_METRICS = {
  ascender: "openTypeVheaVertTypoAscender",
  descender: "openTypeVheaVertTypoDescender",
  lineGap: "openTypeVheaVertTypoLineGap",
};

// Glyphs read from Fontra at a time
const GLYPHS_AT_ONCE = 8;

/**
 * @param {object} fontController Fontra's font controller: glyphMap, axes,
 *   sources, unitsPerEm, customData, getGlyph(), getFontInfo(),
 *   getFeatures(), getKerning() and getConditionalSubstitutions() are used
 * @param {{name: string, onProgress?: (done: number, total: number) =>
 *   (void|Promise)}} options name: the name of the designspace (without
 *   ".designspace") and the start of the UFOs' names; onProgress is called
 *   (and awaited) after each group of glyphs read
 * @returns {Promise<{files: Map<string, string>, designspacePath: string,
 *   warnings: string[]}>} the files by their paths, joined with "/"
 */
export async function fontFiles(fontController, { name, onProgress }) {
  const axes = fontController.axes?.axes ?? [];
  const defaultLocation = Object.fromEntries(
    axes.map((axis) => [axis.name, mapValue(axis.defaultValue, axis.mapping ?? [])])
  );
  const sources = fontSourceList(fontController, axes, defaultLocation);
  const defaultSource = sources.find((source) => source.isDefault);
  const customData = fontController.customData ?? {};
  const glyphMap = fontController.glyphMap ?? {};
  const glyphOrder = glyphOrderOf(glyphMap, customData["public.glyphOrder"]);
  const warnings = [];

  // Where each source's glyphs go
  const takenUFONames = new Set();
  for (const source of sources) {
    if (!source.isSparse) {
      source.ufo = safeFileName(`${name}-${source.name}`, ".ufo", takenUFONames);
    }
  }
  const takenLayerNames = new Set(["public.default"]);
  const takenLayerDirectories = new Set(["glyphs"]);
  for (const source of sources) {
    if (source.isSparse) {
      source.ufo = defaultSource.ufo;
      source.layer = uniqueName(source.name, takenLayerNames);
      source.directory = userNameToFileName(
        source.layer,
        takenLayerDirectories,
        "glyphs."
      );
    } else {
      source.directory = "glyphs";
    }
    source.glyphs = [];
    source.takenFileNames = new Set();
  }
  const sourcesById = new Map(sources.map((source) => [source.id, source]));

  for (let start = 0; start < glyphOrder.length; start += GLYPHS_AT_ONCE) {
    const names = glyphOrder.slice(start, start + GLYPHS_AT_ONCE);
    const glyphs = await Promise.all(
      names.map((glyphName) => fontController.getGlyph(glyphName))
    );
    for (const [i, glyphName] of names.entries()) {
      const glyph = glyphs[i]?.glyph ?? glyphs[i];
      if (glyph) {
        addGlyph(glyphName, glyph, glyphMap[glyphName] ?? [], {
          sources,
          sourcesById,
          defaultSource,
          defaultLocation,
          warnings,
        });
      }
    }
    await onProgress?.(start + names.length, glyphOrder.length);
  }

  // (Older versions of Fontra may not have all of these)
  const fontInfo = (await callIfThere(fontController, "getFontInfo")) ?? {};
  const features = await callIfThere(fontController, "getFeatures");
  const kerning = (await callIfThere(fontController, "getKerning"))?.kern;
  const substitutions = await callIfThere(
    fontController,
    "getConditionalSubstitutions"
  );

  const familyName = fontInfo.familyName || name;
  const files = new Map();
  const designspacePath = `${name}.designspace`;
  files.set(
    designspacePath,
    designspaceXML({
      axes: axes.map(designspaceAxis),
      mappings: (fontController.axes?.mappings ?? [])
        .filter((mapping) => !mapping.inactive)
        .map((mapping) => ({
          description: mapping.description || undefined,
          input: mapping.inputLocation,
          output: mapping.outputLocation,
        })),
      ...designspaceRules(substitutions),
      sources: sources.map((source) => ({
        filename: source.ufo,
        name: source.uniqueName,
        familyname: familyName,
        stylename: source.name,
        layer: source.layer,
        location: source.location,
      })),
      // Fontra does not keep a designspace's instances: one at each source
      // that is not sparse, for static fonts (fontmake -i)
      instances: sources
        .filter((source) => !source.isSparse)
        .map((source) => ({
          name: `${familyName} ${source.name}`,
          familyname: familyName,
          stylename: source.name,
          filename: `instances/${source.ufo}`,
          location: source.location,
        })),
      lib: designspaceLib(customData, substitutions),
    })
  );
  const groups = kerningGroups(kerning);
  const ufoLib = {
    "public.glyphOrder": glyphOrder,
    ...Object.fromEntries(
      Object.entries(customData).filter(
        ([key]) => key.startsWith("public.") && key !== "public.glyphOrder"
      )
    ),
  };
  for (const source of sources.filter((source) => !source.isSparse)) {
    const ufo = source.ufo;
    files.set(
      `${ufo}/metainfo.plist`,
      plistXML({ creator: "xyz.dg4.fontra-stroke-font", formatVersion: 3 })
    );
    files.set(
      `${ufo}/fontinfo.plist`,
      plistXML(ufoFontInfo(fontInfo, familyName, source, fontController.unitsPerEm))
    );
    if (Object.keys(groups).length) {
      files.set(`${ufo}/groups.plist`, plistXML(groups));
    }
    const sourceKerning = kerningOfSource(kerning, source.id);
    if (Object.keys(sourceKerning).length) {
      files.set(`${ufo}/kerning.plist`, plistXML(sourceKerning));
    }
    files.set(`${ufo}/lib.plist`, plistXML(ufoLib));
    if (features?.language === "fea" && features.text) {
      files.set(`${ufo}/features.fea`, features.text);
    }
    const layers = sources.filter((other) => other.ufo === ufo);
    files.set(
      `${ufo}/layercontents.plist`,
      plistXML(
        layers.map((layer) => [layer.layer ?? "public.default", layer.directory])
      )
    );
    for (const layer of layers) {
      const directory = `${ufo}/${layer.directory}`;
      files.set(
        `${directory}/contents.plist`,
        plistXML(
          Object.fromEntries(layer.glyphs.map(([glyphName, file]) => [glyphName, file]))
        )
      );
      for (const [, file, text] of layer.glyphs) {
        files.set(`${directory}/${file}`, text);
      }
    }
  }
  return { files, designspacePath, warnings };
}

// The font sources, with dense locations, the default one marked (the one at
// the default location that is not sparse), and unique names for the
// designspace
function fontSourceList(fontController, axes, defaultLocation) {
  const entries = Object.entries(fontController.sources ?? {});
  if (!entries.length) {
    throw new Error("the font has no sources");
  }
  const axisNames = axes.map((axis) => axis.name);
  const sources = entries.map(([id, source]) => ({
    id,
    name: source.name || id,
    isSparse: !!source.isSparse,
    location: Object.fromEntries(
      axisNames.map((axisName) => [
        axisName,
        source.location?.[axisName] ?? defaultLocation[axisName],
      ])
    ),
    fontSource: source,
  }));
  const atDefault = (source) =>
    !source.isSparse &&
    axisNames.every(
      (axisName) => source.location[axisName] === defaultLocation[axisName]
    );
  const defaultSource =
    sources.find(atDefault) ??
    sources.find(
      (source) =>
        source.id === fontController.defaultSourceIdentifier && !source.isSparse
    ) ??
    sources.find((source) => !source.isSparse);
  if (!defaultSource) {
    throw new Error("the font has no source that is not sparse");
  }
  defaultSource.isDefault = true;
  const takenNames = new Set();
  for (const source of sources) {
    source.uniqueName = uniqueName(source.name, takenNames);
  }
  return sources;
}

function addGlyph(glyphName, glyph, unicodes, context) {
  const { sources, sourcesById, defaultSource, defaultLocation, warnings } = context;
  const axes = glyph.axes ?? [];
  const placed = new Map();
  let ownSources = axes.length > 0;
  for (const glyphSource of glyph.sources ?? []) {
    if (glyphSource.inactive) {
      continue;
    }
    const source = fontSourceOf(
      glyphSource,
      axes,
      sources,
      sourcesById,
      defaultLocation
    );
    if (!source) {
      ownSources = true;
    } else if (!placed.has(source) && glyph.layers?.[glyphSource.layerName]?.glyph) {
      placed.set(source, glyphSource);
    }
  }
  if (ownSources) {
    warnings.push(
      `${glyphName}: the glyph has axes or sources of its own, which are left out ` +
        `of the copy`
    );
  }
  // As Fontra: once a component of the glyph has axis values (in any source),
  // all of its components are kept in the lib as variable components
  const variableComponents = Object.values(glyph.layers ?? {}).some((layer) =>
    (layer.glyph?.components ?? []).some(
      (component) =>
        Object.keys(component.location ?? {}).length ||
        component.transformation?.tCenterX ||
        component.transformation?.tCenterY
    )
  );
  if (variableComponents) {
    warnings.push(
      `${glyphName}: components with axis values are kept in the glyph's lib ` +
        `(${VARIABLE_COMPONENTS_KEY}), where fontmake does not see them`
    );
  }
  const { [GLYPH_NOTE_KEY]: note, ...glyphCustomData } = glyph.customData ?? {};
  for (const [source, glyphSource] of placed) {
    const isDefault = source === defaultSource;
    const layerGlyph = glyph.layers[glyphSource.layerName].glyph;
    const components = (layerGlyph.components ?? []).map((component) => ({
      base: component.name,
      transform: affineTransform(component.transformation),
    }));
    const text = glifXML({
      name: glyphName,
      unicodes,
      width: layerGlyph.xAdvance,
      height: layerGlyph.yAdvance,
      note: isDefault ? note : undefined,
      guidelines: (layerGlyph.guidelines ?? []).map((guideline) => ({
        x: guideline.x ?? 0,
        y: guideline.y ?? 0,
        angle: ((((guideline.angle ?? 0) % 360) + 360) % 360) + 0,
        name: guideline.name,
      })),
      anchors: layerGlyph.anchors ?? [],
      contours: ufoContours(layerGlyph.path),
      components: variableComponents ? [] : components,
      lib: {
        [GLYPH_CUSTOM_DATA_KEY]:
          isDefault && Object.keys(glyphCustomData).length
            ? glyphCustomData
            : undefined,
        [SOURCE_CUSTOM_DATA_KEY]: Object.keys(glyphSource.customData ?? {}).length
          ? glyphSource.customData
          : undefined,
        "public.verticalOrigin": layerGlyph.verticalOrigin ?? undefined,
        [VARIABLE_COMPONENTS_KEY]: variableComponents
          ? (layerGlyph.components ?? []).map((component) => ({
              base: component.name,
              location: component.location ?? {},
              transformation: component.transformation,
            }))
          : undefined,
      },
    });
    const file = userNameToFileName(glyphName, source.takenFileNames, "", ".glif");
    source.glyphs.push([glyphName, file, text]);
  }
}

// The font source a glyph source belongs to: the one it is based on, or the
// one at its location, when it is not off that source along any axis (the
// glyph's own axes at their defaults)
function fontSourceOf(glyphSource, axes, sources, sourcesById, defaultLocation) {
  const location = glyphSource.location ?? {};
  const localNames = new Set(axes.map((axis) => axis.name));
  if (
    axes.some(
      (axis) => (location[axis.name] ?? axis.defaultValue) !== axis.defaultValue
    )
  ) {
    return undefined;
  }
  const global = Object.entries(location).filter(
    ([axisName]) => !localNames.has(axisName) && axisName in defaultLocation
  );
  const base = sourcesById.get(glyphSource.locationBase);
  if (base) {
    return global.every(([axisName, value]) => base.location[axisName] === value)
      ? base
      : undefined;
  }
  const dense = { ...defaultLocation, ...Object.fromEntries(global) };
  return sources.find((source) =>
    Object.entries(dense).every(
      ([axisName, value]) => source.location[axisName] === value
    )
  );
}

/**
 * The contours of a Fontra path as Fontra writes them to a UFO
 * (PackedPath.drawPoints() in fontra/core/path.py): the middle points of
 * runs of three or more cubic off-curve points are left out, and so are
 * off-curve points at the ends of an open contour.
 */
export function ufoContours(path) {
  const contours = [];
  for (let i = 0; i < (path?.numContours ?? 0); i++) {
    const { points, isClosed } = path.getUnpackedContour(i);
    let kept = dropSpuriousOffCurves(points, isClosed);
    if (!isClosed) {
      const first = kept.findIndex((point) => !point.type);
      const last = kept.findLastIndex((point) => !point.type);
      kept = first < 0 ? [] : kept.slice(first, last + 1);
    }
    if (kept.length) {
      contours.push({
        isClosed,
        points: kept.map(({ x, y, type, smooth, attrs }) => {
          const point = { x, y };
          if (type) {
            point.type = type;
          } else if (smooth) {
            point.smooth = true;
          }
          if (typeof attrs?.identifier === "string") {
            point.attrs = { identifier: attrs.identifier };
          }
          return point;
        }),
      });
    }
  }
  return contours;
}

// fixSpuriousCubicOffCurvePoints() in fontra/core/path.py
function dropSpuriousOffCurves(points, isClosed) {
  const firstOnCurve = points.findIndex((point) => !point.type);
  if (firstOnCurve < 0 || !points.some((point) => point.type === "cubic")) {
    return points;
  }
  const shift = isClosed ? firstOnCurve : 0;
  const shifted = [...points.slice(shift), ...points.slice(0, shift)];
  const kept = shifted.filter(
    (point, i) =>
      !(
        i > 0 &&
        i < shifted.length - 1 &&
        shifted[i - 1].type === "cubic" &&
        point.type === "cubic" &&
        shifted[i + 1].type === "cubic"
      )
  );
  // Start at the same point as before, if it is still there
  const start = kept.indexOf(points[0]);
  return start > 0 ? [...kept.slice(start), ...kept.slice(0, start)] : kept;
}

/**
 * A component's transformation as [xx, xy, yx, yy, dx, dy], as
 * decomposedToTransform() in Fontra's transform.js.
 */
export function affineTransform(transformation = {}) {
  const {
    translateX = 0,
    translateY = 0,
    rotation = 0,
    scaleX = 1,
    scaleY = 1,
    skewX = 0,
    skewY = 0,
    tCenterX = 0,
    tCenterY = 0,
  } = transformation;
  const angle = rotation * (Math.PI / 180);
  let t = [1, 0, 0, 1, 0, 0];
  t = transform(t, [1, 0, 0, 1, translateX + tCenterX, translateY + tCenterY]);
  t = transform(t, [
    Math.cos(angle),
    Math.sin(angle),
    -Math.sin(angle),
    Math.cos(angle),
    0,
    0,
  ]);
  t = transform(t, [scaleX, 0, 0, scaleY, 0, 0]);
  t = transform(t, [
    1,
    Math.tan(skewY * (Math.PI / 180)),
    Math.tan(skewX * (Math.PI / 180)),
    1,
    0,
    0,
  ]);
  return transform(t, [1, 0, 0, 1, -tCenterX, -tCenterY]);
}

// other applied first, then t (Transform.transform() in Fontra)
function transform([xx, xy, yx, yy, dx, dy], [a, b, c, d, e, f]) {
  return [
    a * xx + b * yx,
    a * xy + b * yy,
    c * xx + d * yx,
    c * xy + d * yy,
    xx * e + yx * f + dx,
    xy * e + yy * f + dy,
  ];
}

function designspaceAxis(axis) {
  const flag = (value) => (value ? "true" : undefined);
  return {
    name: axis.name,
    tag: axis.tag,
    ...(axis.values
      ? { values: axis.values }
      : { minimum: axis.minValue, maximum: axis.maxValue }),
    default: axis.defaultValue,
    hidden: axis.hidden,
    map: axis.mapping?.length ? axis.mapping : undefined,
    labels: (axis.valueLabels ?? []).map((label) => ({
      name: label.name,
      uservalue: label.value,
      userminimum: label.minValue,
      usermaximum: label.maxValue,
      linkeduservalue: label.linkedValue,
      elidable: flag(label.elidable),
      oldersibling: flag(label.olderSibling),
    })),
  };
}

function designspaceRules(substitutions) {
  const rules = (substitutions?.rules ?? []).map((rule) => ({
    name: rule.name,
    conditionSets: (rule.conditionSets ?? []).map((conditionSet) =>
      (conditionSet.conditions ?? []).map((condition) => ({
        name: condition.name,
        minimum: condition.minValue,
        maximum: condition.maxValue,
      }))
    ),
    substitutions: rule.substitutions ?? {},
  }));
  const tags = substitutions?.featureTags ?? ["rvrn"];
  return {
    rules,
    rulesProcessingLast: !(tags.length === 1 && tags[0] === "rvrn"),
  };
}

function designspaceLib(customData, substitutions) {
  const lib = { ...customData };
  // Inactive mappings are not written, so their indices would be wrong
  delete lib[CROSS_AXIS_MAPPING_INFO_KEY];
  const tags = substitutions?.featureTags;
  if (
    substitutions?.rules?.length &&
    tags?.length &&
    tags.join() !== "rvrn" &&
    tags.join() !== "rclt" &&
    lib[FEATURE_TAGS_KEY] === undefined
  ) {
    lib[FEATURE_TAGS_KEY] = tags.join(",");
  }
  return lib;
}

function ufoFontInfo(fontInfo, familyName, source, unitsPerEm) {
  const info = {};
  for (const [fontraName, ufoName] of FONT_INFO_NAMES) {
    if (fontInfo[fontraName] !== undefined && fontInfo[fontraName] !== null) {
      info[ufoName] = fontInfo[fontraName];
    }
  }
  info.familyName = familyName;
  info.styleName = source.name;
  if (unitsPerEm) {
    info.unitsPerEm = unitsPerEm;
  }
  for (const [key, value] of Object.entries(fontInfo.customData ?? {})) {
    if (FAMILY_INFO_KEYS.has(key)) {
      info[key] = value;
    }
  }
  const fontSource = source.fontSource;
  for (const key of LINE_METRICS) {
    const value = fontSource.lineMetricsHorizontalLayout?.[key]?.value;
    if (typeof value === "number") {
      info[key] = value;
    }
  }
  for (const [key, ufoName] of Object.entries(VERTICAL_LINE_METRICS)) {
    const value = fontSource.lineMetricsVerticalLayout?.[key]?.value;
    if (typeof value === "number") {
      info[ufoName] = Math.round(value);
    }
  }
  if (typeof fontSource.italicAngle === "number") {
    info.italicAngle = fontSource.italicAngle;
  }
  for (const [key, value] of Object.entries(fontSource.customData ?? {})) {
    if (SOURCE_INFO_KEYS.has(key)) {
      info[key] = value;
    }
  }
  return info;
}

// Fontra names kerning groups "@name" on each side; UFO prefixes them
function kerningGroups(kerning) {
  return {
    ...Object.fromEntries(
      Object.entries(kerning?.groupsSide1 ?? {}).map(([group, glyphs]) => [
        `public.kern1.${group}`,
        glyphs,
      ])
    ),
    ...Object.fromEntries(
      Object.entries(kerning?.groupsSide2 ?? {}).map(([group, glyphs]) => [
        `public.kern2.${group}`,
        glyphs,
      ])
    ),
  };
}

function kerningOfSource(kerning, sourceId) {
  const index = kerning?.sourceIdentifiers?.indexOf(sourceId) ?? -1;
  if (index < 0) {
    return {};
  }
  const pairs = {};
  for (const [left, rights] of Object.entries(kerning.values ?? {})) {
    const first = left.startsWith("@") ? `public.kern1.${left.slice(1)}` : left;
    for (const [right, values] of Object.entries(rights)) {
      const value = values?.[index];
      if (typeof value === "number") {
        const second = right.startsWith("@") ? `public.kern2.${right.slice(1)}` : right;
        (pairs[first] ??= {})[second] = value;
      }
    }
  }
  return pairs;
}

// The glyphs in the order of public.glyphOrder, then the others in the order
// of the glyph map
function glyphOrderOf(glyphMap, order) {
  const names = Object.keys(glyphMap);
  const known = new Set(names);
  const ordered = Array.isArray(order) ? order.filter((n) => known.has(n)) : [];
  const listed = new Set(ordered);
  return [...new Set(ordered), ...names.filter((n) => !listed.has(n))];
}

function uniqueName(name, taken) {
  let unique = name;
  for (let counter = 2; taken.has(unique); counter++) {
    unique = `${name} ${counter}`;
  }
  taken.add(unique);
  return unique;
}

// A file name that works on any system: characters that some systems do not
// allow become "_"; names taken (in any case) get a number
export function safeFileName(name, extension, taken) {
  const body =
    name
      .replace(/[\u0000-\u001f\u007f"*/:<>?\\|]/g, "_")
      .replace(/^[\s.]+|[\s.]+$/g, "") || "font";
  let fileName = `${body}${extension}`;
  for (let counter = 2; taken.has(fileName.toLowerCase()); counter++) {
    fileName = `${body} ${counter}${extension}`;
  }
  taken.add(fileName.toLowerCase());
  return fileName;
}

async function callIfThere(object, method) {
  return typeof object[method] === "function" ? await object[method]() : undefined;
}
