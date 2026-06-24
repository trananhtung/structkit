/**
 * Binary struct packer/unpacker with Python-compatible format strings.
 *
 * Format string syntax:
 *   [byteorder] count* formatchar ...
 *
 * Byte order prefix (optional, default = native little-endian):
 *   <   little-endian
 *   >   big-endian
 *   !   network (= big-endian)
 *   =   native (this impl: little-endian)
 *   @   native with alignment (this impl: same as little-endian, no padding)
 *
 * Format characters:
 *   x   pad byte (no value consumed on pack; skipped on unpack)
 *   ?   bool (uint8: 0=false, nonzero=true)
 *   b   int8
 *   B   uint8
 *   h   int16
 *   H   uint16
 *   i/l int32
 *   I/L uint32
 *   q   int64  (produces/consumes BigInt)
 *   Q   uint64 (produces/consumes BigInt)
 *   f   float32
 *   d   float64
 *   s   char[] — with a count prefix: "4s" = exactly 4 bytes (pads with 0, truncates)
 *               Without count: "s" = 1 byte. Returns Uint8Array.
 *   p   pascal string — count is max buffer size including length byte
 *
 * Examples:
 *   pack(">IH", 65536, 42)    → 6 bytes: uint32 + uint16, big-endian
 *   pack("<3I", 1, 2, 3)      → 12 bytes: three uint32, little-endian
 *   pack("!4s", new Uint8Array([72,105]))  → 4 bytes: "Hi\0\0"
 *   pack("<q", -1n)           → 8 bytes: int64 little-endian
 */

export class StructError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StructError";
  }
}

type ByteOrder = "little" | "big";

interface Token {
  char: string;
  count: number;
}

function parseFormat(fmt: string): { order: ByteOrder; tokens: Token[] } {
  let order: ByteOrder = "little";
  let i = 0;

  if (fmt.length > 0 && "<>!=@".includes(fmt[0]!)) {
    const prefix = fmt[0]!;
    order = prefix === "<" || prefix === "=" || prefix === "@" ? "little" : "big";
    i = 1;
  }

  const tokens: Token[] = [];
  while (i < fmt.length) {
    // skip whitespace
    if (fmt[i] === " ") { i++; continue; }

    // read optional count
    let count = 0;
    while (i < fmt.length && fmt[i]! >= "0" && fmt[i]! <= "9") {
      count = count * 10 + parseInt(fmt[i]!, 10);
      i++;
    }
    if (count === 0) count = 1;

    if (i >= fmt.length) throw new StructError(`Trailing count with no format character in "${fmt}"`);
    const char = fmt[i++]!;
    if (!"xbBhHiIlLqQfd?sp".includes(char)) {
      throw new StructError(`Unknown format character '${char}' in "${fmt}"`);
    }

    tokens.push({ char, count });
  }
  return { order, tokens };
}

function sizeOf(char: string, count: number): number {
  switch (char) {
    case "x": return count;
    case "?": case "b": case "B": return count;
    case "h": case "H": return count * 2;
    case "i": case "I": case "l": case "L": case "f": return count * 4;
    case "q": case "Q": case "d": return count * 8;
    case "s": return count;         // count is byte length
    case "p": return count;         // count is total buffer size (1 + string)
    default: throw new StructError(`Unknown format character '${char}'`);
  }
}

/** Return the byte size of a packed struct. */
export function calcSize(fmt: string): number {
  const { tokens } = parseFormat(fmt);
  return tokens.reduce((s, t) => s + sizeOf(t.char, t.count), 0);
}

