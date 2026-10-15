# Building fonts

The font sources keep the centerlines. Before building, make a copy of the font in which the centerlines are replaced by their outlines, and build from the copy:

```plaintext
npx --yes github:dg4-dev/fontra-stroke-font expand MyFamily.designspace -o build/expanded
```

To use a released version rather than the latest code on `main`, add its tag: `github:dg4-dev/fontra-stroke-font#v0.3.1`. This needs [Node.js](https://nodejs.org/) 22 or later; nothing else is installed. It copies the designspace and its UFOs into `build/expanded` and, in every glyph, replaces each centerline (each open contour, and each closed contour marked as a centerline) with its stroked outline (the other closed contours and components stay as they are). The input files are not changed. The output folder must not be the folder of the designspace. Options: `--tolerance N` (the largest distance in font units between a stroked edge and the exact one, default 0.5), `--remove-stroke-data` and `--quiet`.

By default the copy keeps the stroke settings (`xyz.dg4.stroke`, see [Data format](data-format.md)) in the libs of its glyphs; they do nothing in a built font. With `--remove-stroke-data`, they are removed from every glyph of the copy, from both the glyph's and each source's `customData` (a `customData` left empty is removed too, as Fontra does). The outlines are the same either way.

It prints:

- `twist:` lines: where strokes twist, by glyph, source and contour
- `warning:` lines: glyphs whose outlines will not interpolate (for example when a centerline has a different number of points in some sources), glyphs that twist in some sources only (see [Twists](how-it-works.md#twists)), and glyphs it leaves as they are

Then build with fontmake, for example a variable font:

```plaintext
fontmake -m build/expanded/MyFamily.designspace -o variable --output-dir build/fonts
```

or static fonts of the instances defined in the designspace:

```plaintext
fontmake -m build/expanded/MyFamily.designspace -i -o ttf otf --output-dir build/fonts
```

The stroked outlines are separate overlapping contours (a band, plus the shapes of caps and joins). fontmake removes the overlaps of static fonts by default (add `--overlaps-backend pathops` to use skia-pathops, `pip install skia-pathops`, instead of the default booleanOperations). A variable font keeps its overlapping contours, as variable fonts usually do; the CLI sets `public.truetype.overlap` in the lib of every glyph it changes, and of every glyph that has one of them as a component (directly or through other components), so that the TrueType outlines are flagged as overlapping and render correctly.

[fontra-workflow](https://github.com/fontra/fontra) can read the copy as well (`input: fontra-read` with `source: build/expanded/MyFamily.designspace`). Its `remove-overlaps` filter works per source, so use it only for static fonts: in a variable font, removing overlaps can leave the sources with different points.

Only the sources listed in the designspace are expanded. Glyphs that have axes or sources of their own in Fontra (a local design space) are reported and expanded only in the designspace sources.

## .fontra fonts

A font kept in Fontra's own format (a `.fontra` folder) is expanded the same way:

```plaintext
npx --yes github:dg4-dev/fontra-stroke-font expand MyFamily.fontra -o build/expanded
```

This writes `build/expanded/MyFamily.fontra`: a copy of the folder in which the glyph files that change are written again (in the layout Fontra writes them in), and the other files are copied as they are. The options are the same. Unlike with a designspace, all the sources of a glyph are expanded, also those of axes of the glyph's own. The default source (whose cap, joins and marks all sources use) is the one at the default location of all axes, as in Fontra. An inactive source is stroked on its own, since it does not interpolate with the others. Layers that belong to no source, such as background layers, are left as they are.

A `.fontra` font has no place for the overlap flag of the TrueType outlines (`public.truetype.overlap` in a UFO), so the copy has none. To build a variable font from it, use fontra-workflow with the `compile-fontmake` output of [fontra-compile](https://github.com/fontra/fontra-compile), and set `setOverlapSimpleFlag: true` there, which flags every glyph:

```yaml
steps:
  - input: fontra-read
    source: build/expanded/MyFamily.fontra
  - output: compile-fontmake
    destination: MyFamily.ttf
    setOverlapSimpleFlag: true
```
