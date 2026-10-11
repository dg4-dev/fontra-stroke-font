# Fontra Stroke Font

A [Fontra](https://github.com/fontra/fontra) plugin for designing stroke fonts: draw open contours as centerlines, stroke them with a width or a pen nib, and see the stroked shape while you edit.

The plan is in the issues. Phases 1 and 2 work: open contours are stroked with a constant width per source, the values are changed in a sidebar panel and interpolated between sources, and a command-line tool turns the centerlines into outlines for building fonts. Later phases add per-point widths, pen nibs and live corners.

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

The other glyphs of the text are drawn with their stroked shapes too, as they will look in the font. Open contours inside components are stroked too, with the values of the component's own glyph at the component's location. The width is not scaled when the component is.

Where the centerline bends more sharply than half the width (the radius of the bend is smaller than half the width), the stroke twists: its inner edge would run backwards. The plugin fills such places without holes and marks them with a red ring. See [Twists](#twists).

A stroke font tab (an S-shaped stroke icon) is added to the right sidebar of the glyph editor.

| Setting | Description |
| --- | --- |
| Show stroke preview | Shows or hides the preview on the glyph being edited |
| Draw the edge only | Draws the outer edge of the stroked shape instead of filling it |
| Fill opacity | How strongly the preview is filled (5–100%) |
| Show strokes on the other glyphs | Draws the other glyphs of the text with their stroked shapes, as they will look in the font. Off: Fontra draws them itself, and fills each centerline as if it were closed |
| Width | Distance between the two edges of the stroke |
| Cap | Shape of the ends: butt (flat at the end point), round, or square (extends half the width beyond the end point). The same in all sources |
| Join | Shape of corners: miter (pointed), round, or bevel (cut off). Smooth points do not make corners. The same in all sources |
| Miter limit | A miter longer than this many times the width becomes a bevel, as in SVG: for an angle θ between the two lines, the miter is `1 / sin(θ / 2)` times the width. Only used with the miter join |

The first four are display settings, saved in the browser's localStorage.

Width and miter limit belong to the source being edited, so each source (for example Light and Bold) has its own values. Between sources they are interpolated the same way Fontra interpolates the outlines, and the panel shows the interpolated values (the fields are disabled there; go to a source to change them). Cap and join cannot be interpolated, and the outlines of the sources would not match if they differed, so all sources use the ones of the default source: the panel saves them there, whichever source is being edited. All values are saved with the font and can be undone.

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
| `cap` | width | `butt`, `round` or `square`. Only the default source's is used |
| `join` | width | `miter`, `round` or `bevel`. Only the default source's is used |
| `miterLimit` | width | 1 or more |
| `major`, `minor`, `angle` | nib | Size of the nib and its angle in degrees (0 is horizontal, counter-clockwise), stored in `[0, 180)` |
| `cornerRadius` | both | Radius of a live corner |

So far only the width method's `defaults` are read and written. The rest of the format is fixed already so that data made now keeps working in later phases.

When Fontra saves a designspace and UFOs, the glyph's `customData` goes to the lib of the glyph in the default source (`xyz.fontra.customData`), and each source's `customData` to the lib of the glyph in that source's layer (`xyz.fontra.glyph.source.customData`). Point identifiers are kept in UFOs; other point attributes are not, which is why per-point values are keyed by identifier.

## Building fonts

The font sources keep the centerlines. Before building, make a copy of the font in which the centerlines are replaced by their outlines, and build from the copy:

```plaintext
npx --yes github:dg4-dev/fontra-stroke-font expand MyFamily.designspace -o build/expanded
```

This needs [Node.js](https://nodejs.org/) 22 or later; nothing else is installed. It copies the designspace and its UFOs into `build/expanded` and, in every glyph, replaces each open contour with its stroked outline (closed contours and components stay as they are). The input files are not changed. The output folder must not be the folder of the designspace. Options: `--tolerance N` (the largest distance in font units between a stroked edge and the exact one, default 0.5) and `--quiet`.

It prints:

- `twist:` lines: where strokes twist, by glyph, source and contour
- `warning:` lines: glyphs whose outlines will not interpolate (for example when a centerline has a different number of points in some sources), glyphs that twist in some sources only (see [Twists](#twists)), and glyphs it leaves as they are

Then build with fontmake, for example a variable font:

```plaintext
fontmake -m build/expanded/MyFamily.designspace -o variable --output-dir build/fonts
```

or static fonts of the instances defined in the designspace:

```plaintext
fontmake -m build/expanded/MyFamily.designspace -i -o ttf otf --output-dir build/fonts
```

The stroked outlines are separate overlapping contours (a band, plus the shapes of caps and joins). fontmake removes the overlaps of static fonts by default (add `--overlaps-backend pathops` to use skia-pathops, `pip install skia-pathops`, instead of the default booleanOperations). A variable font keeps its overlapping contours, as variable fonts usually do; the CLI sets `public.truetype.overlap` in the lib of every glyph it changes, so that the TrueType outlines are flagged as overlapping and render correctly.

[fontra-workflow](https://github.com/fontra/fontra) can read the copy as well (`input: fontra-read` with `source: build/expanded/MyFamily.designspace`). Its `remove-overlaps` filter works per source, so use it only for static fonts: in a variable font, removing overlaps can leave the sources with different points.

Only the sources listed in the designspace are expanded. Glyphs that have axes or sources of their own in Fontra (a local design space) are reported and expanded only in the designspace sources.

## How it works

`src/geometry/` computes the stroked shape. It has no Fontra or DOM dependencies, so that the preview and the CLI share the same code and what is shown is what gets exported.

1. The centerline is split into segments the same way as Fontra's `iterContourDecomposedSegments()`: runs of TrueType off-curve points get implied on-curve points, and quadratic segments become exact cubics
2. Each segment's two edges, half the width to the left and to the right, are drawn with cubic pieces: each piece goes through the edge's points at both ends, with handles along the edge's direction there, a third of the parameter span long (the Hermite form). A part of an edge is split into more pieces until it is within 0.5 units of the exact edge
3. The result is a set of closed contours that overlap: one band per run of segments between two corners, plus one shape per corner (the join) and per end (the cap). Every contour is built counter-clockwise, so filling them together with the nonzero rule never leaves a hole where they overlap. Each corner gets a join shape with the same points whatever its angle (a beveled corner keeps the point of the miter tip, halfway between the edge ends), so that the points do not change between sources

### Twists

Where the centerline bends with a radius smaller than half the width, an edge at half the width would run backwards between two cusps, make a loop, and leave a hole. There, the edge stays at the radius of the bend instead: it follows the centers of curvature (the evolute). Nothing is lost by this: every point within half the width of the centerline lies on the normal of its nearest centerline point, at most the radius of the bend away from it. So the stroke still covers exactly the points within half the width (with round caps and joins), and the band stays a single simple shape.

### Compatible sources

A variable font needs the same points in all sources. For each centerline, the CLI first strokes every source on its own, then splits each edge in every source at the places where any source splits it (where an edge starts or stops following the evolute, and the cusps of the evolute), gives each part the largest number of pieces any source needs, and strokes all sources again with that layout. The points of all sources then lie on the same normals of the centerline, and with the Hermite handles, an in-between outline matches a stroke of the in-between width up to the tolerance.

The exception is a twist that only some sources have. In a source that twists, the inner edge is held at the radius of the bend, so near the twist the in-between outlines come out thinner on the inside than a stroke of that width would be (in the tests, up to 10 units at three quarters of the way from width 60 to 140 on a bend of radius 56). The CLI warns about such glyphs. To avoid it, make the bend rounder in the source that twists, or add a source in between.

## Limitations

- Between a source where a stroke twists and one where it does not, in-between outlines come out thinner on the inside of the bend (see [Compatible sources](#compatible-sources))
- The stroked shapes are drawn in the glyph editor only. Fontra's font overview shows the centerlines
- To draw the other glyphs with their strokes, the plugin wraps the draw functions of four of Fontra's visualization layers (`fontra.context.glyphs`, `fontra.selected.glyph`, `fontra.hovered.glyph`, `fontra.all.glyphs`) and hands them the stroked shapes instead of the centerlines
- The preview does not appear in Fontra's "View → Glyph editor appearance" menu. Items in that menu need an internal Fontra action registration that plugins cannot make. Use the sidebar panel to toggle it instead
- The plugin relies on internal APIs of Fontra's editor (`editor.visualizationLayers`, `editor.addSidebarPanel()`, `sceneController.editNamedGlyphAndRecordChanges()` and others). Changes in Fontra may break it

## Development

```plaintext
src/
  start.js            Entry point (init / function in plugin.json)
  geometry/           Stroke calculations (no Fontra or DOM dependencies; shared with the CLI)
    bezier.js           Vector and Bézier helpers
    centerline.js       Splitting a centerline into segments
    fit.js              Cubic pieces in Hermite form
    offset.js           The width method
    twist.js            Where strokes twist, and the cusps of the evolute
    compatible.js       Stroking all sources of a glyph with the same points
  stroke-data.js      Reading and writing the stroke data in customData
  current-source.js   Which source's values apply to the glyph in the editor
  glyph-strokes.js    Stroked shapes of a glyph and its components, reused while unchanged
  stroke-layer.js     Fontra visualization layer for the preview
  other-glyphs.js     Wrapping Fontra's layers that draw the other glyphs
  panel.js            Sidebar panel
  settings.js         Display settings, saved to localStorage
  strings.js          UI strings for each of Fontra's display languages
cli/                  The command-line tool (npx … expand)
  index.js            Command line
  expand.js           Copying the font and expanding its centerlines
  formats/            Reading designspace, UFO layer, plist and glif files
test/                 Unit tests with node:test (fixtures/: a small designspace)
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
