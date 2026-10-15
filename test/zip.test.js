import assert from "node:assert/strict";
import { test } from "node:test";

import { crc32, zipFiles } from "../src/zip.js";
import { unzip } from "./unzip.js";

test("CRC-32 gives the check value of the specification", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
});

test("files are stored with their paths and contents", () => {
  const entries = [
    { path: "Font/Font.designspace", data: "<designspace/>\n" },
    { path: "Font/Fönt-Light.ufo/glyphs/a.glif", data: "ä\n" },
    { path: "Font/empty.txt", data: new Uint8Array() },
  ];
  const bytes = zipFiles(entries, { date: new Date(2026, 9, 15, 12, 34, 56) });
  const files = unzip(bytes);
  assert.deepEqual(
    [...files],
    entries.map(({ path, data }) => [path, typeof data === "string" ? data : ""])
  );
  // The date and time of the first local header: 2026-10-15 12:34:56
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint16(10, true), (12 << 11) | (34 << 5) | 28);
  assert.equal(view.getUint16(12, true), (46 << 9) | (10 << 5) | 15);
});

test("more than 65535 files get the Zip64 end records", () => {
  const entries = Array.from({ length: 70000 }, (_, i) => ({
    path: `f/${i}`,
    data: String(i),
  }));
  const files = unzip(zipFiles(entries));
  assert.equal(files.size, 70000);
  assert.equal(files.get("f/69999"), "69999");
});
