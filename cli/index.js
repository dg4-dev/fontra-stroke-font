#!/usr/bin/env node
// Command-line tool of the Fontra Stroke Font plugin.
//
//   fontra-stroke-font expand MyFamily.designspace -o build/expanded/

import { parseArgs } from "node:util";

import { DEFAULT_TOLERANCE } from "../src/geometry/offset.js";
import { expandDesignspace } from "./expand.js";

const usage = `Usage: fontra-stroke-font expand DESIGNSPACE -o FOLDER [options]

Copies DESIGNSPACE and its UFOs into FOLDER, with the open contours
(centerlines) of every glyph replaced by their stroked outlines. The input is
not changed. Build fonts from the copy, for example with fontmake.

Options:
  -o, --output FOLDER   Where to write the copy (required). Must not be the
                        folder of DESIGNSPACE
  --tolerance N         Largest distance in font units between a stroked edge
                        and the exact one (default ${DEFAULT_TOLERANCE})
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
        output: { type: "string", short: "o" },
        tolerance: { type: "string" },
        quiet: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
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
  const [command, designspace, ...extra] = positionals;
  if (command !== "expand" || !designspace || extra.length) {
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

  let report;
  try {
    report = expandDesignspace(designspace, values.output, { tolerance });
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
      `Expanded ${report.glyphs} glyph${report.glyphs === 1 ? "" : "s"} into ${report.designspace}\n`
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
