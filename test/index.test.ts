import { pack, unpack, packInto, calcSize, iterUnpack, Struct, StructError } from "../src/index.js";

// ── calcSize ──────────────────────────────────────────────────────────────────

describe("calcSize", () => {
  it.each([
    ["b", 1], ["B", 1], ["h", 2], ["H", 2], ["i", 4], ["I", 4],
    ["l", 4], ["L", 4], ["q", 8], ["Q", 8], ["f", 4], ["d", 8],
    ["?", 1], ["x", 1],
  ])("single '%s' = %d bytes", (fmt, size) => {
    expect(calcSize(fmt)).toBe(size);
  });

  it("compound formats", () => {
    expect(calcSize("IH")).toBe(6);       // 4+2
    expect(calcSize("!IH")).toBe(6);      // prefix doesn't change size
    expect(calcSize(">bBhH")).toBe(6);    // 1+1+2+2
    expect(calcSize("3I")).toBe(12);      // 3×4
    expect(calcSize("4s")).toBe(4);
    expect(calcSize("10x")).toBe(10);
    expect(calcSize("<qd")).toBe(16);     // 8+8
  });
});

// ── Little-endian pack/unpack ─────────────────────────────────────────────────

describe("little-endian (< prefix, default)", () => {
  it("uint8 / int8", () => {
    expect(Array.from(pack("B", 255))).toEqual([0xff]);
    expect(Array.from(pack("b", -1))).toEqual([0xff]);
    expect(unpack("B", new Uint8Array([0xff])).values).toEqual([255]);
    expect(unpack("b", new Uint8Array([0xff])).values).toEqual([-1]);
  });

  it("uint16 / int16 LE", () => {
    expect(Array.from(pack("<H", 0x0102))).toEqual([0x02, 0x01]);
    expect(Array.from(pack("<h", -256))).toEqual([0x00, 0xff]);
    expect(unpack("<H", new Uint8Array([0x02, 0x01])).values).toEqual([0x0102]);
  });

  it("uint32 / int32 LE", () => {
    expect(Array.from(pack("<I", 0x01020304))).toEqual([0x04, 0x03, 0x02, 0x01]);
    const { values } = unpack("<I", new Uint8Array([0x04, 0x03, 0x02, 0x01]));
    expect(values).toEqual([0x01020304]);
  });

  it("float64 LE round-trip", () => {
    const buf = pack("<d", 3.14159);
    expect(unpack("<d", buf).values[0]).toBeCloseTo(3.14159, 5);
  });

  it("float32 LE round-trip", () => {
    const buf = pack("<f", 1.5);
    expect(unpack("<f", buf).values[0]).toBeCloseTo(1.5, 5);
  });
});

// ── Big-endian / network byte order ──────────────────────────────────────────

