# structkit

[![All Contributors](https://img.shields.io/badge/all_contributors-1-orange.svg?style=flat-square)](#contributors-)

> Zero-dependency TypeScript binary struct packer/unpacker. Python-compatible format strings: `pack("!IH4s", ...)` / `unpack(">3I", buf)`. Little/big/network endian. Port of Python `struct` / Ruby `Array#pack`.

[![npm](https://img.shields.io/npm/v/structkit)](https://www.npmjs.com/package/structkit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Install

```bash
npm install structkit
```

## Quick start

```typescript
import { pack, unpack, calcSize } from "structkit";

// Pack a network protocol header (big-endian)
const buf = pack("!IH", 0xdeadbeef, 42);
// → Uint8Array [0xde, 0xad, 0xbe, 0xef, 0x00, 0x2a]

// Unpack it back
const { values } = unpack("!IH", buf);
// → [0xdeadbeef, 42]

calcSize("!IH");  // → 6
```

## Format string syntax

```
[byteorder] [count]formatchar ...
```

### Byte order prefix

| Prefix | Meaning |
|---|---|
| `<` | little-endian (default) |
| `>` | big-endian |
| `!` | network byte order (= big-endian) |
| `=` | native (this impl: little-endian) |
| `@` | native with alignment (this impl: little-endian) |

### Format characters

| Char | Type | Size | JS type |
|---|---|---|---|
| `x` | pad byte | 1 | (no value) |
| `?` | bool | 1 | boolean |
| `b` | int8 | 1 | number |
| `B` | uint8 | 1 | number |
| `h` | int16 | 2 | number |
| `H` | uint16 | 2 | number |
| `i`/`l` | int32 | 4 | number |
| `I`/`L` | uint32 | 4 | number |
| `q` | int64 | 8 | **bigint** |
| `Q` | uint64 | 8 | **bigint** |
| `f` | float32 | 4 | number |
| `d` | float64 | 8 | number |
| `Ns` | N-byte string | N | Uint8Array |
| `Np` | pascal string | N | Uint8Array |

A count prefix repeats the type: `3I` = three uint32s (12 bytes).  
For `s`, the count is the byte length: `4s` = exactly 4 bytes (zero-padded / truncated).

## Examples

```typescript
import { pack, unpack, packInto, iterUnpack, Struct } from "structkit";

// Repeat count: 3 uint32s
const buf = pack("<3I", 100, 200, 300);
unpack("<3I", buf).values;  // [100, 200, 300]

// Mixed types, big-endian
pack(">bBhH", -1, 255, -256, 65535);  // 6 bytes

// Pad bytes (x) — consumed in pack, skipped in unpack
pack(">BxB", 0xaa, 0xbb);          // [0xaa, 0x00, 0xbb]
unpack(">BxB", buf).values;         // [0xaa, 0xbb]

// Fixed-size byte string
pack("4s", new Uint8Array([65, 66]));  // [65, 66, 0, 0]
pack("4s", "Hi");                      // [72, 105, 0, 0]

// int64 / uint64 — BigInt
pack("<q", -9007199254740993n);
unpack("<Q", pack("<Q", 2n ** 63n)).values;  // [9223372036854775808n]

// Read at offset
unpack(">H", buffer, 4).values;       // skip first 4 bytes

// Write into existing buffer
const out = new Uint8Array(8);
packInto(out, 2, ">H", 0xbeef);      // write 2 bytes at offset 2

// Unpack multiple fixed-size records
iterUnpack(">BI", buf);               // → [[id, size], [id, size], ...]
```

## Struct class (reusable)

Pre-parse the format string for repeated pack/unpack:

```typescript
const header = new Struct("!4sHI");  // magic(4s) + version(H) + size(I)

header.size;   // 10

const buf = header.pack(
  new Uint8Array([0x89, 0x50, 0x4e, 0x47]),  // PNG magic
  1,        // version
  12345,    // size
);

const { values } = header.unpack(buf);
// values[0] → Uint8Array [0x89, 0x50, 0x4e, 0x47]
// values[1] → 1
// values[2] → 12345
```

## Network protocol example

```typescript
import { Struct } from "structkit";

// DNS header (RFC 1035)
const DnsHeader = new Struct("!HHHHHH");
// id, flags, qdcount, ancount, nscount, arcount

const buf = DnsHeader.pack(
  0x1234,   // id
  0x0100,   // flags: standard query
  1,        // 1 question
  0, 0, 0,  // no answers/ns/ar
);

const { values: [id, flags, qdcount] } = DnsHeader.unpack(buf);
```

## API

```typescript
pack(fmt: string, ...values: unknown[]): Uint8Array
unpack(fmt: string, buffer: Uint8Array, offset?: number): { values: unknown[]; bytesRead: number }
packInto(buffer: Uint8Array, offset: number, fmt: string, ...values: unknown[]): number
calcSize(fmt: string): number
iterUnpack(fmt: string, buffer: Uint8Array): unknown[][]

class Struct {
  constructor(format: string)
  readonly format: string
  readonly size: number
  pack(...values: unknown[]): Uint8Array
  unpack(buffer: Uint8Array, offset?: number): { values: unknown[]; bytesRead: number }
  packInto(buffer: Uint8Array, offset: number, ...values: unknown[]): number
  iterUnpack(buffer: Uint8Array): unknown[][]
}

class StructError extends Error {}
```

## Why not binary-parser?

`binary-parser` (zero-dep, 2025) is excellent for **reading** complex binary formats declaratively. `structkit` fills the **write** side — no npm package supports `struct.pack`-style format strings for packing binary data.

## Contributors ✨

This project follows the [all-contributors](https://github.com/all-contributors/all-contributors) specification. Contributions of any kind are welcome — code, docs, bug reports, ideas, reviews! See the [emoji key](https://allcontributors.org/docs/en/emoji-key) for how each contribution is recognized, and open a PR or issue to get involved.

Thanks goes to these wonderful people:

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/trananhtung"><img src="https://avatars.githubusercontent.com/u/30992229?v=4?s=100" width="100px;" alt="Tung Tran"/><br /><sub><b>Tung Tran</b></sub></a><br /><a href="https://github.com/trananhtung/structkit/commits?author=trananhtung" title="Code">💻</a> <a href="#maintenance-trananhtung" title="Maintenance">🚧</a></td>
    </tr>
  </tbody>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

## License

MIT © [trananhtung](https://github.com/trananhtung)
