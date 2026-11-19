/** Reads a ZIP by hand (end record, central directory, local headers), for tests: no dependency. */
export interface ZipEntry {
  name: string;
  text: string;
  method: number;
  crc: number;
}

export function readZip(zip: Uint8Array): ZipEntry[] {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const dec = new TextDecoder();
  if (zip.byteLength < 22) throw new Error('archive too short');
  const end = zip.byteLength - 22; // shortcut: no archive comment, which the server never writes
  if (v.getUint32(end, true) !== 0x06054b50) throw new Error('no end-of-directory record');
  const count = v.getUint16(end + 10, true);
  if (v.getUint16(end + 8, true) !== count) throw new Error('entry counts disagree');
  let p = v.getUint32(end + 16, true);
  if (p + v.getUint32(end + 12, true) !== end) throw new Error('directory does not end at the end record');
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('bad central header');
    const method = v.getUint16(p + 10, true);
    const crc = v.getUint32(p + 16, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(zip.subarray(p + 46, p + 46 + nameLen));
    if (v.getUint32(local, true) !== 0x04034b50) throw new Error('bad local header');
    if (
      v.getUint32(local + 14, true) !== crc ||
      v.getUint32(local + 18, true) !== v.getUint32(p + 20, true) ||
      v.getUint32(local + 22, true) !== v.getUint32(p + 24, true)
    )
      throw new Error(`local header disagrees with the directory for ${name}`);
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    out.push({ name, method, crc, text: dec.decode(zip.subarray(start, start + size)) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