describe("big-endian (> and ! prefix)", () => {
  it("> uint16 BE", () => {
    expect(Array.from(pack(">H", 0x0102))).toEqual([0x01, 0x02]);
    expect(unpack(">H", new Uint8Array([0x01, 0x02])).values).toEqual([0x0102]);
  });

  it("! (network) == > (big-endian)", () => {
    const a = pack("!I", 0xdeadbeef);
    const b = pack(">I", 0xdeadbeef);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("> IH compound (Wikipedia example)", () => {
    // pack(">IH", 1, 2) → big-endian uint32 1 + uint16 2
    const buf = pack(">IH", 1, 2);
    expect(buf.length).toBe(6);
    expect(Array.from(buf)).toEqual([0, 0, 0, 1, 0, 2]);
    const { values } = unpack(">IH", buf);
    expect(values).toEqual([1, 2]);
  });

  it("> float64 round-trip", () => {
    const buf = pack(">d", Math.PI);
    expect(unpack(">d", buf).values[0]).toBeCloseTo(Math.PI, 10);
  });
});

// ── Count prefix ──────────────────────────────────────────────────────────────

describe("count prefix (repeat)", () => {
  it("3I packs three uint32s", () => {
    const buf = pack("<3I", 1, 2, 3);
    expect(buf.length).toBe(12);
    expect(unpack("<3I", buf).values).toEqual([1, 2, 3]);
  });

  it("2H2B", () => {
    const buf = pack("<2H2B", 0x1234, 0x5678, 0xaa, 0xbb);
    expect(buf.length).toBe(6);
    const { values } = unpack("<2H2B", buf);
    expect(values).toEqual([0x1234, 0x5678, 0xaa, 0xbb]);
  });
});

// ── Pad bytes ─────────────────────────────────────────────────────────────────

describe("pad bytes (x)", () => {
  it("x is zero in pack, skipped in unpack", () => {
    const buf = pack(">BxB", 0xaa, 0xbb);
    expect(buf.length).toBe(3);
    expect(Array.from(buf)).toEqual([0xaa, 0x00, 0xbb]);
    const { values } = unpack(">BxB", buf);
    expect(values).toEqual([0xaa, 0xbb]); // 0x00 skipped
  });

  it("4x inserts four zero bytes", () => {
    const buf = pack("4xB", 0xff);
    expect(buf.length).toBe(5);
    expect(Array.from(buf.subarray(0, 4))).toEqual([0, 0, 0, 0]);
    expect(buf[4]).toBe(0xff);
  });
});

// ── Bool ──────────────────────────────────────────────────────────────────────

describe("bool (?)", () => {
  it("packs true as 1, false as 0", () => {
    const buf = pack("?", true);
    expect(Array.from(buf)).toEqual([1]);
    expect(pack("?", false)[0]).toBe(0);
  });

  it("unpacks 0 as false, nonzero as true", () => {
    expect(unpack("?", new Uint8Array([0])).values).toEqual([false]);
    expect(unpack("?", new Uint8Array([1])).values).toEqual([true]);
    expect(unpack("?", new Uint8Array([42])).values).toEqual([true]);
  });

  it("round-trips bool", () => {
    const buf = pack("??", true, false);
    expect(unpack("??", buf).values).toEqual([true, false]);
  });
});

// ── String (s) ────────────────────────────────────────────────────────────────

describe("string/bytes (s)", () => {
  it("4s pads with zeros", () => {
    const buf = pack("4s", new Uint8Array([0x41, 0x42]));
    expect(Array.from(buf)).toEqual([0x41, 0x42, 0, 0]);
  });

  it("4s truncates long input", () => {
    const buf = pack("4s", new Uint8Array([1, 2, 3, 4, 5, 6]));
    expect(Array.from(buf)).toEqual([1, 2, 3, 4]);
  });

  it("s with string input (UTF-8)", () => {
    const buf = pack("5s", "Hello");
    expect(unpack("5s", buf).values[0]).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(unpack("5s", buf).values[0] as Uint8Array)).toBe("Hello");
  });

  it("compound with s: >4sH", () => {
    const buf = pack(">4sH", new Uint8Array([65, 66, 67, 68]), 0x1234);
    expect(buf.length).toBe(6);
    const { values } = unpack(">4sH", buf);
    expect(Array.from(values[0] as Uint8Array)).toEqual([65, 66, 67, 68]);
    expect(values[1]).toBe(0x1234);
  });
});

// ── BigInt int64/uint64 ───────────────────────────────────────────────────────

describe("int64/uint64 (q/Q) with BigInt", () => {
  it("q round-trips positive BigInt", () => {
    const val = 9007199254740993n; // > MAX_SAFE_INTEGER
    const buf = pack("<q", val);
    expect(buf.length).toBe(8);
    expect(unpack("<q", buf).values).toEqual([val]);
  });

  it("q round-trips negative BigInt", () => {
    const val = -9007199254740993n;
    const buf = pack(">q", val);
    expect(unpack(">q", buf).values).toEqual([val]);
  });

  it("Q round-trips large uint64", () => {
    const val = 18446744073709551615n; // 2^64 - 1
    const buf = pack("<Q", val);
    expect(unpack("<Q", buf).values).toEqual([val]);
  });

  it("accepts Number input for q/Q (coerced to BigInt)", () => {
    const buf = pack("<q", 42);
    expect(unpack("<q", buf).values).toEqual([42n]);
  });
});

// ── offset parameter ──────────────────────────────────────────────────────────

describe("unpack offset", () => {
  it("reads from offset", () => {
    // [0, 0] padding + [0x01, 0x02] uint16 LE
    const buf = new Uint8Array([0x00, 0x00, 0x02, 0x01]);
    const { values, bytesRead } = unpack("<H", buf, 2);
    expect(values).toEqual([0x0102]);
    expect(bytesRead).toBe(2);
  });
});

// ── packInto ──────────────────────────────────────────────────────────────────

describe("packInto", () => {
  it("writes into existing buffer at offset", () => {
    const buf = new Uint8Array(8);
    const written = packInto(buf, 2, ">H", 0xbeef);
    expect(written).toBe(2);
    expect(Array.from(buf)).toEqual([0, 0, 0xbe, 0xef, 0, 0, 0, 0]);
  });

  it("throws if buffer too small", () => {
    const buf = new Uint8Array(4);
    expect(() => packInto(buf, 3, ">H", 1)).toThrow(StructError);
  });
});

// ── iterUnpack ────────────────────────────────────────────────────────────────

describe("iterUnpack", () => {
  it("unpacks multiple records", () => {
    const records = [[1, 10], [2, 20], [3, 30]];
    const buf = new Uint8Array(records.length * 5);
    let off = 0;
    for (const [a, b] of records) { packInto(buf, off, ">BI", a!, b!); off += 5; }
    const result = iterUnpack(">BI", buf);
    expect(result).toEqual([[1, 10], [2, 20], [3, 30]]);
  });

  it("partial trailing bytes are ignored", () => {
    const buf = pack(">H", 0xabcd);
    const extra = new Uint8Array(3);
    extra.set(buf, 0);
    extra[2] = 0xff;
    // iterUnpack with "H" (2 bytes) on 3-byte buffer → 1 record
    expect(iterUnpack(">H", extra)).toEqual([[0xabcd]]);
  });
});

// ── Struct class ──────────────────────────────────────────────────────────────

describe("Struct class", () => {
  it("pre-computes size", () => {
    const s = new Struct(">IH");
    expect(s.size).toBe(6);
    expect(s.format).toBe(">IH");
  });

  it("pack/unpack work the same as functions", () => {
    const s = new Struct("<3H");
    const buf = s.pack(1, 2, 3);
    expect(s.unpack(buf).values).toEqual([1, 2, 3]);
  });

  it("packInto", () => {
    const s = new Struct(">B");
    const buf = new Uint8Array(4);
    s.packInto(buf, 2, 0xfe);
    expect(buf[2]).toBe(0xfe);
  });

  it("iterUnpack", () => {
    const s = new Struct("<H");
    const buf = pack("<3H", 10, 20, 30);
    expect(s.iterUnpack(buf)).toEqual([[10], [20], [30]]);
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe("error handling", () => {
  it("throws StructError on unknown format char", () => {
    expect(() => pack("Z", 0)).toThrow(StructError);
  });

  it("throws StructError on trailing count", () => {
    expect(() => pack("3", 0)).toThrow(StructError);
  });

  it("StructError is an Error", () => {
    expect(new StructError("test")).toBeInstanceOf(Error);
  });
});

// ── Practical: network protocol header ───────────────────────────────────────

describe("practical: network protocol header", () => {
  it("packs and unpacks a DNS-like header", () => {
    // Simplified: [id: H, flags: H, qdcount: H, ancount: H, nscount: H, arcount: H]
    const header = new Struct("!6H");
    const buf = header.pack(0x1234, 0x8180, 1, 2, 0, 0);
    expect(buf.length).toBe(12);
    const { values } = header.unpack(buf);
    expect(values).toEqual([0x1234, 0x8180, 1, 2, 0, 0]);
  });

  it("packs and unpacks a binary file header", () => {
    // magic(4s) + version(H) + flags(B) + reserved(x) + size(I)
    const fmt = ">4sBBI I"; // with padding
    // Simpler: magic(4s) + version(H) + size(I)
    const s = new Struct(">4sHI");
    const magic = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG
    const buf = s.pack(magic, 1, 12345);
    expect(buf.length).toBe(10); // 4+2+4
    const { values } = s.unpack(buf);
    expect(Array.from(values[0] as Uint8Array)).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(values[1]).toBe(1);
    expect(values[2]).toBe(12345);
  });
});

// ── l/L aliases ──────────────────────────────────────────────────────────────

describe("l/L aliases for i/I", () => {
  it("l packs as int32", () => {
    expect(Array.from(pack("<l", -1))).toEqual(Array.from(pack("<i", -1)));
  });
  it("L packs as uint32", () => {
    expect(Array.from(pack(">L", 0xdeadbeef))).toEqual(Array.from(pack(">I", 0xdeadbeef)));
  });
});
