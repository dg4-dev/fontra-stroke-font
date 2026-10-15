// Stand-ins for Fontra's font controller, so that the download from the
// editor can be compared with the CLI on the same font: one made from a
// designspace and its UFOs on disk the way Fontra's designspace backend
// reads them, and one serving data that Fontra's backend has served.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { GLYPH_CUSTOM_DATA_KEY, SOURCE_CUSTOM_DATA_KEY } from "../cli/expand-font.js";
import { parseXMLPlist } from "../cli/formats/plist.js";
import { readGlif } from "../cli/formats/glif.js";
import { layerGlyphFiles } from "../cli/formats/ufo.js";
import { childElements, firstChild, parseXML } from "../cli/formats/xml.js";

const read = (path) => (existsSync(path) ? readFileSync(path, "utf-8") : undefined);

/**
 * @param {string} designspacePath
 * @returns {object} glyphMap, axes, sources, unitsPerEm, customData,
 *   getGlyph(), getFontInfo(), getFeatures(), getKerning() as Fontra's
 */
export function fakeFontController(designspacePath) {
  const root = parseXML(readFileSync(designspacePath, "utf-8"));
  const axes = childElements(firstChild(root, "axes"), "axis").map((element) => {
    const { name, tag, minimum, maximum } = element.attributes;
    const mapping = childElements(element, "map").map((map) => [
      Number(map.attributes.input),
      Number(map.attributes.output),
    ]);
    return {
      name,
      label: name,
      tag,
      minValue: Number(minimum),
      defaultValue: Number(element.attributes.default),
      maxValue: Number(maximum),
      mapping,
      valueLabels: [],
      hidden: false,
    };
  });
  const sources = childElements(firstChild(root, "sources"), "source").map(
    (element) => {
      const location = {};
      for (const dimension of childElements(
        firstChild(element, "location"),
        "dimension"
      )) {
        location[dimension.attributes.name] = Number(dimension.attributes.xvalue);
      }
      const ufoPath = resolve(dirname(designspacePath), element.attributes.filename);
      const layer = element.attributes.layer ?? null;
      return {
        id: element.attributes.name,
        name: element.attributes.stylename,
        location,
        isSparse: layer !== null,
        ufoPath,
        glyphFiles: layerGlyphFiles(read, ufoPath, layer),
      };
    }
  );
  const defaultSource = sources[0];
  const info = parseXMLPlist(read(join(defaultSource.ufoPath, "fontinfo.plist")));

  const glyphMap = {};
  for (const source of sources) {
    for (const [glyphName, path] of source.glyphFiles) {
      if (!(glyphName in glyphMap)) {
        glyphMap[glyphName] = childElements(parseXML(read(path)), "unicode").map(
          (unicode) => parseInt(unicode.attributes.hex, 16)
        );
      }
    }
  }

  const fontSources = Object.fromEntries(
    sources.map((source) => {
      const sourceInfo = source.isSparse
        ? {}
        : parseXMLPlist(read(join(source.ufoPath, "fontinfo.plist")));
      const metric = (key) =>
        sourceInfo[key] === undefined ? undefined : { value: sourceInfo[key], zone: 0 };
      return [
        source.id,
        {
          name: source.name,
          location: source.location,
          isSparse: source.isSparse,
          italicAngle: 0,
          lineMetricsHorizontalLayout: source.isSparse
            ? {}
            : {
                ascender: metric("ascender"),
                descender: metric("descender"),
                xHeight: metric("xHeight") ?? { value: 500, zone: 16 },
                capHeight: metric("capHeight") ?? { value: 750, zone: 16 },
                baseline: { value: 0, zone: -16 },
              },
          lineMetricsVerticalLayout: {},
          guidelines: [],
          customData: {},
        },
      ];
    })
  );

  return {
    glyphMap,
    axes: { axes, mappings: [] },
    sources: fontSources,
    unitsPerEm: info.unitsPerEm,
    customData: {},
    async getFontInfo() {
      return { familyName: info.familyName, customData: {} };
    },
    async getFeatures() {
      return { language: "fea", text: "" };
    },
    async getKerning() {
      return {};
    },
    async getConditionalSubstitutions() {
      return { featureTags: ["rvrn"], rules: [] };
    },
    async getGlyph(glyphName) {
      if (!(glyphName in glyphMap)) {
        return null;
      }
      const layers = {};
      const glyphSources = [];
      let customData = {};
      for (const source of sources) {
        const path = source.glyphFiles.get(glyphName);
        if (!path) {
          continue;
        }
        const text = read(path);
        const { outline, lib } = readGlif(text);
        const element = parseXML(text);
        const advance = firstChild(element, "advance")?.attributes ?? {};
        if (source === defaultSource) {
          customData = lib[GLYPH_CUSTOM_DATA_KEY] ?? {};
        }
        const contours = outline
          .filter((item) => item.contour)
          .map((item) => item.contour);
        layers[source.id] = {
          glyph: {
            path: {
              numContours: contours.length,
              getUnpackedContour: (i) => structuredClone(contours[i]),
            },
            components: outline
              .filter((item) => item.element.name === "component")
              .map(({ element: { attributes } }) => ({
                name: attributes.base,
                transformation: {
                  translateX: Number(attributes.xOffset ?? 0),
                  translateY: Number(attributes.yOffset ?? 0),
                  rotation: 0,
                  scaleX: Number(attributes.xScale ?? 1),
                  scaleY: Number(attributes.yScale ?? 1),
                  skewX: 0,
                  skewY: 0,
                  tCenterX: 0,
                  tCenterY: 0,
                },
                location: {},
                customData: {},
              })),
            xAdvance: Number(advance.width ?? 0),
            anchors: childElements(element, "anchor").map(({ attributes }) => ({
              name: attributes.name,
              x: Number(attributes.x),
              y: Number(attributes.y),
            })),
            guidelines: [],
          },
          customData: {},
        };
        glyphSources.push({
          name: "",
          locationBase: source.id,
          location: {},
          layerName: source.id,
          inactive: false,
          customData: lib[SOURCE_CUSTOM_DATA_KEY] ?? {},
        });
      }
      // As Fontra's VariableGlyphController
      return {
        glyph: { name: glyphName, axes: [], sources: glyphSources, layers, customData },
      };
    },
  };
}

