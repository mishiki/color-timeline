import { rgbToMunsell } from "./munsell-data.js";

export const MUNSELL_DISTRIBUTION_VERSION = 1;
export const HUE_BINS = 20;
export const VALUE_BINS = 20;
export const CHROMA_BINS = 20;
export const HUE_WIDTH = 5;
export const VALUE_WIDTH = 0.5;
export const CHROMA_WIDTH = 2;
export const CHROMA_MAX = 40;
export const MAX_BINS = HUE_BINS * VALUE_BINS * CHROMA_BINS;
const ALPHA_THRESHOLD = 24;

function binIndex(h, v, c) {
  const hi = Math.max(0, Math.min(HUE_BINS - 1, Math.floor(((h % 100) + 100) % 100 / HUE_WIDTH)));
  const vi = Math.max(0, Math.min(VALUE_BINS - 1, Math.floor(v / VALUE_WIDTH)));
  const ci = Math.max(0, Math.min(CHROMA_BINS - 1, Math.floor(Math.min(CHROMA_MAX - Number.EPSILON, Math.max(0, c)) / CHROMA_WIDTH)));
  return (hi * VALUE_BINS + vi) * CHROMA_BINS + ci;
}

function emptyBin(h, v, c) {
  return { h, v, c, count: 0, rgbSum: [0, 0, 0], hCos: 0, hSin: 0, cSum: 0, vSum: 0 };
}

function toBytes(rgba) {
  if (rgba instanceof ArrayBuffer) return new Uint8Array(rgba);
  if (ArrayBuffer.isView(rgba)) return new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  if (Array.isArray(rgba)) return rgba;
  throw new TypeError("rgba must be an ArrayBuffer or byte-oriented array");
}

/**
 * Build a fixed-grid distribution of all visible pixels in Munsell HVC.
 * Polygon emphasis is intentionally not applied: this describes the image frame.
 */
export function analyzeMunsellDistribution(rgba, width, height) {
  if (!Number.isSafeInteger(width) || width < 0 || !Number.isSafeInteger(height) || height < 0) {
    throw new RangeError("width and height must be non-negative safe integers");
  }
  const bytes = toBytes(rgba);
  const required = width * height * 4;
  if (!Number.isSafeInteger(required) || bytes.length < required) throw new RangeError("rgba does not contain width * height RGBA pixels");
  const bins = new Map();
  let total = 0;
  let missing = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      if (bytes[offset + 3] < ALPHA_THRESHOLD) continue;
      total++;
      const rgb = [bytes[offset], bytes[offset + 1], bytes[offset + 2]];
      const point = rgbToMunsell(rgb);
      if (!point || ![point.h, point.v, point.c].every(Number.isFinite)) {
        missing++;
        continue;
      }
      const hi = Math.floor((((point.h % 100) + 100) % 100) / HUE_WIDTH);
      const vi = Math.max(0, Math.min(VALUE_BINS - 1, Math.floor(point.v / VALUE_WIDTH)));
      const ci = Math.max(0, Math.min(CHROMA_BINS - 1, Math.floor(Math.min(CHROMA_MAX - Number.EPSILON, Math.max(0, point.c)) / CHROMA_WIDTH)));
      const key = (hi * VALUE_BINS + vi) * CHROMA_BINS + ci;
      let bin = bins.get(key);
      if (!bin) {
        bin = emptyBin(hi * HUE_WIDTH + HUE_WIDTH / 2, vi * VALUE_WIDTH + VALUE_WIDTH / 2, ci * CHROMA_WIDTH + CHROMA_WIDTH / 2);
        bins.set(key, bin);
      }
      bin.count++;
      bin.rgbSum[0] += rgb[0];
      bin.rgbSum[1] += rgb[1];
      bin.rgbSum[2] += rgb[2];
      const rad = point.h * Math.PI / 50;
      bin.hCos += point.c * Math.cos(rad);
      bin.hSin += point.c * Math.sin(rad);
      bin.cSum += point.c;
      bin.vSum += point.v;
    }
  }
  const result = { version: MUNSELL_DISTRIBUTION_VERSION, total, missing, bins: [] };
  for (const bin of bins.values()) {
    const hue = bin.cSum > 1e-12
      ? (Math.atan2(bin.hSin, bin.hCos) * 50 / Math.PI + 100) % 100
      : 0;
    result.bins.push({
      h: hue,
      v: bin.vSum / bin.count,
      // Average in Cartesian chroma coordinates so hues near the 0/100 seam
      // do not inflate the representative chroma.
      c: Math.hypot(bin.hCos, bin.hSin) / bin.count,
      count: bin.count,
      rgb: bin.rgbSum.map((value) => Math.round(value / bin.count)),
    });
  }
  result.bins.sort((a, b) => b.count - a.count || a.v - b.v || a.h - b.h || a.c - b.c);
  return result;
}

export function validateMunsellDistribution(value) {
  if (!value || typeof value !== "object" || value.version !== MUNSELL_DISTRIBUTION_VERSION ||
      !Number.isSafeInteger(value.total) || value.total < 0 || !Array.isArray(value.bins) || value.bins.length > MAX_BINS ||
      !Number.isSafeInteger(value.missing) || value.missing < 0 || value.missing > value.total) {
    throw new Error("マンセル分布が不正です");
  }
  let count = 0;
  const seen = new Set();
  const bins = value.bins.map((bin) => {
    if (!bin || !Number.isFinite(bin.h) || bin.h < 0 || bin.h >= 100 || !Number.isFinite(bin.v) || bin.v < 0 || bin.v > 10 ||
        !Number.isFinite(bin.c) || bin.c < 0 || bin.c > CHROMA_MAX || !Number.isSafeInteger(bin.count) || bin.count < 1 ||
        !Array.isArray(bin.rgb) || bin.rgb.length !== 3 || !bin.rgb.every((channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255)) {
      throw new Error("マンセル分布のビンが不正です");
    }
    const key = `${bin.h.toFixed(6)}:${bin.v.toFixed(6)}:${bin.c.toFixed(6)}`;
    if (seen.has(key)) throw new Error("マンセル分布に重複ビンがあります");
    seen.add(key);
    count += bin.count;
    return { h: bin.h, v: bin.v, c: bin.c, count: bin.count, rgb: bin.rgb.slice() };
  });
  if (count + value.missing !== value.total) throw new Error("マンセル分布の画素数が一致しません");
  return { version: 1, total: value.total, missing: value.missing, bins };
}
