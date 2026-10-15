// Reading .zip files in tests, by their central directory as unzip tools do,
// checking each local header and CRC on the way.

import assert from "node:assert/strict";

import { crc32 } from "../src/zip.js";

/** The files of a stored (uncompressed) .zip: path → text. */
export function unzip(bytes) {
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
