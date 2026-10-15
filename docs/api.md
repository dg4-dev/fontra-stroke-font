# API for other plugins

Other Fontra plugins can get the stroked shapes of a glyph from this plugin: the filled outlines, and the two edges of each band on their own. For example, a plugin that draws curvature combs can draw them on the edges of the strokes instead of on the centerlines, and a plugin that shows changes between versions of a font can draw them with the strokes. The shapes are computed by the same code as the preview and the command-line tool (see [how-it-works.md](how-it-works.md)).

There are two functions:

- `strokePositionedGlyph()`: a glyph shown in the editor, at its location (between sources too). For plugins running in the same editor
- `strokeGlyphSource()`: one source of a glyph, from its contours and the values in its `customData`, without Fontra. For a glyph read from a file, in the editor or in Node.js

## Finding the functions

When the plugin starts, it puts the functions on `globalThis.fontraStrokeFont`:

```js
const strokeFont = globalThis.fontraStrokeFont;
if (strokeFont?.apiVersion >= 1) {
  // strokeFont.strokePositionedGlyph(), strokeFont.strokeGlyphSource()
}
```

- Plugins start in no fixed order, so look it up each time it is needed (when drawing), not once when your plugin starts. Without it (the plugin is not installed), keep doing what your plugin did before
- The object is frozen. Its functions never change the font, and never throw: on bad input they log the error and return an empty result. What they return is a copy, which the caller may change
- The registration lasts as long as the editor page. After the plugin is removed in the Plugin Manager, the editor is reloaded without it, and nothing is registered
- When two copies of the plugin are loaded (for example a released one and a local one), the one with the higher `apiVersion` stays registered; with the same version, the one that started last

## Versions

`apiVersion` is 1. It goes up when something is added (a function, an argument, a field of a result). What a version has stays the same in later versions: the same functions take the same arguments and return the same fields. A change that would break a call gets a new function name instead, and the old function stays. So check `apiVersion >= n`, where n is the version that added what you use.

| `apiVersion` | Added                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------- |
| 1            | `strokePositionedGlyph()`, `strokeGlyphSource()`; `outlines`, `edges`, `twists`, `centerlines` |

## strokePositionedGlyph(positionedGlyph, location)

The stroked shapes of a glyph in the editor, as the preview draws them: its own centerlines, and those inside its components (each with the values of its own glyph).

| Argument          | Value                                                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `positionedGlyph` | An entry of Fontra's positioned lines, as a visualization layer's `draw` gets it                                                                                                           |
| `location`        | The glyph's location: `sceneModel.getLocationForGlyph(glyphName)` (a layer's `draw` gets the scene model as `model`). Needed when the glyph is between sources; at a source it is not used |

Components whose glyph Fontra has not loaded yet are left out; the plugin asks Fontra for them and redraws the canvas once they are there.

Example: a visualization layer that draws curvature combs on the edges of the selected centerlines, and on the centerlines without this plugin.

```js
draw: ({ context, positionedGlyph, parameters, model }) => {
  const strokeFont = globalThis.fontraStrokeFont;
  if (!(strokeFont?.apiVersion >= 1)) {
    drawCombsOnContours(context, positionedGlyph.glyph.path, parameters);
    return;
  }
  const location = model.getLocationForGlyph(positionedGlyph.glyphName);
  const { edges, centerlines } = strokeFont.strokePositionedGlyph(
    positionedGlyph,
    location
  );
  for (const edge of edges) {
    // edge.componentIndex is set on the edges of components' centerlines
    if (edge.componentIndex === undefined && isSelected(edge.contourIndex)) {
      drawComb(context, edge, parameters);
    }
  }
  // The other contours (closed outlines) get combs as before
  drawCombsOnContours(context, positionedGlyph.glyph.path, parameters, {
    skip: centerlines,
  });
};
```

## strokeGlyphSource(input)

