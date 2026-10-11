// Reading the parts of a .designspace file that the CLI needs: the axes, and
// the sources with their UFO, layer and location.

import { childElements, firstChild, parseXML } from "./xml.js";

/**
 * @param {string} text the .designspace XML
 * @returns {{axes: {name: string, default: number}[], sources: {name: string,
 *   filename: string, layer: string|null, location: object, isDefault: boolean}[]}}
 *   axis defaults and source locations in design coordinates; a source's name
 *   is its style name when it has one, for messages
 */
export function parseDesignspace(text) {
  const root = parseXML(text);
  if (root.name !== "designspace") {
    throw new Error("not a .designspace file");
  }
  const axes = childElements(firstChild(root, "axes") ?? { children: [] }, "axis").map(
    parseAxis
  );
  const sourcesElement = firstChild(root, "sources");
  const sources = childElements(sourcesElement ?? { children: [] }, "source").map(
    (element, index) => {
      const location = {};
      const locationElement = firstChild(element, "location");
      for (const dimension of childElements(
        locationElement ?? { children: [] },
        "dimension"
      )) {
        const { name, xvalue } = dimension.attributes;
        location[name] = Number(xvalue);
      }
      return {
        name:
          element.attributes.stylename ??
          element.attributes.name ??
          `source${index + 1}`,
        filename: element.attributes.filename,
        layer: element.attributes.layer ?? null,
        location,
      };
    }
  );
  const defaultLocation = Object.fromEntries(
    axes.map((axis) => [axis.name, axis.default])
  );
  for (const source of sources) {
    source.isDefault = axes.every(
      (axis) =>
        (source.location[axis.name] ?? axis.default) === defaultLocation[axis.name]
    );
  }
  return { axes, sources };
}

function parseAxis(element) {
  const { name, default: userDefault, values } = element.attributes;
  const maps = childElements(element, "map").map((map) => [
    Number(map.attributes.input),
    Number(map.attributes.output),
  ]);
  const value = Number(userDefault ?? values?.trim().split(/\s+/)[0] ?? 0);
  return { name, default: mapValue(value, maps) };
}

// Piecewise linear user-to-design mapping, as in the designspace spec
export function mapValue(value, maps) {
  if (!maps.length) {
    return value;
  }
  const sorted = [...maps].sort((a, b) => a[0] - b[0]);
  if (value <= sorted[0][0]) {
    return sorted[0][1] + (value - sorted[0][0]);
  }
  if (value >= sorted.at(-1)[0]) {
    return sorted.at(-1)[1] + (value - sorted.at(-1)[0]);
  }
  for (let i = 1; i < sorted.length; i++) {
    const [x1, y1] = sorted[i];
    if (value <= x1) {
      const [x0, y0] = sorted[i - 1];
      return y0 + ((value - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return value;
}
