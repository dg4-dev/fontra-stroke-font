// Writing .zip files without compression (the "stored" method), enough to
// hand a folder of files to the browser's download. No Fontra or DOM
// dependencies, and no libraries: the format is small, and font sources are
// text that the user's own tools compress well enough if needed.
//
// Names are UTF-8 (flag bit 11). More than 65535 files (a large font with
// many sources) get the Zip64 end records; files and archives larger than
// 4 GB are not supported.

const encoder = new TextEncoder();

let crcTable;

/** The CRC-32 of bytes, as in the zip specification (and PNG, gzip). */
export function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const LOCAL_HEADER = 30;
const CENTRAL_HEADER = 46;
const END_RECORD = 22;
const ZIP64_END_RECORD = 56;
const ZIP64_LOCATOR = 20;
const MAX_32 = 0xffffffff;
const MAX_16 = 0xffff;

/**
 * @param {{path: string, data: string|Uint8Array}[]} entries files, by their
 *   path in the archive (folders separated by "/"); strings are written as
 *   UTF-8
 * @param {{date?: Date}} [options] the modification time of every file
 * @returns {Uint8Array} the .zip file
 */
export function zipFiles(entries, { date = new Date() } = {}) {
  const files = entries.map(({ path, data }) => {
    const bytes = typeof data === "string" ? encoder.encode(data) : data;
    return { name: encoder.encode(path), bytes, crc: crc32(bytes) };
  });
  const { time, day } = dosDateTime(date);

  let offset = 0;
  for (const file of files) {
    file.offset = offset;
    offset += LOCAL_HEADER + file.name.length + file.bytes.length;
  }
  const centralStart = offset;
  const centralSize = files.reduce(
    (size, file) => size + CENTRAL_HEADER + file.name.length,
    0
  );
  const zip64 = files.length > MAX_16;
  const total =
    centralStart +
    centralSize +
    (zip64 ? ZIP64_END_RECORD + ZIP64_LOCATOR : 0) +
    END_RECORD;
  if (total > MAX_32) {
    throw new Error("the files are too large for a zip file (4 GB)");
  }

  const output = new Uint8Array(total);
  const view = new DataView(output.buffer);
  // Version needed to extract: 2.0, or 4.5 for Zip64
  const version = zip64 ? 45 : 20;
  const UTF8_NAMES = 0x0800;
  for (const file of files) {
    let at = file.offset;
    view.setUint32(at, 0x04034b50, true);
    view.setUint16(at + 4, 20, true);
    view.setUint16(at + 6, UTF8_NAMES, true);
    view.setUint16(at + 8, 0, true); // stored
    view.setUint16(at + 10, time, true);
    view.setUint16(at + 12, day, true);
    view.setUint32(at + 14, file.crc, true);
    view.setUint32(at + 18, file.bytes.length, true);
    view.setUint32(at + 22, file.bytes.length, true);
    view.setUint16(at + 26, file.name.length, true);
    view.setUint16(at + 28, 0, true);
    at += LOCAL_HEADER;
    output.set(file.name, at);
    output.set(file.bytes, at + file.name.length);
  }
  let at = centralStart;
  for (const file of files) {
    view.setUint32(at, 0x02014b50, true);
    view.setUint16(at + 4, version, true); // made by (MS-DOS attributes)
    view.setUint16(at + 6, 20, true);
    view.setUint16(at + 8, UTF8_NAMES, true);
    view.setUint16(at + 10, 0, true);
    view.setUint16(at + 12, time, true);
    view.setUint16(at + 14, day, true);
    view.setUint32(at + 16, file.crc, true);
    view.setUint32(at + 20, file.bytes.length, true);
    view.setUint32(at + 24, file.bytes.length, true);
    view.setUint16(at + 28, file.name.length, true);
    // Extra field, comment, disk, internal and external attributes: none
    view.setUint32(at + 42, file.offset, true);
    output.set(file.name, at + CENTRAL_HEADER);
    at += CENTRAL_HEADER + file.name.length;
  }
  if (zip64) {
    const recordStart = at;
    view.setUint32(at, 0x06064b50, true);
    view.setBigUint64(at + 4, BigInt(ZIP64_END_RECORD - 12), true);
    view.setUint16(at + 12, version, true);
    view.setUint16(at + 14, version, true);
    // Disk numbers: 0
    view.setBigUint64(at + 24, BigInt(files.length), true);
    view.setBigUint64(at + 32, BigInt(files.length), true);
    view.setBigUint64(at + 40, BigInt(centralSize), true);
    view.setBigUint64(at + 48, BigInt(centralStart), true);
    at += ZIP64_END_RECORD;
    view.setUint32(at, 0x07064b50, true);
    view.setBigUint64(at + 8, BigInt(recordStart), true);
    view.setUint32(at + 16, 1, true); // total number of disks
    at += ZIP64_LOCATOR;
  }
  view.setUint32(at, 0x06054b50, true);
  view.setUint16(at + 8, Math.min(files.length, MAX_16), true);
  view.setUint16(at + 10, Math.min(files.length, MAX_16), true);
  view.setUint32(at + 12, centralSize, true);
  view.setUint32(at + 16, centralStart, true);
  return output;
}

// MS-DOS date and time, in local time, at two-second steps, from 1980 on
function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      Math.floor(date.getSeconds() / 2),
    day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}
