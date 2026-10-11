// XML property lists (UFO's .plist files and glif libs). Adapted from
// fontra-source-control (src/formats/plist.js), same author and license.

import { parseXML } from "./xml.js";

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