/**
 * A font controller serving data as Fontra's backend sends it to the
 * browser (fontra.core.classes.unstructure(): values that are the defaults
 * left out, paths packed), with paths that unpack like Fontra's
 * VarPackedPath.
 * @param {{glyphMap: object, axes: object, sources: object, unitsPerEm:
 *   number, customData: object, fontInfo: object, kerning: object,
 *   features: object, glyphs: object}} data
 */
export function fontControllerFromData(data) {
  return {
    glyphMap: data.glyphMap,
    axes: { axes: [], mappings: [], ...data.axes },
    sources: data.sources,
    unitsPerEm: data.unitsPerEm,
    customData: data.customData,
    getFontInfo: async () => data.fontInfo,
    // As FontController.getFeatures()
    getFeatures: async () => ({ language: "fea", text: "", ...data.features }),
    getKerning: async () => data.kerning,
    async getGlyph(glyphName) {
      const glyph = structuredClone(data.glyphs[glyphName]);
      if (!glyph) {
        return null;
      }
      for (const layer of Object.values(glyph.layers)) {
        layer.glyph.path = packedPath(layer.glyph.path ?? {});
      }
      return { glyph };
    },
  };
}

// The parts of Fontra's VarPackedPath that the download reads
function packedPath({
  coordinates = [],
  pointTypes = [],
  contourInfo = [],
  pointAttributes,
}) {
  return {
    numContours: contourInfo.length,
    getUnpackedContour(index) {
      const start = index ? contourInfo[index - 1].endPoint + 1 : 0;
      const points = [];
      for (let i = start; i <= contourInfo[index].endPoint; i++) {
        const point = { x: coordinates[2 * i], y: coordinates[2 * i + 1] };
        // 0 on-curve, 1 quadratic, 2 cubic; 8 the smooth flag
        const type = pointTypes[i] & 0x07;
        if (type) {
          point.type = type === 2 ? "cubic" : "quad";
        } else if (pointTypes[i] & 0x08) {
          point.smooth = true;
        }
        if (pointAttributes?.[i]) {
          point.attrs = pointAttributes[i];
        }
        points.push(point);
      }
      return { points, isClosed: contourInfo[index].isClosed };
    },
  };
}
