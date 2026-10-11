# Fontra Stroke Font

A [Fontra](https://github.com/fontra/fontra) plugin for designing stroke fonts: draw open contours as centerlines, give each point an elliptical nib, and see the stroked shape while you edit.

This project is in its planning stage. See the issues for the plan.

- **In the editor**: open contours are centerlines. The plugin draws the stroked shape on top of them as a preview; the font sources keep the centerlines
- **Nibs**: an ellipse (long diameter, short diameter, angle) on each on-curve point. The nib also shapes corners and stroke ends; drag its handles on the canvas to change them
- **Weight axis**: nibs can differ per source, and are interpolated between them
- **Before export**: a command-line tool expands the centerlines into outlines in a copy of the font, which then goes to fontmake or fontra-workflow

## License

[GNU General Public License v3.0](LICENSE) (GPL-3.0), the same license as Fontra.
