# Changelog

Each section can be pasted as the notes of the matching GitHub release.

## 0.1.0

The first release: draw open contours as centerlines in Fontra's glyph editor, see them stroked with a width while you edit, and expand them into outlines before building the font.

### What it does

- **Live preview**: open contours (centerlines) of the glyph being edited are filled with their stroked shape, and follow while you drag points and handles. Closed contours stay ordinary outlines; a glyph can mix both
- **The other glyphs of the text** are drawn with their stroked shapes too, as they will look in the font. Open contours inside components are stroked with the values of the component's glyph
- **Width, cap, join and miter limit** in a sidebar panel (S-shaped stroke icon): caps butt, round or square; joins miter, round or bevel, with a miter limit as in SVG. Saved with the font, and undoable
- **Weight axis**: width and miter limit can differ per source and are interpolated between sources. Cap and join are the same in all sources (those of the default source)
- **Twists**: where a curve bends more sharply than half the width, the stroke is filled without holes, and the preview marks the place with a red ring
- **Display settings**: draw the edge only instead of filling, fill opacity, and whether to stroke the other glyphs
- **Command-line tool** that copies a designspace and its UFOs with every centerline replaced by its stroked outline, keeping the outlines of all sources compatible, so that fontmake can build variable and static fonts from the copy
- Follows Fontra's light and dark themes and its display language (English, 简体中文, 繁體中文, 日本語, Deutsch, Nederlands, Français, Italiano, Español, Português, Русский)

### Install

In Fontra, open **Application settings → Plugin Manager**, press "+" and enter:

```plaintext
dg4-dev/fontra-stroke-font
```

Then reopen the glyph editor.

### Build fonts

Expand the centerlines into a copy of the font (needs [Node.js](https://nodejs.org/) 22 or later), then build from the copy:

```plaintext
npx --yes github:dg4-dev/fontra-stroke-font#v0.1.0 expand MyFamily.designspace -o build/expanded
fontmake -m build/expanded/MyFamily.designspace -o variable --output-dir build/fonts
```

The input files are not changed. See the README for static fonts, overlaps and fontra-workflow.

### Not yet

- The width is the same along a whole stroke (per source); widths per point, pen nibs and live corners come in later versions
- Between a source where a stroke twists and one where it does not, in-between weights come out a little thinner on the inside of the bend; the command-line tool warns about such glyphs
- The stroke width of a component does not scale when the component is scaled
- Fontra's font overview shows the centerlines
- Only the sources of the designspace are expanded; glyphs with axes of their own in Fontra are reported
- The plugin uses internal APIs of Fontra's editor, which may change
