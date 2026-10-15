// Reading the outline and lib of a .glif file, rewriting its outline, and
// writing a whole .glif file.
//
// Only the <outline> element is rewritten; the rest of the file (advance,
// unicodes, anchors, guidelines, note, lib) is kept as it is, character for
// character, except for one key added to the lib.

import { plistValue, plistValueXML } from "./plist.js";
import {
  escapeAttribute,
  escapeText,
  firstChild,
  parseXML,
  serializeElement,
} from "./xml.js";

const ON_CURVE_TYPES = new Set(["move", "line", "curve", "qcurve"]);

/**
 * @param {string} text the .glif XML
 * @returns {{outline: object[], lib: object}} outline: one entry per child
 *   of <outline>, in order: { element, contour } where contour is set for
 *   contours, in Fontra's unpacked form ({ points: [{x, y, type?, smooth?}],
 *   isClosed })
 */
export function readGlif(text) {
  const root = parseXML(text);
  if (root.name !== "glyph") {
    throw new Error("not a .glif file");
  }
  const outlineElement = firstChild(root, "outline");
  const outline = (outlineElement?.children ?? []).map((element) => ({
    element,
    contour: element.name === "contour" ? unpackContour(element) : null,
  }));
  const libElement = firstChild(root, "lib");
  const libDict = libElement ? firstChild(libElement, "dict") : null;
  const lib = libDict ? plistValue(libDict) : {};
  return { outline, lib };
}

function unpackContour(element) {
  const raw = element.children
    .filter((child) => child.name === "point")
    .map((point) => ({
      x: Number(point.attributes.x),
      y: Number(point.attributes.y),
      glifType: point.attributes.type ?? "offcurve",
      smooth: point.attributes.smooth === "yes",
      identifier: point.attributes.identifier,
    }));
  const isClosed = !(raw.length && raw[0].glifType === "move");
  // An off-curve point is quadratic when the on-curve point it leads to is a
  // "qcurve", cubic otherwise. In a closed contour, the off-curve points at
  // the end lead to the first point.
  const points = raw.map(({ x, y, smooth, identifier }) => {
    const point = smooth ? { x, y, smooth } : { x, y };
    if (identifier !== undefined) {
      point.attrs = { identifier };
    }
    return point;
  });
  const isOnCurve = raw.map((point) => ON_CURVE_TYPES.has(point.glifType));
  let next = null;
  // Walk backwards (twice around for a closed contour), remembering the type
  // of the on-curve point that the off-curve points lead to
  for (let step = 0; step < raw.length * (isClosed ? 2 : 1); step++) {
    const i = raw.length - 1 - (step % raw.length);
    if (isOnCurve[i]) {
      next = raw[i].glifType;
    } else if (next !== null && !points[i].type) {
      points[i].type = next === "qcurve" ? "quad" : "cubic";
    }
  }
  // Left over: off-curve points after the last on-curve point of an open
  // contour (ignored when stroking), or a closed TrueType "blob" without any
  // on-curve point
  const blob = !isOnCurve.some(Boolean);
  for (const [i, point] of points.entries()) {
    if (!isOnCurve[i] && !point.type) {
      point.type = blob ? "quad" : "cubic";
    }
  }
  return { points, isClosed };
}

/**
 * Replace contours of the outline.
 * @param {string} text the original .glif XML
 * @param {Map<number, object[]>} replacements index of an <outline> child ->
 *   the closed contours (unpacked, lines and cubics) to write in its place
 * @param {{overlapFlag?: boolean}} [options] also set the lib key
 *   "public.truetype.overlap", which tells ufo2ft that contours overlap
 */
export function rewriteGlif(text, replacements, { overlapFlag = false } = {}) {
  const { outline, lib } = readGlif(text);
  const match = /([ \t]*)(<outline\b[^>]*\/>|<outline\b[^>]*>[\s\S]*?<\/outline>)/.exec(
    text
  );
  if (!match) {
    throw new Error("the glyph has no <outline>");
  }
  const indent = match[1];
  const step = "  ";
  const lines = [];
  for (const [index, { element }] of outline.entries()) {
    const replacement = replacements.get(index);
    if (replacement) {
      for (const contour of replacement) {
        lines.push(contourXML(contour, indent + step, step));
      }
    } else {
      lines.push(serializeElement(element, indent + step, step));
    }
  }
  const outlineXML = lines.length
    ? `${indent}<outline>\n${lines.join("\n")}\n${indent}</outline>`
    : `${indent}<outline/>`;
  let result =
    text.slice(0, match.index) + outlineXML + text.slice(match.index + match[0].length);
  if (overlapFlag && lib["public.truetype.overlap"] !== true) {
    result = setOverlapFlag(result, lib);
  }
  return result;
}

/**
 * Set the lib key "public.truetype.overlap" to true, leaving the rest of the
 * .glif as it is.
 * @param {string} text the original .glif XML
 */
export function addOverlapFlag(text) {
  const { lib } = readGlif(text);
  return lib["public.truetype.overlap"] === true ? text : setOverlapFlag(text, lib);
}

/**
 * A whole .glif file (format 2).
 * @param {{name: string, unicodes?: number[], width?: number, height?: number,
 *   note?: string, guidelines?: {x: number, y: number, angle: number,
 *   name?: string}[], anchors?: {x: number, y: number, name?: string}[],
 *   contours?: object[], components?: {base: string, transform?: number[]}[],
 *   lib?: object}} glyph contours in Fontra's unpacked form (identifiers in
 *   point.attrs), transforms as [xx, xy, yx, yy, dx, dy]
 */
