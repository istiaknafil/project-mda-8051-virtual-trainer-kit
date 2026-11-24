export type Image = { code: Uint8Array; used: Uint8Array; entry: number };
export function parseHex(text: string): Image {
  const code = new Uint8Array(65536),
    used = new Uint8Array(65536);
  let base = 0,
    eof = false,
    entry: number | undefined,
    start: number | undefined;
  for (const [index, raw] of text.trim().split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    if (eof) throw new Error("Data after Intel HEX EOF");
    if (!/^:([\da-f]{2})+$/i.test(line))
      throw new Error(`Invalid HEX record at line ${index + 1}`);
    const b = line
      .slice(1)
      .match(/../g)!
      .map((s) => parseInt(s, 16));
    if (b.length !== b[0] + 5)
      throw new Error(`HEX length mismatch at line ${index + 1}`);
    if (b.reduce((a, b) => a + b, 0) % 256)
      throw new Error(`HEX checksum mismatch at line ${index + 1}`);
    const addr = b[1] * 256 + b[2],
      type = b[3],
      data = b.slice(4, -1);
    if (type === 0) {
      for (let i = 0; i < data.length; i++) {
        const a = base + addr + i;
        if (a > 65535) throw new Error("HEX address exceeds 8051 CODE space");
        if (used[a]) throw new Error("Overlapping HEX data");
        code[a] = data[i];
        used[a] = 1;
        entry = entry === undefined ? a : Math.min(entry, a);
      }
    } else if (type === 1) {
      if (data.length || addr) throw new Error("Invalid EOF record");
      eof = true;
    } else if (type === 2 || type === 4) {
      if (data.length !== 2 || addr)
        throw new Error("Invalid extended address record");
      base = (data[0] * 256 + data[1]) * (type === 2 ? 16 : 65536);
    } else if (type === 3 || type === 5) {
      if (data.length !== 4 || addr) throw new Error("Invalid start record");
      start =
        type === 3
          ? (data[0] * 256 + data[1]) * 16 + data[2] * 256 + data[3]
          : data.reduce((a, b) => a * 256 + b, 0);
      if (start > 65535) throw new Error("Entry address exceeds CODE space");
    } else throw new Error(`Unsupported HEX record type ${type}`);
  }
  if (!eof) throw new Error("Missing Intel HEX EOF");
  return { code, used, entry: start ?? entry ?? 0 };
}
const hx = (n: number) => n.toString(16).toUpperCase().padStart(2, "0");
function record(addr: number, type: number, data: number[]) {
  const b = [data.length, addr >> 8, addr & 255, type, ...data];
  return ":" + [...b, -b.reduce((a, b) => a + b, 0) & 255].map(hx).join("");
}
export function exportHex(image: Image) {
  const records: string[] = [];
  for (let a = 0; a < 65536;) {
    if (!image.used[a]) {
      a++;
      continue;
    }
    const start = a,
      data: number[] = [];
    while (a < 65536 && image.used[a] && data.length < 16)
      data.push(image.code[a++]);
    records.push(record(start, 0, data));
  }
  records.push(
    record(0, 5, [0, 0, image.entry >> 8, image.entry & 255]),
    record(0, 1, []),
  );
  return records.join("\r\n") + "\r\n";
}
export function binaryImage(data: Uint8Array, address: number): Image {
  if (
    !Number.isInteger(address) ||
    address < 0 ||
    address + data.length > 65536
  )
    throw new Error("Binary load range exceeds CODE memory");
  const code = new Uint8Array(65536),
    used = new Uint8Array(65536);
  code.set(data, address);
  used.fill(1, address, address + data.length);
  return { code, used, entry: address };
}
export function exportBinary(image: Image) {
  let first = image.used.indexOf(1),
    last = image.used.lastIndexOf(1);
  if (first < 0) first = 0;
  return { address: first, bytes: image.code.slice(first, last + 1) };
}
