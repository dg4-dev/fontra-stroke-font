# Changelog

Each section can be pasted as the notes of the matching GitHub release.

## Unreleased

### Added

- **Pen nibs**: a glyph can be stroked with an elliptical, rectangular or flat nib instead of a width ("Stroke with" in the panel), in the preview and by the command-line tool. Corners and ends take the shape of the nib
- The major axis, minor axis and angle of the nib are set per source and per point in the panel, and follow the centerline between points; between sources they are interpolated, with angles turning the short way (170° and 10° meet at 180°)
- **Nib handles**: the stroke width tool draws the nib of each point with handles at the ends of its axes. Dragging an end of the major axis sizes and turns the nib (Alt: size only, Shift: steps of 15°), an end of the minor axis sizes the minor axis. A setting draws the nibs with the other tools too

### Changed

- The setting "Show width handles with other tools too" is now "Show handles with other tools too", for nib handles as well

## 0.2.0

Widths per point: a stroke can now get wider and thinner along its centerline, differently on each side, and its corners can each have their own join. Widths are changed in the sidebar panel or by dragging handles on the canvas. Closed contours can be stroked as loops, for letters such as o, 0, D and Q.

### Added

- **Widths per point**: a point of a centerline can have its own width, the same on both sides or different on each side, and a corner its own join and miter limit. Between points the width follows a smooth curve along the centerline; a point in the middle without a width of its own follows the points around it, so adding a point does not change the stroke
- **Stroke width tool** (the button with a stroke and a handle, next to Fontra's tools): handles on the edges of the points, dragged to change the width on both sides (or on one side with Alt); a double click removes a point's values, and the context menu sets the join of the selected points. Elsewhere the tool works like the pointer tool, so points can be moved without switching tools
- **Panel**: the values of the selected points, changed for all of them at once; a button to clear them; a setting to show the handles with the other tools too
- **Closed centerlines**: a closed contour can be marked as a centerline and is then stroked as a loop, for o, 0, D, Q and the like (in the panel, or in the context menu of the stroke width tool). Loops without corners become rings; loops with corners get joins. Marks are kept per contour, on its points, and are the same in all sources
- Per-point values are written to every source being edited, interpolated between sources with the same points, used for components (with left and right swapped in flipped ones), and used by the command-line tool

### Fixed

- A glyph made only of straight two-point centerlines (such as l or -) lost its fill when selected or hovered in the glyph editor, and got Fontra's placeholder for empty glyphs drawn over it: Fontra takes such a glyph for an empty one
- The number fields of the panel could show the browser's own "invalid value" message (in the browser's language) for values such as interpolated widths, and a field kept its old value when the selection changed after Enter
- A faint seam could show where a join meets the strokes of a corner
- Clicking a stroke in the glyph editor did not select its glyph outside the area of its centerlines, and for a glyph of straight two-point centerlines only within its advance width, which could select the glyph next to it instead (#29)

### Changed

- Round joins are drawn as a fan on the outer side of the corner instead of a full circle. The filled shape is the same for equal widths on both sides, but the outlines written by the command-line tool have different points at round joins than with 0.1.0
- Fonts made with 0.1.0 need no changes: their closed contours stay outlines until they are marked as centerlines

### Install or update

In Fontra, open **Application settings → Plugin Manager**, press "+" and enter:

```plaintext
dg4-dev/fontra-stroke-font
```

If it is already there, it loads the new version by itself (jsDelivr may take a while to notice it). Then reopen the glyph editor.

### Build fonts

Expand the centerlines into a copy of the font (needs [Node.js](https://nodejs.org/) 22 or later), then build from the copy:

```plaintext
npx --yes github:dg4-dev/fontra-stroke-font#v0.2.0 expand MyFamily.designspace -o build/expanded
fontmake -m build/expanded/MyFamily.designspace -o variable --output-dir build/fonts
```

The input files are not changed. See the README for static fonts, overlaps and fontra-workflow.

### Not yet

- Pen nibs and live corners come in later versions
- Widths per point are interpolated only between sources whose glyphs have the same points
- The width handles can only be dragged with the stroke width tool, not with Fontra's pointer tool
- Between a source where a stroke twists and one where it does not, in-between weights come out a little thinner on the inside of the bend; the command-line tool warns about such glyphs
- The stroke width of a component does not scale when the component is scaled
- Fontra's font overview shows the centerlines
- Only the sources of the designspace are expanded; glyphs with axes of their own in Fontra are reported
- The plugin uses internal APIs of Fontra's editor, which may change

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