The stroked shapes of one source of a glyph, from plain data: what the preview draws at that source. The command-line tool gives the same outlines for a font with a single source; with several sources it fits the edges of all of them with the same number of points (see [Compatible sources](how-it-works.md#compatible-sources)), so their points can differ by up to the tolerance. Live corners will be drawn here too once the plugin has them.

`input` is an object:

| Field             | Value                                                                                                                                                                                                                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contours`        | All contours of the source's glyph (components left out), in Fontra's unpacked form: `{ points, isClosed }`, each point `{ x, y, type?, smooth?, attrs? }`. `type` is `"cubic"` or `"quad"` for off-curve points. The point's `identifier` goes in `attrs.identifier` (as Fontra has it) or on the point itself |
| `customData`      | The source's `customData`, with the values under `xyz.dg4.stroke` (see [data-format.md](data-format.md)). In a UFO, the glyph's lib key `xyz.fontra.glyph.source.customData`                                                                                                                                    |
| `glyphCustomData` | The glyph's `customData`, which says whether it is stroked with a nib. In a UFO, the lib key `xyz.fontra.customData` of the glyph in the default source                                                                                                                                                         |
| `defaultSource`   | For a source other than the default one: the default source's `{ contours, customData }`. Leave it out for the default source                                                                                                                                                                                   |
| `tolerance`       | The largest distance in font units between a fitted edge and the exact one (0.5 by default)                                                                                                                                                                                                                     |

Some values are the same in all sources and come from the default source: cap and join, the joins of points, which closed contours are centerlines, and which way round the nib turns along the centerline. The points of the default source are matched by their index, so this needs the same contours with the same numbers of points in both sources. When they differ, the source's own values are used, as the command-line tool does.

Example: in Node.js, the stroked outlines of a glyph in a source that is not the default one, read from two UFOs (`readGlif()` and `readContours()` stand for your own glif reader).

```js
import { strokeGlyphSource } from "fontra-stroke-font/src/api.js";

const bold = readGlif("Test-Bold.ufo/glyphs/n.glif");
const light = readGlif("Test-Light.ufo/glyphs/n.glif"); // the default source
const { outlines, centerlines } = strokeGlyphSource({
  contours: readContours(bold),
  customData: bold.lib["xyz.fontra.glyph.source.customData"],
  glyphCustomData: light.lib["xyz.fontra.customData"],
  defaultSource: {
    contours: readContours(light),
    customData: light.lib["xyz.fontra.glyph.source.customData"],
  },
});
// What the built glyph fills: the stroked outlines, and the closed contours
// that are not centerlines
const filled = [
  ...readContours(bold).filter((contour, index) => !centerlines.includes(index)),
  ...outlines,
];
```

## Results

Both functions return `{ outlines, edges, twists, centerlines }`. Coordinates are in font units of the glyph (y up). Contours are in Fontra's unpacked form, as a path's `getUnpackedContour()` returns them: on-curve points `{ x, y }`, off-curve points `{ x, y, type: "cubic" }`.

| Field         | Value                                                                                                                                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `outlines`    | The stroked shapes: closed contours that overlap (a band per run between corners, a shape per corner and per end), to be filled together with the nonzero rule. The glyph's other closed contours are not in it |
| `edges`       | The two edges of each band, without the corners and ends: `{ side, points, isClosed, contourIndex, componentIndex? }`. See below                                                                                |
| `twists`      | Where a stroke twists (see [Twists](how-it-works.md#twists)): `{ point: { x, y }, side, contourIndex }`. Of the glyph's own centerlines only                                                                    |
| `centerlines` | The indices of the glyph's own contours that are centerlines (open contours, and closed contours marked as centerlines). The other contours are outlines                                                        |

An edge:

- `side` is `"left"` or `"right"`: the side of the centerline, looking along the contour. Both edges run in the direction of the centerline
- `points` are the points of the edge, the same as in the band of `outlines` it belongs to. An edge ends at a corner (where the band ends and the join's shape begins) and at the ends of an open centerline; the shapes of joins and caps have no edges. A nib can end a band inside a segment too (a rectangular nib where the corner that draws the edge changes, and at every smooth point), so a centerline can have several edges on each side
- `isClosed` is true for a closed centerline without corners (the bowl of o): its edges go all the way round
- `contourIndex` is the index of the centerline among the contours of the glyph's path (`strokeGlyphSource()`: among `contours`). For a component's centerline, `componentIndex` is the index of the component, and `contourIndex` the index in the component's path
- Edges come in the order of the bands along each centerline, left before right

Where a bend is too tight for the width, an edge follows the centers of curvature of the centerline (see [Twists](how-it-works.md#twists)); its curvature there is that of the centerline's evolute, not of an offset curve.

## Importing the module

`strokeGlyphSource()` needs no editor, so it can also be imported from [`src/api.js`](../src/api.js), which has no Fontra or DOM dependencies:

- In a browser, by URL. Use a release tag rather than a branch, so that the code does not change under you:

  ```js
  import {
    API_VERSION,
    strokeGlyphSource,
  } from "https://cdn.jsdelivr.net/gh/dg4-dev/fontra-stroke-font@<tag>/src/api.js";
  ```

- In Node.js (22 or later), from a copy of the repository, installed with `npm install github:dg4-dev/fontra-stroke-font#<tag>`:

  ```js
  import { API_VERSION, strokeGlyphSource } from "fontra-stroke-font/src/api.js";
  ```

`API_VERSION` is the module's `apiVersion`. The module's other exports are not part of the API and can change in any version.
