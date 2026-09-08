"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";

// Node.js built-ins
const crypto = require("crypto");
const fs = require("fs");
const { execFileSync } = require("child_process");

// Path to ffmpeg binary — installed in the backend container.
function findFfmpeg() {
  try {
    execFileSync("/usr/lib/node_modules/ffmpeg-static/ffmpeg", ["-version"], { stdio: "pipe" });
    return "/usr/lib/node_modules/ffmpeg-static/ffmpeg";
  } catch {
    return "ffmpeg";
  }
}
const FFMPEG_PATH = findFfmpeg();

// ─── Generate a fallback clip (procedural keyframes + ffmpeg minterpolate) ──

const FALLBACK_WIDTH = 320;
const FALLBACK_HEIGHT = 320;
const FALLBACK_FPS = 10;
const FALLBACK_KEYFRAMES = 3;

function generateKeyframe(width: number, height: number, idx: number): Buffer {
  const rawData = new Uint8Array(width * height * 4);
  const t = idx / (FALLBACK_KEYFRAMES - 1);
  const phase = t * 2 * Math.PI;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = x / width;
      const ny = y / height;
      const gx = (nx + 0.3 * Math.sin(phase)) % 1;
      const gy = (ny + 0.2 * Math.cos(phase * 0.7)) % 1;
      const idx2 = Math.floor((gx * 0.6 + gy * 0.4) * 255) % 256;
      rawData[(y * width + x) * 4] = idx2;
      rawData[(y * width + x) * 4 + 1] = (idx2 * 2) % 256;
      rawData[(y * width + x) * 4 + 2] = (idx2 * 3) % 256;
      rawData[(y * width + x) * 4 + 3] = 255;
    }
  }

  // Pulsing center circle
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  const pulse = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI);
  const radius = Math.floor(Math.min(width, height) * 0.25 * (0.7 + 0.3 * pulse));
  for (let y = Math.max(0, cy - radius); y < Math.min(height, cy + radius); y++) {
    for (let x = Math.max(0, cx - radius); x < Math.min(width, cx + radius); x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < radius) {
        const ring = Math.floor((dist / radius) * 255) % 256;
        rawData[(y * width + x) * 4] = 255;
        rawData[(y * width + x) * 4 + 1] = ring;
        rawData[(y * width + x) * 4 + 2] = 100;
      }
    }
  }

  // Host figure
  const hx = Math.floor(width * 0.2);
  const hy = Math.floor(height * 0.7);
  for (let y = hy; y < height; y++) {
    for (let x = hx - 15; x < hx + 15; x++) {
      if (x >= 0 && x < width && y >= 0 && y < height) {
        const dist = Math.sqrt((x - hx) ** 2 + (y - hy) ** 2);
        if (dist < 15) {
          const wave = 128 + 64 * Math.sin(t * 4 * Math.PI + x * 0.1 + y * 0.1);
          rawData[(y * width + x) * 4] = 200;
          rawData[(y * width + x) * 4 + 1] = wave;
          rawData[(y * width + x) * 4 + 2] = 150;
        }
      }
    }
  }

  // Encode as PNG
  const zlib = require("zlib");
  const crc32 = (data: Uint8Array): number => {
    let c = 0xFFFFFFFF;
    const table: number[] = [];
    for (let n = 0; n < 256; n++) {
      let v = n;
      for (let k = 0; k < 8; k++) {
        v = (v & 1) ? (0xEDB88320 ^ (v >>> 1)) : (v >>> 1);
      }
      table[n] = v;
    }
    for (let i = 0; i < data.length; i++) {
      c = table[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  };

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 6;
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const ihdrCrc = crc32(ihdrData);
  const ihdr = Buffer.alloc(21);
  ihdr.writeUInt32BE(ihdrData.length, 0);
  ihdr.writeUInt32BE(0x49484452, 4);
  ihdrData.copy(ihdr, 8);
  ihdr.writeUInt32BE(ihdrCrc, 19);

  const compressed = zlib.deflateSync(rawData, { level: 9 });
  const idatCrc = crc32(compressed);
  const idat = Buffer.alloc(4 + 4 + compressed.length + 4);
  idat.writeUInt32BE(compressed.length, 0);
  idat.writeUInt32BE(0x49444154, 4);
  compressed.copy(idat, 8);
  idat.writeUInt32BE(idatCrc, 8 + compressed.length);

  const iend = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82]);

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    ihdr, idat, iend,
  ]);
}

