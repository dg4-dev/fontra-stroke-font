import assert from "node:assert/strict";
import { test } from "node:test";

import { crc32, zipFiles } from "../src/zip.js";

// Read a .zip by its central directory, as unzip tools do, checking each
// local header and CRC on the way
function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  let count = view.getUint16(end + 10, true);
  let start = view.getUint32(end + 16, true);
  if (count === 0xffff) {
    const locator = end - 20;
    assert.equal(view.getUint32(locator, true), 0x07064b50);
    const record = Number(view.getBigUint64(locator + 8, true));
    assert.equal(view.getUint32(record, true), 0x06064b50);
    count = Number(view.getBigUint64(record + 32, true));
    start = Number(view.getBigUint64(record + 48, true));
  }
  const decoder = new TextDecoder();
  const files = new Map();
  let at = start;
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(at, true), 0x02014b50);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const offset = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    assert.equal(view.getUint32(offset, true), 0x04034b50);
    assert.equal(view.getUint16(offset + 8, true), 0, "stored");
    const dataStart = offset + 30 + view.getUint16(offset + 26, true);
    const data = bytes.subarray(dataStart, dataStart + size);
    assert.equal(crc32(data), crc, name);
    files.set(name, decoder.decode(data));
    at += 46 + nameLength;
  }
  return files;
}

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
