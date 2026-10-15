# Building fonts

The font sources keep the centerlines. Before building, make a copy of the font in which the centerlines are replaced by their outlines, and build from the copy. There are two ways to make it: download it from the editor, or run the command-line tool on the designspace and UFOs. Both stroke the glyphs with the same code (`cli/expand-font.js`), so the outlines and the messages are the same. In every glyph, each centerline (each open contour, and each closed contour marked as a centerline) is replaced with its stroked outline; the other closed contours and components stay as they are. The font itself is not changed.

## From the editor

At the bottom of the **Stroke font** panel, press **Download with outlines**. The plugin reads every glyph of the font through Fontra, strokes them in the browser, and downloads `MyFamily-expanded.zip` (named after the font's file). The panel shows how far it is; for a large font this takes a while, and the plugin lets the editor respond in between.

The .zip holds a folder `MyFamily-expanded` with:

- `MyFamily.designspace`: the axes (with their mappings and labels), cross-axis mappings, rules, the sources, and an instance at each source that is not sparse (Fontra does not keep a designspace's instances; add others to the designspace if you need them)
- a UFO for each source that is not sparse, `MyFamily-<source>.ufo`, with the font info, the source's line metrics, kerning, groups and features. A sparse source is a layer of the default source's UFO, as in Fontra's own designspace files

The download is made from what Fontra reads of the font, so it works for a font in any format Fontra opens (a designspace, a UFO, a `.fontra` folder, …), and always writes a designspace and UFOs. Left out of the copy, since fontmake does not use them:

- axes and sources of a glyph's own (a local design space): only the glyph's sources at the font's sources are written, and the glyph gets a warning
- layers that are not sources (background layers), background images, and the guidelines of the font

Known limitations:

- Kerning between right-to-left glyphs (Arabic, Hebrew) is written in Fontra's left-to-right order, while UFOs keep it in writing order. For such fonts, use the command line on the saved designspace and UFOs
- Components with axis values of their own are written to the glyph's lib (`com.black-foundry.variable-components`), as Fontra does, where fontmake does not see them; such glyphs get a warning
- The whole font is held in memory while the copy is made

The messages appear under the button (and in the browser's console), as the lines the command-line tool prints (see below).

## From the command line

```plaintext
npx --yes github:dg4-dev/fontra-stroke-font expand MyFamily.designspace -o build/expanded
```

To use a released version rather than the latest code on `main`, add its tag: `github:dg4-dev/fontra-stroke-font#v0.3.1`. This needs [Node.js](https://nodejs.org/) 22 or later; nothing else is installed. It copies the designspace and its UFOs into `build/expanded` and expands the copy, keeping everything else in the files as it is. The input files are not changed. The output folder must not be the folder of the designspace. Options: `--tolerance N` (the largest distance in font units between a stroked edge and the exact one, default 0.5) and `--quiet`.

It prints:

- `twist:` lines: where strokes twist, by glyph, source and contour
- `warning:` lines: glyphs whose outlines will not interpolate (for example when a centerline has a different number of points in some sources), glyphs that twist in some sources only (see [Twists](how-it-works.md#twists)), and glyphs it leaves as they are

Only the sources listed in the designspace are expanded. Glyphs that have axes or sources of their own in Fontra (a local design space) are reported and expanded only in the designspace sources.

## Build with fontmake

Build from the copy with [fontmake](https://github.com/googlefonts/fontmake) (`pip install fontmake`), for example a variable font:

```plaintext
fontmake -m build/expanded/MyFamily.designspace -o variable --output-dir build/fonts
```

or static fonts of the instances defined in the designspace:

```plaintext
fontmake -m build/expanded/MyFamily.designspace -i -o ttf otf --output-dir build/fonts
```

For the download, use the designspace in the unzipped folder: `MyFamily-expanded/MyFamily.designspace`.

The stroked outlines are separate overlapping contours (a band, plus the shapes of caps and joins). fontmake removes the overlaps of static fonts by default (add `--overlaps-backend pathops` to use skia-pathops, `pip install skia-pathops`, instead of the default booleanOperations). A variable font keeps its overlapping contours, as variable fonts usually do; the copy has `public.truetype.overlap` set in the lib of every glyph that was expanded, and of every glyph that has one of them as a component (directly or through other components), so that the TrueType outlines are flagged as overlapping and render correctly.

[fontra-workflow](https://github.com/fontra/fontra) can read the copy as well (`input: fontra-read` with `source: build/expanded/MyFamily.designspace`). Its `remove-overlaps` filter works per source, so use it only for static fonts: in a variable font, removing overlaps can leave the sources with different points.
