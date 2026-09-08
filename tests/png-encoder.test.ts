// Unit tests for the procedural keyframe PNG encoder in convex/videoAction.ts.
// Run with: bun test

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";

const { generateKeyframe } = await import("../convex/videoAction.ts");

// Minimal PNG chunk parser: returns list of { type, data }.
function parseChunks(buf: Buffer): { type: string; data: Buffer }[] {
  const chunks: { type: string; data: Buffer }[] = [];
  let off = 8; // skip signature
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString("ascii");
    const data = buf.subarray(off + 8, off + 8 + len);
    const crc = buf.readUInt32BE(off + 8 + len);
    // CRC covers chunk type + chunk data (PNG spec).
    const expected = crc32(Buffer.concat([Buffer.from(type, "ascii"), data]));
    assert.equal(crc, expected, `CRC mismatch in ${type} chunk`);
    chunks.push({ type, data });
    off += 12 + len;
  }
  return chunks;
}

// Reference CRC-32 (same polynomial the encoder uses).
function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let v = n;
    for (let k = 0; k < 8; k++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1;
    table[n] = v;
  }
  for (let i = 0; i < data.length; i++) c = table[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

describe("generateKeyframe PNG encoder", () => {
  it("starts with the PNG signature", () => {
    const png = generateKeyframe(320, 320, 0);
    assert.deepEqual(
      [...png.subarray(0, 8)],
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    );
  });

  it("emits exactly IHDR, IDAT, IEND with valid CRCs", () => {
    const png = generateKeyframe(320, 320, 1);
    const chunks = parseChunks(png);
    assert.deepEqual(
      chunks.map((c) => c.type),
      ["IHDR", "IDAT", "IEND"],
    );
  });

  it("writes a correct IHDR (dimensions, 8-bit RGBA)", () => {
    const png = generateKeyframe(320, 320, 2);
    const ihdr = parseChunks(png)[0].data;
    assert.equal(ihdr.length, 13);
    assert.equal(ihdr.readUInt32BE(0), 320); // width
    assert.equal(ihdr.readUInt32BE(4), 320); // height
    assert.equal(ihdr[8], 8); // bit depth
    assert.equal(ihdr[9], 6); // color type: RGBA
  });

  it("prefixes every scanline with a filter byte (0 = None)", () => {
    const width = 48;
    const height = 32;
    const png = generateKeyframe(width, height, 0);
    const idat = parseChunks(png)[1].data;
    const raw = zlib.inflateSync(idat);
    const stride = width * 4 + 1;
    assert.equal(raw.length, stride * height);
    for (let y = 0; y < height; y++) {
      assert.equal(raw[y * stride], 0, `scanline ${y} filter byte != 0`);
    }
  });

  it("decodes to fully opaque RGBA pixels", () => {
    const width = 64;
    const height = 64;
    const png = generateKeyframe(width, height, 0);
    const idat = parseChunks(png)[1].data;
    const raw = zlib.inflateSync(idat);
    const stride = width * 4 + 1;
    for (let y = 0; y < height; y++) {
      const line = raw.subarray(y * stride + 1, (y + 1) * stride);
      for (let x = 0; x < width; x++) {
        assert.equal(line[x * 4 + 3], 255, `alpha at ${x},${y} != 255`);
      }
    }
  });

  it("produces different frames for different indices", () => {
    const a = generateKeyframe(320, 320, 0);
    const b = generateKeyframe(320, 320, 2);
    assert.ok(!a.equals(b), "keyframes 0 and 2 should differ");
  });
});
