# Building fonts

The font sources keep the centerlines. Before building, make a copy of the font in which the centerlines are replaced by their outlines, and build from the copy:

```plaintext
npx --yes github:dg4-dev/fontra-stroke-font expand MyFamily.designspace -o build/expanded
```

To use a released version rather than the latest code on `main`, add its tag: `github:dg4-dev/fontra-stroke-font#v0.3.1`. This needs [Node.js](https://nodejs.org/) 22 or later; nothing else is installed. It copies the designspace and its UFOs into `build/expanded` and, in every glyph, replaces each centerline (each open contour, and each closed contour marked as a centerline) with its stroked outline (the other closed contours and components stay as they are). The input files are not changed. The output folder must not be the folder of the designspace. Options: `--tolerance N` (the largest distance in font units between a stroked edge and the exact one, default 0.5) and `--quiet`.

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

The stroked outlines are separate overlapping contours (a band, plus the shapes of caps and joins). fontmake removes the overlaps of static fonts by default (add `--overlaps-backend pathops` to use skia-pathops, `pip install skia-pathops`, instead of the default booleanOperations). A variable font keeps its overlapping contours, as variable fonts usually do; the CLI sets `public.truetype.overlap` in the lib of every glyph it changes, so that the TrueType outlines are flagged as overlapping and render correctly.

[fontra-workflow](https://github.com/fontra/fontra) can read the copy as well (`input: fontra-read` with `source: build/expanded/MyFamily.designspace`). Its `remove-overlaps` filter works per source, so use it only for static fonts: in a variable font, removing overlaps can leave the sources with different points.

Only the sources listed in the designspace are expanded. Glyphs that have axes or sources of their own in Fontra (a local design space) are reported and expanded only in the designspace sources.
