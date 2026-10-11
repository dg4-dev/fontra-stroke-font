// Minimal stand-ins for the Fontra objects the plugin reads.

/** A path with the parts of Fontra's VarPackedPath that the plugin uses. */
export function fakePath(contours) {
  let endPoint = -1;
  return {
    numContours: contours.length,
    contourInfo: contours.map((c) => {
      endPoint += c.points.length;
      return { isClosed: c.isClosed, endPoint };
    }),
    coordinates: contours.flatMap((c) => c.points.flatMap((p) => [p.x, p.y])),
    pointTypes: contours.flatMap((c) => c.points.map((p) => p.type ?? "on")),
    drawContourToPath2d(path2d, index) {
      const [first, ...rest] = contours[index].points;
      path2d.moveTo(first.x, first.y);
      for (const p of rest) {
        path2d.lineTo(p.x, p.y);
      }
      path2d.closePath();
    },
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
    components = [],
    glyphCustomData = {},
    sources = [{ name: "Regular", customData: {} }],
    nearestSourceIndex = 0,
  } = options;
  // Explicitly passing undefined means "not at a source"
  const sourceIndex = "sourceIndex" in options ? options.sourceIndex : 0;
  const varGlyph = {
    glyph: { customData: glyphCustomData, sources },
    sources,
    findNearestSourceForSourceLocation: (location) =>
      location?.isDefault ? 0 : nearestSourceIndex,
    getDenseDefaultSourceLocation: () => ({ isDefault: true }),
    // Sources at wght 300, 700, ... in order; values interpolated linearly
    model: {
      getDeltas: (values) => values,
      interpolateFromDeltas(location, values) {
        const position = ((location.wght ?? 300) - 300) / 400;
        const i = Math.min(values.length - 2, Math.max(0, Math.floor(position)));
        const f = position - i;
        if (values.length === 1) {
          return { instance: values[0] };
        }
        return {
          instance: values[i].map((v, k) => v + (values[i + 1][k] - v) * f),
        };
      },
    },
  };
  return {
    glyphName: options.glyphName ?? "a",
    varGlyph,
    glyph: {
      path: fakePath(contours),
      sourceIndex,
      varGlyph,
      // [{ name, contours, location? }] as Fontra's ComponentController
      components: components.map(({ name, contours, location = {} }) => ({
        compo: { name, location },
        path: fakePath(contours),
      })),
    },
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
  arc(x, y, radius, start, end) {
    this.calls.push(["arc", x, y, radius]);
  }
  stroke() {
    this.calls.push(["stroke", this.strokeStyle, this.lineWidth]);
  }
}

/** Records Path2D calls. */
export class FakePath2D {
  constructor() {
    this.calls = [];
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
}