/** Pack values into a Uint8Array according to the format string. */
export function pack(fmt: string, ...values: unknown[]): Uint8Array {
  const { order, tokens } = parseFormat(fmt);
  const size = tokens.reduce((s, t) => s + sizeOf(t.char, t.count), 0);
  const buf = new Uint8Array(size);
  const view = new DataView(buf.buffer);
  const le = order === "little";
  let offset = 0;
  let vi = 0;

  for (const { char, count } of tokens) {
    if (char === "x") { offset += count; continue; }

    if (char === "s") {
      const val = values[vi++];
      let src: Uint8Array;
      if (val instanceof Uint8Array) src = val;
      else if (typeof val === "string") src = new TextEncoder().encode(val);
      else throw new StructError(`"s" requires Uint8Array or string, got ${typeof val}`);
      buf.set(src.subarray(0, Math.min(count, src.length)), offset);
      offset += count;
      continue;
    }

    if (char === "p") {
      const val = values[vi++];
      let src: Uint8Array;
      if (val instanceof Uint8Array) src = val;
      else if (typeof val === "string") src = new TextEncoder().encode(val);
      else throw new StructError(`"p" requires Uint8Array or string, got ${typeof val}`);
      const strLen = Math.min(src.length, count - 1);
      buf[offset++] = strLen;
      buf.set(src.subarray(0, strLen), offset);
      offset += count - 1;
      continue;
    }

    const repeat = (char === "s" || char === "p") ? 1 : count;
    for (let j = 0; j < repeat; j++) {
      const val = values[vi++];
      switch (char) {
        case "?": buf[offset++] = val ? 1 : 0; break;
        case "b": view.setInt8(offset++, Number(val)); break;
        case "B": view.setUint8(offset++, Number(val)); break;
        case "h": view.setInt16(offset, Number(val), le); offset += 2; break;
        case "H": view.setUint16(offset, Number(val), le); offset += 2; break;
        case "i": case "l": view.setInt32(offset, Number(val), le); offset += 4; break;
        case "I": case "L": view.setUint32(offset, Number(val), le); offset += 4; break;
        case "q": view.setBigInt64(offset, BigInt(val as bigint), le); offset += 8; break;
        case "Q": view.setBigUint64(offset, BigInt(val as bigint), le); offset += 8; break;
        case "f": view.setFloat32(offset, Number(val), le); offset += 4; break;
        case "d": view.setFloat64(offset, Number(val), le); offset += 8; break;
      }
    }
  }
  return buf;
}

/** Pack values into an existing buffer at the given offset. Returns number of bytes written. */
export function packInto(buffer: Uint8Array, offset: number, fmt: string, ...values: unknown[]): number {
  const packed = pack(fmt, ...values);
  if (offset + packed.length > buffer.length) {
    throw new StructError(`packInto: buffer too small (need ${offset + packed.length} bytes, have ${buffer.length})`);
  }
  buffer.set(packed, offset);
  return packed.length;
}

export interface UnpackResult {
  values: unknown[];
  bytesRead: number;
}

/** Unpack bytes from a buffer at the given offset. */
export function unpack(fmt: string, buffer: Uint8Array, offset = 0): UnpackResult {
  const { order, tokens } = parseFormat(fmt);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const le = order === "little";
  const values: unknown[] = [];
  let pos = offset;

  for (const { char, count } of tokens) {
    if (char === "x") { pos += count; continue; }

    if (char === "s") {
      values.push(buffer.slice(pos, pos + count));
      pos += count;
      continue;
    }

    if (char === "p") {
      const strLen = buffer[pos]!;
      values.push(buffer.slice(pos + 1, pos + 1 + Math.min(strLen, count - 1)));
      pos += count;
      continue;
    }

    const repeat = count;
    for (let j = 0; j < repeat; j++) {
      switch (char) {
        case "?": values.push(buffer[pos++] !== 0); break;
        case "b": values.push(view.getInt8(pos++)); break;
        case "B": values.push(view.getUint8(pos++)); break;
        case "h": values.push(view.getInt16(pos, le)); pos += 2; break;
        case "H": values.push(view.getUint16(pos, le)); pos += 2; break;
        case "i": case "l": values.push(view.getInt32(pos, le)); pos += 4; break;
        case "I": case "L": values.push(view.getUint32(pos, le)); pos += 4; break;
        case "q": values.push(view.getBigInt64(pos, le)); pos += 8; break;
        case "Q": values.push(view.getBigUint64(pos, le)); pos += 8; break;
        case "f": values.push(view.getFloat32(pos, le)); pos += 4; break;
        case "d": values.push(view.getFloat64(pos, le)); pos += 8; break;
      }
    }
  }

  return { values, bytesRead: pos - offset };
}

/** Unpack all matching structs from a buffer (like Python's iter_unpack). */
export function iterUnpack(fmt: string, buffer: Uint8Array): unknown[][] {
  const size = calcSize(fmt);
  if (size === 0) throw new StructError("iterUnpack: format has zero size");
  const results: unknown[][] = [];
  let offset = 0;
  while (offset + size <= buffer.length) {
    results.push(unpack(fmt, buffer, offset).values);
    offset += size;
  }
  return results;
}

/**
 * Struct — an object that pre-parses the format string for repeated use.
 * Equivalent to Python's `struct.Struct(fmt)`.
 */
export class Struct {
  readonly format: string;
  readonly size: number;

  constructor(format: string) {
    this.format = format;
    this.size = calcSize(format);
  }

  pack(...values: unknown[]): Uint8Array { return pack(this.format, ...values); }
  packInto(buffer: Uint8Array, offset: number, ...values: unknown[]): number {
    return packInto(buffer, offset, this.format, ...values);
  }
  unpack(buffer: Uint8Array, offset?: number): UnpackResult {
    return unpack(this.format, buffer, offset);
  }
  iterUnpack(buffer: Uint8Array): unknown[][] { return iterUnpack(this.format, buffer); }
}
