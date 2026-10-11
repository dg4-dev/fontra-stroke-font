// Reading the outline and lib of a .glif file, and rewriting its outline.
//
// Only the <outline> element is rewritten; the rest of the file (advance,
// unicodes, anchors, guidelines, note, lib) is kept as it is, character for
// character, except for one key added to the lib.

import { plistValue } from "./plist.js";
import { firstChild, parseXML, serializeElement } from "./xml.js";

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
    }));
  const isClosed = !(raw.length && raw[0].glifType === "move");
  // An off-curve point is quadratic when the on-curve point it leads to is a
  // "qcurve", cubic otherwise. In a closed contour, the off-curve points at
  // the end lead to the first point.
  const points = raw.map(({ x, y, smooth }) => (smooth ? { x, y, smooth } : { x, y }));
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

function contourXML(contour, indent, step) {
  const points = contour.points;
  const lines = points.map((point, i) => {
    const attributes = `x="${formatNumber(point.x)}" y="${formatNumber(point.y)}"`;
    if (point.type) {
      return `${indent}${step}<point ${attributes}/>`;
    }
    const previous = points[(i - 1 + points.length) % points.length];
    const type = previous.type ? "curve" : "line";
    return `${indent}${step}<point ${attributes} type="${type}"/>`;
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
