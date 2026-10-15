# Data format

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
      "<point identifier>": {
        "left": 50,
        "right": 30,
        "join": "round",
        "cornerRadius": 20
      }
    }
  }
}
```

| Key                       | Method | Value                                                                                                                                       |
| ------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `width`                   | width  | Width of the stroke. `left` / `right` set each side separately (from the centerline, looking along the contour)                             |
| `cap`                     | width  | `butt`, `round` or `square`. Only the default source's is used                                                                              |
| `join`                    | width  | `miter`, `round` or `bevel`. Only the default source's is used                                                                              |
| `miterLimit`              | width  | 1 or more                                                                                                                                   |
| `centerline`              | both   | `true` on the on-curve points of a closed contour that is stroked as a centerline. Points only; only the default source's is used           |
| `major`, `minor`, `angle` | nib    | Size of the nib and its angle in degrees (0 is horizontal, counter-clockwise), stored in `[0, 180)`                                         |
| `angleBase`               | nib    | `"centerline"` on a point whose angle is measured from the centerline instead of horizontal. Points only; only the default source's is used |
| `cornerRadius`            | both   | Radius of the corner at the point: the stroke follows an arc of this radius (see [Live corners](how-it-works.md#live-corners)). Points only |

The width method's `defaults` and `points` (`width`, `left`, `right`, `join`, `miterLimit`) are read and written, and `centerline: true` on the on-curve points of a closed contour that is stroked as a centerline (only the default source's marks count). The nib method's `shape`, `major`, `minor`, `angle` in `defaults` and `points` (built-in defaults 120, 30 and 45°), and `angleBase` on points (only the default source's counts), are read and written. A rectangle with `minor` 0 is a flat nib. Choosing the width method in the panel removes the glyph's `xyz.dg4.stroke`. `cornerRadius` on points is read and written for both methods; 0 is the same as none, and it does nothing on smooth points and on the ends of open contours.

Between sources, points are matched by their index in the glyph's path, not by identifier, since each source's layer has identifiers of its own; so per-point values are only interpolated between sources with the same points.

When Fontra saves a designspace and UFOs, the glyph's `customData` goes to the lib of the glyph in the default source (`xyz.fontra.customData`), and each source's `customData` to the lib of the glyph in that source's layer (`xyz.fontra.glyph.source.customData`). Point identifiers are kept in UFOs; other point attributes are not, which is why per-point values are keyed by identifier.
