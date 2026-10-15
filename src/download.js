// Downloading the font open in the editor with its centerlines turned into
// outlines: a .zip with a designspace and its UFOs, made in the browser with
// the same code as the CLI (cli/expand-font.js). The font itself is not
// changed.

import { expandFontSteps } from "../cli/expand-font.js";
import { fontFiles } from "./font-files.js";
import { zipFiles } from "./zip.js";

// How long to work before letting the page respond, in milliseconds
const WORK_SLICE = 30;

/**
 * @param {object} fontController Fontra's font controller
 * @param {{name: string, onProgress?: (stage: string, done?: number,
 *   total?: number) => void, pause?: () => Promise, now?: () => number,
 *   date?: Date}} options name: the name of the designspace, and of the
 *   folder in the .zip ("<name>-expanded"); onProgress is told the stage
 *   ("reading", "expanding" or "zipping") and how far it is; pause lets the
 *   page respond (a macrotask by default)
 * @returns {Promise<{bytes: Uint8Array, fileName: string, glyphs: number,
 *   warnings: string[], twists: string[]}>} the .zip file, its name, and
 *   what the CLI would print
 */
export async function expandedFontZip(fontController, options) {
  const {
    name,
    onProgress,
    pause = () => new Promise((resolve) => setTimeout(resolve, 0)),
    now = () => performance.now(),
    date,
  } = options;
  let sliceStart = now();
  const breathe = async () => {
    if (now() - sliceStart > WORK_SLICE) {
      await pause();
      sliceStart = now();
    }
  };

  const { files, designspacePath, warnings } = await fontFiles(fontController, {
    name,
    onProgress: async (done, total) => {
      onProgress?.("reading", done, total);
      await breathe();
    },
  });

  const store = {
    read: (path) => files.get(path),
    write: (path, text) => files.set(path, text),
  };
  const steps = expandFontSteps(store, designspacePath);
  let report;
  for (;;) {
    const step = steps.next();
    if (step.done) {
      report = step.value;
      break;
    }
    onProgress?.("expanding", step.value.done, step.value.total);
    await breathe();
  }

  onProgress?.("zipping");
  await pause();
  const folder = `${name}-expanded`;
  const bytes = zipFiles(
    [...files].map(([path, text]) => ({ path: `${folder}/${path}`, data: text })),
    date ? { date } : undefined
  );
  return {
    bytes,
    fileName: `${folder}.zip`,
    glyphs: report.glyphs,
    warnings: [...warnings, ...report.warnings],
    twists: report.twists,
  };
}

/**
 * The name for the copy, from Fontra's project identifier (such as
 * "fonts/MyFamily.designspace"): the file name without its extension, with
 * characters that some systems do not allow in file names replaced.
 */
export function projectName(projectIdentifier, familyName) {
  const file = String(projectIdentifier ?? "")
    .split(/[/\\]/)
    .pop()
    .replace(/\.[^.]*$/, "");
  const cleaned = (file || familyName || "")
    .replace(/[\u0000-\u001f\u007f"*/:<>?\\|]/g, "_")
    .replace(/^[\s.]+|[\s.]+$/g, "");
  return cleaned || "Font";
}

/** Hand bytes to the browser as a downloaded file. */
export function saveFile(bytes, fileName, type = "application/zip") {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Some browsers start the download only after the click has been handled
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
