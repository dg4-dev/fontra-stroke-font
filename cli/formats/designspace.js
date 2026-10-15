// Reading the parts of a .designspace file that the CLI needs: the axes, and
// the sources with their UFO, layer and location. Writing a .designspace
// file (designspaceXML() at the end).

import { plistValueXML } from "./plist.js";
import { childElements, escapeAttribute, firstChild, parseXML } from "./xml.js";

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

/**
 * A .designspace file (format 5).
 * @param {object} document
 * @param {{name: string, tag: string, minimum?: number, maximum?: number,
 *   values?: number[], default: number, hidden?: boolean, map?: number[][],
 *   labels?: object[]}[]} document.axes user coordinates; values for a
 *   discrete axis instead of minimum and maximum; map: [user, design] pairs;
 *   labels: attributes of <label> (name, uservalue, userminimum, ...)
 * @param {{description?: string, input: object, output: object}[]}
 *   [document.mappings] cross-axis mappings, in design coordinates
 * @param {{name: string, conditionSets: {name: string, minimum?: number,
 *   maximum?: number}[][], substitutions: object}[]} [document.rules]
 * @param {boolean} [document.rulesProcessingLast]
 * @param {{filename: string, name: string, familyname?: string,
 *   stylename?: string, layer?: string, location: object}[]} document.sources
 *   locations in design coordinates
 * @param {object} [document.lib]
 */
export function designspaceXML({
  axes = [],
  mappings = [],
  rules = [],
  rulesProcessingLast = false,
  sources = [],
  lib = {},
}) {
  const lines = [
    "<?xml version='1.0' encoding='UTF-8'?>",
    `<designspace format="${mappings.length ? "5.1" : "5.0"}">`,
  ];
  if (axes.length) {
    lines.push("  <axes>");
    for (const axis of axes) {
      const range = axis.values
        ? { values: axis.values.join(" ") }
        : { minimum: axis.minimum, maximum: axis.maximum };
      const opening = `    <axis${attributes({
        tag: axis.tag,
        name: axis.name,
        ...range,
        default: axis.default,
        hidden: axis.hidden ? 1 : undefined,
      })}`;
      const children = [
        ...(axis.map ?? []).map(
          ([input, output]) => `      <map${attributes({ input, output })}/>`
        ),
      ];
      if (axis.labels?.length) {
        children.push(
          "      <labels>",
          ...axis.labels.map((label) => `        <label${attributes(label)}/>`),
          "      </labels>"
        );
      }
      lines.push(
        ...(children.length
          ? [`${opening}>`, ...children, "    </axis>"]
          : [`${opening}/>`])
      );
    }
    lines.push("  </axes>");
  }
  if (mappings.length) {
    lines.push("  <mappings>");
    for (const mapping of mappings) {
      lines.push(
        `    <mapping${attributes({ description: mapping.description })}>`,
        ...locationLines("input", mapping.input, "      "),
        ...locationLines("output", mapping.output, "      "),
        "    </mapping>"
      );
    }
    lines.push("  </mappings>");
  }
  if (rules.length) {
    lines.push(`  <rules${rulesProcessingLast ? ' processing="last"' : ""}>`);
    for (const rule of rules) {
      lines.push(`    <rule${attributes({ name: rule.name })}>`);
      for (const conditions of rule.conditionSets) {
        lines.push(
          "      <conditionset>",
          ...conditions.map(
            (condition) => `        <condition${attributes(condition)}/>`
          ),
          "      </conditionset>"
        );
      }
      for (const [name, replacement] of Object.entries(rule.substitutions)) {
        lines.push(`      <sub${attributes({ name, with: replacement })}/>`);
      }
      lines.push("    </rule>");
    }
    lines.push("  </rules>");
  }
  lines.push("  <sources>");
  for (const source of sources) {
    lines.push(
      `    <source${attributes({
        filename: source.filename,
        name: source.name,
        familyname: source.familyname,
        stylename: source.stylename,
        layer: source.layer,
      })}>`,
      ...locationLines("location", source.location, "      "),
      "    </source>"
    );
  }
  lines.push("  </sources>");
  if (Object.values(lib).some((value) => value !== undefined && value !== null)) {
    lines.push("  <lib>", plistValueXML(lib, "    "), "  </lib>");
  }
  lines.push("</designspace>", "");
  return lines.join("\n");
}

function locationLines(element, location, indent) {
  const dimensions = Object.entries(location ?? {}).map(
    ([name, xvalue]) => `${indent}  <dimension${attributes({ name, xvalue })}/>`
  );
  return dimensions.length
    ? [`${indent}<${element}>`, ...dimensions, `${indent}</${element}>`]
    : [`${indent}<${element}/>`];
}

// Attributes whose value is undefined or null are left out
function attributes(values) {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join("");
}
