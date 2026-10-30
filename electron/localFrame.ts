/** Request numbers follow the bundled Device.Request schema; no router get_ping. */
export function classifyLocalFrame(
  frame: Uint8Array,
  target: "dish" | "router",
): "read" | "write" | null {
  if (
    frame.length < 5 ||
    frame[0] !== 0 ||
    new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(1) !== frame.length - 5
  )
    return null;
  let offset = 5;
  const seen = new Set<number>();
  let operation: "read" | "write" | null = null;
  const read =
    target === "dish"
      ? new Set([1004, 1007, 1008, 1017, 2008, 2011, 6000])
      : new Set([1004, 1007, 1008, 1036, 3002, 3009]);
  const write = target === "dish" ? new Set([1001, 1011, 2002, 2017, 2021]) : new Set([1001, 1011]);
  const varint = () => {
    let value = 0,
      shift = 0;
    for (let i = 0; i < 10; i++) {
      if (offset >= frame.length) throw new Error();
      const byte = frame[offset++];
      if (shift < 35) value += (byte & 127) * 2 ** shift;
      if (!(byte & 128)) return value;
      shift += 7;
    }
    throw new Error();
  };
  try {
    while (offset < frame.length) {
      const tag = varint(),
        field = Math.floor(tag / 8),
        wire = tag % 8;
      if (!field || seen.has(field)) return null;
      seen.add(field);
      if (field === 1 || field === 14) {
        if (wire !== 0) return null;
        varint();
        continue;
      }
      if (field === 13) {
        if (wire !== 2) return null;
        const length = varint();
        offset += length;
        if (offset > frame.length) return null;
        continue;
      }
      if (operation || wire !== 2 || (!read.has(field) && !write.has(field))) return null;
      operation = read.has(field) ? "read" : "write";
      const length = varint();
      offset += length;
      if (offset > frame.length) return null;
    }
    return operation;
  } catch {
    return null;
  }
}
