import { crc32 } from 'node:zlib';

/**
 * A STORE-ONLY ZIP WRITER, for building real artefact zips at test time
 * (R-2026-09-29-171, EU-3 m).
 *
 * WHY NOT the `zip` binary. The plants need entries the zip tool will not write as
 * given -- `../x`, `sub/junit-db.xml` -- and an entry whose stored CRC is wrong, so
 * that `unzip -Z1` lists it and `unzip -p` then refuses it. Stored, uncompressed
 * entries make each byte of the archive something the test chose.
 *
 * NOT a general writer: no compression, no ZIP64, no extra fields, no comments.
 */
export interface ZipEntry {
  name: string;
  data: Buffer;
  /** Store the complement of the real CRC-32, so the entry lists but will not extract. */
  badCrc?: boolean;
}

export function makeZip(entries: readonly ZipEntry[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const real = crc32(e.data) >>> 0;
    const crc = e.badCrc ? (real ^ 0xffffffff) >>> 0 : real;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x21, 12); // 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(e.data.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, e.data);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x21, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(e.data.length, 20);
    dir.writeUInt32LE(e.data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += 30 + name.length + e.data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}