export const generateFallbackClip = action({
  args: { prompt: v.string() },
  handler: async (_ctx, _args): Promise<string> => {
    const clipId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    const tmpDir = `/tmp/fallback-${clipId}`;
    fs.mkdirSync(tmpDir, { recursive: true });

    for (let i = 0; i < FALLBACK_KEYFRAMES; i++) {
      const frame = generateKeyframe(FALLBACK_WIDTH, FALLBACK_HEIGHT, i);
      fs.writeFileSync(`${tmpDir}/keyframe${String(i).padStart(2, "0")}.png`, frame);
    }

    const mp4Filename = `/fallback-clips/${clipId}.mp4`;
    execFileSync(FFMPEG_PATH, [
      "-y",
      "-framerate", "1",
      "-i", `${tmpDir}/keyframe%02d.png`,
      "-vf", "minterpolate=mi_mode=mci:mi_width=256:mi_height=256:me_mode=bidir:me_thresh=100:vsbmc=1:fps=10:format=yuv420p",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-loglevel", "error",
      mp4Filename,
    ], { stdio: "pipe" });

    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

    return `/fallback-clips/${clipId}.mp4`;
  },
});

// ─── Generate video via T2I keyframes + ffmpeg minterpolate ──
// Uses an image model through OmniRoute to generate 3 keyframes, then
// ffmpeg's minterpolate filter to produce smooth motion between them.

export const generateOpenVideo = action({
  args: { prompt: v.string() },
  handler: async (_ctx, args): Promise<string> => {
    const prompt = args.prompt;
    const imageModel = process.env.OMNIROUTE_IMAGE_MODEL ?? "auto";
    const baseUrl = (process.env.OMNIROUTE_BASE_URL ?? "http://localhost:20128/v1").replace(/\/+$/, "");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (process.env.OMNIROUTE_API_KEY) headers.Authorization = `Bearer ${process.env.OMNIROUTE_API_KEY}`;

    const clipId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    const tmpDir = `/tmp/video-${clipId}`;
    fs.mkdirSync(tmpDir, { recursive: true });

    const positions = ["opening", "middle", "closing"];
    const keyframes: string[] = [];

    for (let i = 0; i < positions.length; i++) {
      const t2iPrompt = `${prompt} [Frame ${i + 1} of 3: ${positions[i]} of the scene]`;
      try {
        const resp = await fetch(`${baseUrl}/images/generations`, {
          method: "POST",
          headers,
          body: JSON.stringify({ model: imageModel, prompt: t2iPrompt.slice(0, 1000), n: 1, size: "768x768" }),
        });
        if (!resp.ok) throw new Error(`Image gen ${i + 1}/3: ${resp.status}`);

        const data = (await resp.json()) as { data?: { url?: string; b64_json?: string }[] };
        const images = data?.data?.filter((d) => d !== null) ?? [];
        if (images.length === 0) throw new Error(`No image for keyframe ${i + 1}`);

        const img = images[0];
        const pngPath = `${tmpDir}/keyframe${String(i).padStart(2, "0")}.png`;
        if (img.b64_json) {
          fs.writeFileSync(pngPath, Buffer.from(img.b64_json, "base64"));
        } else if (img.url) {
          const imgResp = await fetch(img.url);
          if (!imgResp.ok) throw new Error(`Download keyframe ${i + 1}`);
          fs.writeFileSync(pngPath, Buffer.from(await imgResp.arrayBuffer()));
        } else {
          throw new Error(`Keyframe ${i + 1} missing data`);
        }
        keyframes.push(pngPath);
      } catch (e) {
        for (const kf of keyframes) { try { fs.unlinkSync(kf); } catch {} }
        throw e;
      }
    }

    const mp4Filename = `/fallback-clips/${clipId}.mp4`;
    try {
      execFileSync(FFMPEG_PATH, [
        "-y",
        "-framerate", "1",
        "-i", `${tmpDir}/keyframe%02d.png`,
        "-vf", "minterpolate=mi_mode=mci:mi_width=320:mi_height=320:me_mode=bidir:me_thresh=100:vsbmc=1:fps=10:format=yuv420p",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-loglevel", "error",
        mp4Filename,
      ], { stdio: "pipe" });
    } catch (e) {
      for (const kf of keyframes) { try { fs.unlinkSync(kf); } catch {} }
      throw new Error("Video interpolation failed");
    }

    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    return `/fallback-clips/${clipId}.mp4`;
  },
});
