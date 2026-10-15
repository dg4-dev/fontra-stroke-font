#!/usr/bin/env node
// Command-line tool of the Fontra Stroke Font plugin.
//
//   fontra-stroke-font expand MyFamily.designspace -o build/expanded/
//   fontra-stroke-font expand MyFamily.fontra -o build/expanded/

import { extname, resolve } from "node:path";
import { parseArgs } from "node:util";

import { DEFAULT_TOLERANCE } from "../src/geometry/offset.js";
import { expandFontra } from "./expand-fontra.js";
import { expandDesignspace } from "./expand.js";

const usage = `Usage: fontra-stroke-font expand FONT -o FOLDER [options]

Copies FONT (a .designspace file and its UFOs, or a .fontra folder) into
FOLDER, with the open contours (centerlines) of every glyph replaced by their
stroked outlines. The input is not changed. Build fonts from the copy, for
example with fontmake.

Options:
  -o, --output FOLDER   Where to write the copy (required). Must not be the
                        folder of FONT
  --tolerance N         Largest distance in font units between a stroked edge
                        and the exact one (default ${DEFAULT_TOLERANCE})
  --remove-stroke-data  Remove the stroke settings (xyz.dg4.stroke) from the
                        glyphs of the copy
  --quiet               Only print warnings
  -h, --help            Show this help
`;

function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        "output": { type: "string", short: "o" },
        "tolerance": { type: "string" },
        "remove-stroke-data": { type: "boolean", default: false },
        "quiet": { type: "boolean", default: false },
        "help": { type: "boolean", short: "h", default: false },
      },
    });
  } catch (e) {
    return fail(e.message);
  }
  const { values, positionals } = parsed;
  if (values.help) {
    process.stdout.write(usage);
    return 0;
  }
  const [command, font, ...extra] = positionals;
  if (command !== "expand" || !font || extra.length) {
    return fail(command && command !== "expand" ? `unknown command: ${command}` : null);
  }
  if (!values.output) {
    return fail("the output folder (-o) is missing");
  }
  const tolerance =
    values.tolerance === undefined ? undefined : Number(values.tolerance);
  if (tolerance !== undefined && !(tolerance > 0)) {
    return fail("--tolerance must be a number larger than 0");
  }

  const expand =
    extname(resolve(font)).toLowerCase() === ".fontra"
      ? expandFontra
      : expandDesignspace;
  let report;
  try {
    report = expand(font, values.output, {
      tolerance,
      removeStrokeData: values["remove-stroke-data"],
    });
  } catch (e) {
    process.stderr.write(`error: ${e.message}\n`);
    return 1;
  }
  for (const warning of report.warnings) {
    process.stderr.write(`warning: ${warning}\n`);
  }
  if (!values.quiet) {
    for (const twist of report.twists) {
      process.stdout.write(`twist: ${twist}\n`);
    }
    process.stdout.write(
      `Expanded ${report.glyphs} glyph${report.glyphs === 1 ? "" : "s"} into ${report.output}\n`
    );
  }
  return 0;
}

function fail(message) {
  if (message) {
    process.stderr.write(`error: ${message}\n\n`);
  }
  process.stderr.write(usage);
  return 2;
}

process.exitCode = main(process.argv.slice(2));
