# Development

## Run the plugin from a local copy

Serve your working copy with CORS headers and register its URL as the plugin address. Your edits are picked up each time you reopen the editor.

```plaintext
npx http-server /path/to/fontra-stroke-font -p 8123 --cors -c-1
```

```plaintext
http://localhost:8123
```

After registering, reopen the glyph editor to load the plugin.

## Try a development branch

To try a development branch, enter a URL with the branch name.

```plaintext
https://cdn.jsdelivr.net/gh/dg4-dev/fontra-stroke-font@develop
```

jsDelivr caches branch contents for a while, so updates may not show up right away.

## Files

```plaintext
src/
  start.js            Entry point (init / function in plugin.json)
  geometry/           Stroke calculations (no Fontra or DOM dependencies; shared with the CLI)
    bezier.js           Vector and Bézier helpers
    centerline.js       Splitting a centerline into segments
    fit.js              Cubic pieces in Hermite form
    widths.js           The width along a centerline, from the widths of its points
    offset.js           The width method
    twist.js            Where strokes twist, and the cusps of the evolute
    compatible.js       Stroking all sources of a glyph with the same points
  stroke-data.js      Reading and writing the stroke data in customData
  current-source.js   Which source's values apply to the glyph in the editor
  path-points.js      Reading the points of Fontra paths
  point-edit.js       Reading and changing the values of the selected points
  width-tool.js       The stroke width tool (handles on the canvas)
  handles-layer.js    Fontra visualization layer for the handles
  hit-areas.js        Making the glyphs of the text clickable by their strokes
  reversed-contours.js  Keeping left and right widths on their sides when a contour is reversed
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

## Branching

The repository follows git-flow.

- `main`: released code. jsDelivr's `@latest` loads this branch when there are no tags
- `develop`: integration branch for the next release
- `feature/*`: one branch per feature, branched from `develop` and merged back into `develop`
- `release/*`: release preparation, branched from `develop`, merged into both `main` and `develop`, with a tag on `main`
