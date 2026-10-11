# Fontra Stroke Font

A [Fontra](https://github.com/fontra/fontra) plugin for designing stroke fonts: draw open contours as centerlines, stroke them with a width or a pen nib, and see the stroked shape while you edit.

This project is in its planning stage. See the issues for the plan.

- **In the editor**: open contours are centerlines. The plugin draws the stroked shape on top of them as a preview; the font sources keep the centerlines
- **Ways to stroke**: a width (per point, optionally different on each side) with caps, joins and a miter limit; or a pen nib (ellipse, rectangle or flat pen) with its size and angle per point
- **Live corners**: round a corner of the centerline without changing the centerline itself
- **On the canvas**: drag handles to change widths, nibs and corner radii
- **Weight axis**: these values can differ per source, and are interpolated between them
- **Before export**: a command-line tool expands the centerlines into outlines in a copy of the font, which then goes to fontmake or fontra-workflow

## License

[GNU General Public License v3.0](LICENSE) (GPL-3.0), the same license as Fontra.
