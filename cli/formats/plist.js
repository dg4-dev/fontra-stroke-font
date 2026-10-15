// XML property lists (UFO's .plist files and glif libs). Adapted from
// fontra-source-control (src/formats/plist.js), same author and license.
// Writing (plistXML() and plistValueXML() at the end) is added here.

import { escapeText, parseXML } from "./xml.js";

export class PlistParseError extends Error {
  constructor(message) {
    super(message);
    this.name = "PlistParseError";
  }
}

export function parseXMLPlist(source) {
  const root = parseXML(source);
  const valueElement = root.name === "plist" ? root.children[0] : root;
  return valueElement ? plistValue(valueElement) : null;
}

/** The value of a plist element already parsed by parseXML(). */
export function plistValue(element) {
  switch (element.name) {
    case "dict": {
      const result = {};
      const children = element.children;
      for (let i = 0; i < children.length; i += 2) {
        if (children[i].name !== "key" || !children[i + 1]) {
          throw new PlistParseError("dict keys and values do not pair up");
        }
        result[children[i].text] = plistValue(children[i + 1]);
      }
      return result;
    }
    case "array":
      return element.children.map(plistValue);
    case "string":
      return element.text;
    case "integer":
    case "real":
      return Number(element.text.trim());
    case "true":
      return true;
    case "false":
      return false;
    case "date":
    case "data":
      return element.text.trim();
    default:
      throw new PlistParseError(`unknown plist element <${element.name}>`);
  }
}

/**
 * A whole .plist file holding value.
 * @param {*} value an object, array, string, number or boolean
 */
export function plistXML(value) {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" ' +
    '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
    `<plist version="1.0">\n${plistValueXML(value)}\n</plist>\n`
  );
}

/**
 * One plist value as XML, one element per line, starting at indent. Keys of
 * objects keep their order; keys whose value is undefined or null are left
 * out, as are such items of arrays.
 */
export function plistValueXML(value, indent = "", step = "  ") {
  if (value === true || value === false) {
    return `${indent}<${value}/>`;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`a plist cannot hold the number ${value}`);
    }
    return Number.isInteger(value)
      ? `${indent}<integer>${value}</integer>`
      : `${indent}<real>${value}</real>`;
  }
  if (typeof value === "string") {
    return `${indent}<string>${escapeText(value)}</string>`;
  }
  if (Array.isArray(value)) {
    const items = value.filter((item) => item !== undefined && item !== null);
    if (!items.length) {
      return `${indent}<array/>`;
    }
    const lines = items.map((item) => plistValueXML(item, indent + step, step));
    return `${indent}<array>\n${lines.join("\n")}\n${indent}</array>`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(
      ([, item]) => item !== undefined && item !== null
    );
    if (!entries.length) {
      return `${indent}<dict/>`;
    }
    const lines = entries.flatMap(([key, item]) => [
      `${indent}${step}<key>${escapeText(key)}</key>`,
      plistValueXML(item, indent + step, step),
    ]);
    return `${indent}<dict>\n${lines.join("\n")}\n${indent}</dict>`;
  }
  throw new Error(`a plist cannot hold ${value}`);
}
