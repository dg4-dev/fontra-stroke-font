# Fontra Stroke Font

A [Fontra](https://github.com/fontra/fontra) plugin for stroke fonts. Draw centerlines, stroke them with a width or a pen nib, and see the stroked shape while you edit. When the font is done, a command-line tool turns the centerlines into outlines for building it.

## Install

In Fontra, open **Application settings → Plugin Manager**, press "+" and enter:

```plaintext
dg4-dev/fontra-stroke-font
```

Then reopen the glyph editor. New versions load by themselves (it can take a while after a release).

## Quick start

1. Draw an open contour with the pen tool (end it without closing it). It is a centerline: its stroke is drawn in gray while you edit.
2. Open the **Stroke font** tab (the S-shaped icon in the right sidebar) and set the width.
3. For a loop such as the bowl of o, 0, D or Q, draw a closed contour, select one of its points and check **Stroke the closed contour as a centerline**. Other closed contours stay ordinary outlines.

The values belong to the source being edited (Light and Bold can differ) and are interpolated between sources. The other glyphs of the text, and components, are drawn with their strokes too. A red ring marks a place where a bend is too tight for the width and the stroke twists.

## Stroke with a width

In the panel: **Width**, **Cap** (butt, round, square), **Join** (miter, round, bevel) and **Miter limit**. Cap and join are the same in all sources.

### Widths per point

Points can have their own width, also different on each side, and corners their own join.

- **In the panel**: select points, then change their values. **Clear point values** removes them.
- **On the canvas**: choose the stroke width tool (the button with a stroke and a handle, next to Fontra's tools). Each point gets a handle on each edge.

| Action                | Changes                                                                       |
| --------------------- | ----------------------------------------------------------------------------- |
| Drag a handle         | The width on both sides                                                       |
| … with Alt (Option)   | The width on that side only                                                   |
| Double-click a handle | Removes the point's own values                                                |
| Right-click           | The join of the selected points, and whether a closed contour is a centerline |

Selected points change together. A point without a width of its own has the source's. Between points, the width changes evenly along a line and smoothly along a curve; longer handles keep the widths of the points for longer.

## Stroke with a pen nib

Choose **Elliptical nib** or **Rectangular nib** under **Stroke with**. The stroke is what the nib covers as it moves along the centerline, as with a broad-edged pen.

| Value      | Meaning                                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| Major axis | Length of the nib                                                                                          |
| Minor axis | Width of the nib. A rectangular nib with 0 is a flat nib                                                   |
| Angle      | Direction of the nib, 0–180°, counter-clockwise from horizontal                                            |
| Angle from | Per point: **Horizontal**, or **Centerline** so that the nib turns with the centerline (0° lies across it) |

Points can have their own values, as with widths. On the canvas, the stroke width tool draws the nib at each point:

| Action                        | Changes                                                     |
| ----------------------------- | ----------------------------------------------------------- |
| Drag the ring                 | The angle (Shift: steps of 15°)                             |
| Drag an end of the major axis | The major axis (Alt: also the angle, following the pointer) |
| Drag an end of the minor axis | The minor axis                                              |
| Double-click a handle         | Removes the point's own values                              |
| Right-click                   | **Angle from** of the selected points                       |

## Display settings

At the top of the panel: show the preview, draw its edge only, fill opacity, show strokes on the other glyphs, show the handles with other tools too, and show the nib at each point. They are saved in the browser, not in the font.

The plugin follows Fontra's display language (English, Chinese, Japanese, German, Dutch, French, Italian, Spanish, Portuguese and Russian).

## Build fonts

The font keeps its centerlines. Make a copy with the centerlines turned into outlines, then build from the copy. This needs [Node.js](https://nodejs.org/) 22 or later; the input files are not changed.

```plaintext
npx --yes github:dg4-dev/fontra-stroke-font#v0.3.1 expand MyFamily.designspace -o build/expanded
fontmake -m build/expanded/MyFamily.designspace -o variable --output-dir build/fonts
```

For static fonts, use `-i -o ttf otf` instead of `-o variable`. The tool lists the glyphs that twist, and those whose sources will not interpolate. It also expands a font kept as a `.fontra` folder, and `--remove-stroke-data` removes the stroke settings from the copy. More: [docs/building-fonts.md](docs/building-fonts.md).

## Known limitations

- Fontra's font overview shows the centerlines, not the strokes
- The handles can be dragged with the stroke width tool only
- Values per point are interpolated only between sources whose glyphs have the same points
- Between a source where a stroke twists and one where it does not, in-between weights come out a little thinner on the inside of the bend
- A rotated or scaled component keeps its nib unchanged in the preview (in the built font it is transformed)
- Live corners come in a later version
- The plugin uses internal parts of Fontra's editor, so a Fontra update can break it

## More

- [CHANGELOG.md](CHANGELOG.md): changes per version
- [docs/building-fonts.md](docs/building-fonts.md): options of the command-line tool, overlaps, fontra-workflow, .fontra fonts
- [docs/data-format.md](docs/data-format.md): how the values are saved in the font
- [docs/how-it-works.md](docs/how-it-works.md): how the strokes are computed
- [CONTRIBUTING.md](CONTRIBUTING.md): development

## License

[GNU General Public License v3.0](LICENSE) (GPL-3.0), the same license as Fontra.