export function glifXML(glyph) {
  const step = "  ";
  const lines = [
    "<?xml version='1.0' encoding='UTF-8'?>",
    `<glyph name="${escapeAttribute(glyph.name)}" format="2">`,
  ];
  const advance = [];
  if (glyph.width) {
    advance.push(`width="${formatNumber(glyph.width)}"`);
  }
  if (glyph.height) {
    advance.push(`height="${formatNumber(glyph.height)}"`);
  }
  if (advance.length) {
    lines.push(`${step}<advance ${advance.join(" ")}/>`);
  }
  for (const codePoint of glyph.unicodes ?? []) {
    const hex = codePoint.toString(16).toUpperCase().padStart(4, "0");
    lines.push(`${step}<unicode hex="${hex}"/>`);
  }
  if (glyph.note) {
    lines.push(`${step}<note>${escapeText(glyph.note)}</note>`);
  }
  for (const { x, y, angle, name } of glyph.guidelines ?? []) {
    const named = name ? ` name="${escapeAttribute(name)}"` : "";
    lines.push(
      `${step}<guideline x="${formatNumber(x)}" y="${formatNumber(y)}" ` +
        `angle="${formatNumber(angle)}"${named}/>`
    );
  }
  for (const { x, y, name } of glyph.anchors ?? []) {
    const named = name ? ` name="${escapeAttribute(name)}"` : "";
    lines.push(
      `${step}<anchor x="${formatNumber(x)}" y="${formatNumber(y)}"${named}/>`
    );
  }
  const outline = [
    ...(glyph.contours ?? []).map((contour) => contourXML(contour, step + step, step)),
    ...(glyph.components ?? []).map((component) =>
      componentXML(component, step + step)
    ),
  ];
  lines.push(
    outline.length
      ? `${step}<outline>\n${outline.join("\n")}\n${step}</outline>`
      : `${step}<outline/>`
  );
  const lib = glyph.lib ?? {};
  if (Object.values(lib).some((value) => value !== undefined && value !== null)) {
    lines.push(`${step}<lib>`, plistValueXML(lib, step + step, step), `${step}</lib>`);
  }
  lines.push("</glyph>", "");
  return lines.join("\n");
}

const TRANSFORM_ATTRIBUTES = [
  ["xScale", 1],
  ["xyScale", 0],
  ["yxScale", 0],
  ["yScale", 1],
  ["xOffset", 0],
  ["yOffset", 0],
];

function componentXML({ base, transform = [1, 0, 0, 1, 0, 0] }, indent) {
  const attributes = [`base="${escapeAttribute(base)}"`];
  for (const [i, [name, identity]] of TRANSFORM_ATTRIBUTES.entries()) {
    // Like ufoLib, written to at most 10 decimals, and only when not the
    // identity's
    const value = Math.round(transform[i] * 1e10) / 1e10;
    if (value !== identity) {
      attributes.push(`${name}="${value === 0 ? 0 : value}"`);
    }
  }
  return `${indent}<component ${attributes.join(" ")}/>`;
}

// The segment type of an on-curve point comes from the off-curve points
// before it: "curve" after cubic ones, "qcurve" after quadratic ones. The
// first point of an open contour is a "move".
function contourXML(contour, indent, step) {
  const points = contour.points;
  const lines = points.map((point, i) => {
    let attributes = `x="${formatNumber(point.x)}" y="${formatNumber(point.y)}"`;
    if (!point.type) {
      const previous = points[(i - 1 + points.length) % points.length];
      const type =
        !contour.isClosed && i === 0
          ? "move"
          : previous.type === "quad"
            ? "qcurve"
            : previous.type
              ? "curve"
              : "line";
      attributes += ` type="${type}"`;
      if (point.smooth) {
        attributes += ' smooth="yes"';
      }
    }
    const identifier = point.attrs?.identifier;
    if (typeof identifier === "string") {
      attributes += ` identifier="${escapeAttribute(identifier)}"`;
    }
    return `${indent}${step}<point ${attributes}/>`;
  });
  return `${indent}<contour>\n${lines.join("\n")}\n${indent}</contour>`;
}

export function formatNumber(value) {
  const rounded = Math.round(value * 1000) / 1000;
  return String(rounded === 0 ? 0 : rounded);
}

function setOverlapFlag(text, lib) {
  const entry = (indent) =>
    `\n${indent}<key>public.truetype.overlap</key>\n${indent}<true/>`;
  if ("public.truetype.overlap" in lib) {
    // Present but not true: replace its value
    return text.replace(
      /(<key>public\.truetype\.overlap<\/key>\s*)<(?:false|true)\s*\/>/,
      "$1<true/>"
    );
  }
  const libStart = text.search(/<lib>/);
  if (libStart >= 0) {
    const dict = /<dict\s*\/>|<dict>/.exec(text.slice(libStart));
    if (dict) {
      const dictStart = libStart + dict.index;
      const lineStart = text.lastIndexOf("\n", dictStart) + 1;
      const dictIndent = /^[ \t]*/.exec(text.slice(lineStart, dictStart))[0];
      const opened = `<dict>${entry(dictIndent + "  ")}`;
      const replacement =
        dict[0] === "<dict>" ? opened : `${opened}\n${dictIndent}</dict>`;
      return (
        text.slice(0, dictStart) + replacement + text.slice(dictStart + dict[0].length)
      );
    }
  }
  if (/<lib\s*\/>/.test(text)) {
    return text.replace(/([ \t]*)<lib\s*\/>/, (whole, indent) => libXML(indent));
  }
  return text.replace(/([ \t]*)<\/glyph>/, (whole, indent) => {
    return `${libXML(indent + "  ")}\n${indent}</glyph>`;
  });
}

function libXML(indent) {
  return (
    `${indent}<lib>\n${indent}  <dict>\n` +
    `${indent}    <key>public.truetype.overlap</key>\n${indent}    <true/>\n` +
    `${indent}  </dict>\n${indent}</lib>`
  );
}
