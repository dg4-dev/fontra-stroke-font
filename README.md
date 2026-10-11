# Fontra Stroke Font

A [Fontra](https://github.com/fontra/fontra) plugin for designing stroke fonts: draw open contours as centerlines, stroke them with a width or a pen nib, and see the stroked shape while you edit.

The plan is in the issues. Phase 1 (the preview) works: open contours are stroked with a constant width per source, and the values are changed in a sidebar panel. Later phases add the weight axis and the export CLI, per-point widths, pen nibs and live corners.

- **In the editor**: open contours are centerlines. The plugin draws the stroked shape on top of them as a preview; the font sources keep the centerlines
- **Ways to stroke**: a width (per point, optionally different on each side) with caps, joins and a miter limit; or a pen nib (ellipse, rectangle or flat pen) with its size and angle per point
- **Live corners**: round a corner of the centerline without changing the centerline itself
- **On the canvas**: drag handles to change widths, nibs and corner radii
- **Weight axis**: these values can differ per source, and are interpolated between them
- **Before export**: a command-line tool expands the centerlines into outlines in a copy of the font, which then goes to fontmake or fontra-workflow

## Installation

In Fontra, open **Application settings → Plugin Manager**, press "+" and enter the plugin address.

### From GitHub

```plaintext
dg4-dev/fontra-stroke-font
```

Fontra loads `owner/repo` addresses through jsDelivr (`https://cdn.jsdelivr.net/gh/<owner>/<repo>@latest`), so the repository must be public. `@latest` points to the newest release tag, or to the default branch (`main`) when there are no tags.

To try a development branch, enter a URL with the branch name.

```plaintext
https://cdn.jsdelivr.net/gh/dg4-dev/fontra-stroke-font@develop
```

jsDelivr caches branch contents for a while, so updates may not show up right away.

### From a local copy (for development)

Serve your working copy with CORS headers and register its URL as the plugin address. Your edits are picked up each time you reopen the editor.

```plaintext
npx http-server /path/to/fontra-stroke-font -p 8123 --cors -c-1
```

```plaintext
http://localhost:8123
```

After registering, reopen the glyph editor to load the plugin.

## Usage

Draw an open contour (with the pen tool, end a contour without closing it) in the glyph being edited. The plugin fills its stroked shape in translucent blue under the centerline. The preview follows while you drag points and handles. Closed contours are ordinary outlines and are not stroked; a glyph can mix both.

A stroke font tab (an S-shaped stroke icon) is added to the right sidebar of the glyph editor.

| Setting | Description |
| --- | --- |
| Show stroke preview | Shows or hides the preview. Saved in the browser's localStorage |
| Width | Distance between the two edges of the stroke |
| Cap | Shape of the ends: butt (flat at the end point), round, or square (extends half the width beyond the end point) |
| Join | Shape of corners: miter (pointed), round, or bevel (cut off). Smooth points do not make corners |
| Miter limit | A miter longer than this many times the width becomes a bevel, as in SVG: for an angle θ between the two lines, the miter is `1 / sin(θ / 2)` times the width. Only used with the miter join |

Width, cap, join and miter limit belong to the source being edited, so each source (for example Light and Bold) has its own values. They are saved with the font and can be undone. When the editor is at a location between sources, the fields are disabled and the preview uses the values of the nearest source; interpolating them between sources comes with the weight axis (#8).

A lone on-curve point becomes a dot with round or square caps, as in SVG.

### Display language

The plugin reads the display language that Fontra stores in localStorage (`fontra-language-language`) and uses the translation for that language code. Languages without a translation show English. Fontra reloads the page when its display language changes, and the plugin switches language at the same time.

| Language | Translated |
| --- | --- |
| English, 简体中文, 繁體中文, 日本語, Deutsch, Nederlands, Français, Italiano, Español (España), Español (Latinoamérica), Português (Brasil), Português (Portugal), Русский | Yes |
| Tagalog | No (shown in English) |

The word for "source" follows Fontra's own translations.

## Data format

The stroke settings are kept in the font, under the key `xyz.dg4.stroke` in `customData`.

The method and the nib shape are the same for all sources of a glyph, since they cannot be interpolated. They go in the glyph's `customData`. A glyph without them uses the width (`offset`) method.

```json
{ "xyz.dg4.stroke": { "type": "nib", "shape": "ellipse" } }
```

The values go in each source's `customData`, so that they can vary along the axes. `defaults` applies to the whole source; `points` holds values for single on-curve points, keyed by the point's `identifier`. Missing values fall back to the source defaults, then to the built-in ones (width 80, round caps, miter joins, miter limit 4).

```json
{
  "xyz.dg4.stroke": {
    "defaults": { "width": 80, "cap": "round", "join": "miter", "miterLimit": 4 },
    "points": {
      "<point identifier>": { "left": 50, "right": 30, "join": "round", "cornerRadius": 20 }
    }
  }
}
```

| Key | Method | Value |
| --- | --- | --- |
| `width` | width | Width of the stroke. `left` / `right` set each side separately (from the centerline, looking along the contour) |
| `cap` | width | `butt`, `round` or `square` |
| `join` | width | `miter`, `round` or `bevel` |
| `miterLimit` | width | 1 or more |
| `major`, `minor`, `angle` | nib | Size of the nib and its angle in degrees (0 is horizontal, counter-clockwise), stored in `[0, 180)` |
| `cornerRadius` | both | Radius of a live corner |

Phase 1 reads and writes only the width method's `defaults`. The rest of the format is fixed already so that data made now keeps working in later phases.

When a UFO is saved, the glyph's `customData` goes to the glif lib (`xyz.fontra.customData`) and each source's `customData` to the default layer's glif lib (`xyz.fontra.glyph.source.customData`). Point identifiers are kept in UFOs; other point attributes are not, which is why per-point values are keyed by identifier.

## How it works

`src/geometry/` computes the stroked shape. It has no Fontra or DOM dependencies, so that the preview and the export CLI (#9) share the same code and what is shown is what gets exported.

1. The centerline is split into segments the same way as Fontra's `iterContourDecomposedSegments()`: runs of TrueType off-curve points get implied on-curve points, and quadratic segments become exact cubics
2. Each segment's two edges, half the width to the left and to the right, are sampled and fitted with cubic Béziers whose end tangents follow the centerline. A segment is split into more pieces until the fit is within 0.5 units. The number of pieces can also be given per segment, so that all sources of a glyph can share it (#8)
3. The result is a set of closed contours that overlap: one band per run of segments between two corners, plus one shape per corner (the join) and per end (the cap). All contours run counter-clockwise, so filling them together with the nonzero rule never leaves a hole where they overlap. Overlaps are not removed; that is left to fontmake or fontra-workflow after the CLI

## Limitations

- Where the width is larger than the radius of a curve, the inner edge folds over itself and can leave a small hole in the preview. Detecting and splitting these parts is #13 (phase 2)
- Between sources, the preview uses the nearest source's values instead of interpolated ones (#8)
- The preview is drawn only on the glyph being edited, and does not appear in Fontra's font overview or in other glyphs of the text (#16)
- The preview does not appear in Fontra's "View → Glyph editor appearance" menu. Items in that menu need an internal Fontra action registration that plugins cannot make. Use the sidebar panel to toggle it instead
- The plugin relies on internal APIs of Fontra's editor (`editor.visualizationLayers`, `editor.addSidebarPanel()`, `sceneController.editNamedGlyphAndRecordChanges()` and others). Changes in Fontra may break it

## Development

```plaintext
src/
  start.js            Entry point (init / function in plugin.json)
  geometry/           Stroke calculations (no Fontra or DOM dependencies; shared with the CLI)
    bezier.js           Vector and Bézier helpers
    centerline.js       Splitting a centerline into segments
    fit.js              Fitting cubic Béziers to sampled points
    offset.js           The width method
  stroke-data.js      Reading and writing the stroke data in customData
  current-source.js   Which source's values apply to the glyph in the editor
  stroke-layer.js     Fontra visualization layer for the preview
  panel.js            Sidebar panel
  settings.js         Display settings, saved to localStorage
  strings.js          UI strings for each of Fontra's display languages
test/                 Unit tests with node:test
```

Run the tests (Node.js 22 or later, no dependencies):

```plaintext
npm test
```

### Branching

The repository follows git-flow.

- `main`: released code. jsDelivr's `@latest` loads this branch when there are no tags
- `develop`: integration branch for the next release
- `feature/*`: one branch per feature, branched from `develop` and merged back into `develop`
- `release/*`: release preparation, branched from `develop`, merged into both `main` and `develop`, with a tag on `main`

## License

[GNU General Public License v3.0](LICENSE) (GPL-3.0), the same license as Fontra.
