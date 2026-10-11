// Minimal stand-ins for the Fontra objects the plugin reads.

/** A path with the parts of Fontra's VarPackedPath that the plugin uses. */
export function fakePath(contours) {
  return {
    numContours: contours.length,
    contourInfo: contours.map((c) => ({ isClosed: c.isClosed })),
    getUnpackedContour(index) {
      const c = contours[index];
      return { points: c.points.map((p) => ({ ...p })), isClosed: c.isClosed };
    },
  };
}

/**
 * A positioned glyph: { glyph: StaticGlyphController, varGlyph:
 * VariableGlyphController, glyphName }.
 */
export function fakePositionedGlyph(options) {
  const {
    contours = [],
    glyphCustomData = {},
    sources = [{ name: "Regular", customData: {} }],
    nearestSourceIndex = 0,
  } = options;
  // Explicitly passing undefined means "not at a source"
  const sourceIndex = "sourceIndex" in options ? options.sourceIndex : 0;
  const varGlyph = {
    glyph: { customData: glyphCustomData, sources },
    sources,
    findNearestSourceForSourceLocation: () => nearestSourceIndex,
  };
  return {
    glyphName: "a",
    varGlyph,
    glyph: { path: fakePath(contours), sourceIndex, varGlyph },
  };
}

/** Records canvas path calls. */
export class FakeContext {
  constructor() {
    this.calls = [];
    this.fillStyle = null;
  }
  beginPath() {
    this.calls.push(["beginPath"]);
  }
  moveTo(x, y) {
    this.calls.push(["moveTo", x, y]);
  }
  lineTo(x, y) {
    this.calls.push(["lineTo", x, y]);
  }
  bezierCurveTo(...args) {
    this.calls.push(["bezierCurveTo", ...args]);
  }
  closePath() {
    this.calls.push(["closePath"]);
  }
  fill(rule) {
    this.calls.push(["fill", rule, this.fillStyle]);
  }
}
