// ISCC-NBS palette extraction with optional image-polygon weighting.
// Source imagery is never embedded here; callers provide decoded RGBA pixels.

import { ISCC_DATA, classifyRGB } from "./iscc-data.js";
import { rgbToMunsell } from "./munsell-data.js";

export const DEFAULT_SETTINGS = Object.freeze({
  mergeDelta: 0.035,
  chromaTopPercent: 20,
  logStrength: 10,
});

const ALPHA_THRESHOLD = 24;
const CLASSIFICATION_LEVEL = 13;

function rgbToOklab(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  r = r <= 0.04045 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
  g = g <= 0.04045 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
  b = b <= 0.04045 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function dist2(a, b) {
  const x = a[0] - b[0];
  const y = a[1] - b[1];
  const z = a[2] - b[2];
  return x * x + y * y + z * z;
}

export function pointInPolygon(x, y, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const cross = (x - xi) * (yj - yi) - (y - yi) * (xj - xi);
    if (Math.abs(cross) <= 1e-12
      && x >= Math.min(xi, xj) - 1e-12 && x <= Math.max(xi, xj) + 1e-12
      && y >= Math.min(yi, yj) - 1e-12 && y <= Math.max(yi, yj) + 1e-12) {
      return true;
    }
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function normalizeRegions(regions) {
  if (regions == null) return { polygons: [], weight: 1 };
  if (typeof regions !== "object" || Array.isArray(regions)) {
    throw new TypeError("regions must be an object with polygons and weight");
  }
  const weight = regions.weight ?? 1;
  if (!Number.isFinite(weight) || weight < 1 || weight > 8) {
    throw new RangeError("regions.weight must be between 1 and 8");
  }
  const polygons = regions.polygons ?? [];
  if (!Array.isArray(polygons)) throw new TypeError("regions.polygons must be an array");
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || polygon.length < 3
      || polygon.some((point) => !Array.isArray(point) || point.length < 2
        || !Number.isFinite(point[0]) || !Number.isFinite(point[1]))) {
      throw new TypeError("each region polygon must contain at least three finite [x, y] points");
    }
  }
  return { polygons, weight };
}

function regionWeight(x, y, regions) {
  // `some` intentionally unions overlapping polygons instead of multiplying them.
  return regions.polygons.some((polygon) => pointInPolygon(x, y, polygon)) ? regions.weight : 1;
}

function toRGBABytes(rgba) {
  if (rgba instanceof ArrayBuffer) return new Uint8Array(rgba);
  if (ArrayBuffer.isView(rgba)) {
    if (rgba.BYTES_PER_ELEMENT !== undefined && rgba.BYTES_PER_ELEMENT !== 1) {
      throw new TypeError("rgba must be a byte-oriented typed array");
    }
    return new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  }
  if (Array.isArray(rgba)) return rgba;
  throw new TypeError("rgba must be an ArrayBuffer or byte-oriented array");
}

function makeSamples(rgba, width, height, regions) {
  const pixels = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const alpha = rgba[i + 3];
      if (alpha < ALPHA_THRESHOLD) continue;
      const rgb = [rgba[i], rgba[i + 1], rgba[i + 2]];
      pixels.push({
        rgb,
        lab: rgbToOklab(...rgb),
        weight: regionWeight((x + 0.5) / width, (y + 0.5) / height, regions),
      });
    }
  }
  return pixels;
}

function weightedMass(items) {
  return items.reduce((sum, pixel) => sum + pixel.weight, 0);
}

function chromaRepresentative(items, topPercent = 20) {
  if (!items.length) return null;
  const positive = items.filter((pixel) => pixel.weight > 0);
  const active = positive.length ? positive : items;
  const parsedPercent = Number(topPercent);
  const percent = Math.max(1, Math.min(100, Number.isFinite(parsedPercent) ? parsedPercent : 20));
  let candidates = active;
  if (percent < 100) {
    const chromas = active.map((pixel) => Math.hypot(pixel.lab[1], pixel.lab[2])).sort((a, b) => b - a);
    const cutoff = chromas[Math.max(0, Math.ceil(active.length * percent / 100) - 1)];
    // The cutoff is by pixel count, and ties stay in the candidate set.
    candidates = active.filter((pixel) => Math.hypot(pixel.lab[1], pixel.lab[2]) >= cutoff);
  }
  const weighted = positive.length > 0;
  const mass = weighted ? weightedMass(candidates) : candidates.length;
  const mean = [0, 0, 0];
  for (const pixel of candidates) {
    const weight = weighted ? pixel.weight : 1;
    for (let i = 0; i < 3; i++) mean[i] += pixel.lab[i] * weight;
  }
  for (let i = 0; i < 3; i++) mean[i] /= mass;
  let bestDistance = Infinity;
  let representative = candidates[0];
  for (const pixel of candidates) {
    const distance = dist2(pixel.lab, mean);
    if (distance < bestDistance) {
      bestDistance = distance;
      representative = pixel;
    }
  }
  return representative;
}

function makeCategoryMap() {
  const out = new Map();
  for (const category of ISCC_DATA.categories || []) {
    const groupId = category.level1Id ?? category.id;
    const groupName = category.level1Name ?? category.name;
    if (category.id !== undefined && category.id !== null
      && groupId !== undefined && groupId !== null && groupName !== undefined && groupName !== null) {
      out.set(String(category.id), { id: groupId, name: groupName });
    }
  }
  return out;
}

function categoryFor(classification, categoryMap) {
  const id = classification?.id;
  if (id === undefined || id === null || Number(id) === 0) return null;
  return categoryMap.get(String(id)) || null;
}

function categoryCount() {
  const ids = new Set();
  for (const category of ISCC_DATA.categories || []) {
    const id = category.level1Id ?? category.id;
    if (id !== undefined && id !== null) ids.add(String(id));
  }
  return ids.size;
}

function rgbHex(rgb) {
  return "#" + rgb.map((value) => Math.max(0, Math.min(255, Math.round(value)))
    .toString(16).padStart(2, "0")).join("").toUpperCase();
}

function memberSummary(item) {
  return {
    id: item.categoryId,
    name: item.categoryName,
    rgb: item.rgb.slice(),
    share: item.share,
    rawShare: item.rawShare,
  };
}

function mergeIsccPalette(base, groups, threshold, chromaTopPercent = 20) {
  if (!(threshold > 0)) return base;
  const labs = base.map((item) => rgbToOklab(...item.rgb));
  const clusters = base.map((_, index) => [index]);
  const distance = (a, b) => Math.sqrt(dist2(labs[a], labs[b]));
  while (true) {
    let best = Infinity;
    let pair = null;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        if (!clusters[i].some((index) => base[index].weightedMass > 0)
          || !clusters[j].some((index) => base[index].weightedMass > 0)) continue;
        let diameter = 0;
        for (const a of clusters[i]) {
          for (const b of clusters[j]) diameter = Math.max(diameter, distance(a, b));
        }
        if (diameter <= threshold && diameter < best) {
          best = diameter;
          pair = [i, j];
        }
      }
    }
    if (!pair) break;
    const [i, j] = pair;
    clusters[i] = clusters[i].concat(clusters[j]);
    clusters.splice(j, 1);
  }

  return clusters.map((indices) => {
    if (indices.length === 1) return base[indices[0]];
    const members = indices.map((index) => base[index])
      .sort((a, b) => Number(a.categoryId) - Number(b.categoryId));
    const pixels = members.flatMap((member) => groups.get(String(member.categoryId)).pixels);
    const representative = chromaRepresentative(pixels, chromaTopPercent);
    const share = members.reduce((sum, member) => sum + member.share, 0);
    const rawShare = members.reduce((sum, member) => sum + member.rawShare, 0);
    const pixelCount = members.reduce((sum, member) => sum + member.pixelCount, 0);
    const mass = members.reduce((sum, member) => sum + member.weightedMass, 0);
    const traces = members.map(memberSummary);
    return {
      categoryId: members.map((member) => member.categoryId).join("+"),
      categoryName: members.map((member) => member.categoryName).join(" + "),
      classificationLevel: CLASSIFICATION_LEVEL,
      rgb: representative.rgb.slice(),
      hex: rgbHex(representative.rgb),
      munsell: rgbToMunsell(representative.rgb),
      share,
      rawShare,
      pixelCount,
      weightedMass: mass,
      members: traces,
      metrics: { area: share, rawArea: rawShare, pixelCount, weightedMass: mass, members: traces },
    };
  }).sort((a, b) => b.share - a.share || String(a.categoryId).localeCompare(String(b.categoryId)));
}

function makeUnknown(pixels, totalRaw, totalMass, topPercent) {
  const pixelCount = pixels.length;
  if (pixelCount === 0) {
    return {
      categoryId: 0,
      categoryName: "Unknown / 未分類",
      pixelCount: 0,
      weightedMass: 0,
      share: 0,
      rawShare: 0,
    };
  }
  const mass = weightedMass(pixels);
  const representative = chromaRepresentative(pixels, topPercent);
  return {
    categoryId: 0,
    categoryName: "Unknown / 未分類",
    classificationLevel: CLASSIFICATION_LEVEL,
    rgb: representative.rgb.slice(),
    hex: rgbHex(representative.rgb),
    munsell: rgbToMunsell(representative.rgb),
    share: mass / totalMass,
    rawShare: pixelCount / totalRaw,
    pixelCount,
    weightedMass: mass,
    isUnknown: true,
    members: [],
    metrics: {
      area: mass / totalMass,
      rawArea: pixelCount / totalRaw,
      pixelCount,
      weightedMass: mass,
      members: [],
    },
  };
}

/** Analyze visible RGBA pixels into all ISCC-NBS level-13 groups. */
export function analyzeRGBA(rgba, width, height, settings = DEFAULT_SETTINGS, regions = undefined) {
  if (!Number.isSafeInteger(width) || width < 0 || !Number.isSafeInteger(height) || height < 0) {
    throw new RangeError("width and height must be non-negative safe integers");
  }
  const bytes = toRGBABytes(rgba);
  const requiredLength = width * height * 4;
  if (!Number.isSafeInteger(requiredLength) || bytes.length < requiredLength) {
    throw new RangeError("rgba does not contain width * height RGBA pixels");
  }
  const options = { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
  const mergeDeltaValue = Number(options.mergeDelta);
  const mergeDelta = Math.max(0, Math.min(0.15, Number.isFinite(mergeDeltaValue) ? mergeDeltaValue : 0.035));
  const chromaValue = Number(options.chromaTopPercent);
  const chromaTopPercent = Math.max(1, Math.min(100, Number.isFinite(chromaValue) ? chromaValue : 20));
  const weightedRegions = normalizeRegions(regions);
  const pixels = makeSamples(bytes, width, height, weightedRegions);
  const groups = new Map();
  const categoriesByLeaf = makeCategoryMap();
  const unknownPixels = [];
  const totalRaw = pixels.length;
  let lowValueFallbackCount = 0;

  for (const pixel of pixels) {
    const classification = classifyRGB(pixel.rgb);
    if (classification?.lowValueFallback) lowValueFallbackCount++;
    const category = categoryFor(classification, categoriesByLeaf);
    if (!category) {
      unknownPixels.push(pixel);
      continue;
    }
    const key = String(category.id);
    let group = groups.get(key);
    if (!group) {
      group = { categoryId: category.id, categoryName: category.name, pixels: [] };
      groups.set(key, group);
    }
    group.pixels.push(pixel);
  }

  const totalMass = weightedMass(pixels) || 1;
  const palette = [];
  for (const group of groups.values()) {
    const weighted = weightedMass(group.pixels);
    const representative = chromaRepresentative(group.pixels, chromaTopPercent);
    const share = weighted / totalMass;
    const rawShare = group.pixels.length / (totalRaw || 1);
    const item = {
      categoryId: group.categoryId,
      categoryName: group.categoryName,
      classificationLevel: CLASSIFICATION_LEVEL,
      rgb: representative.rgb.slice(),
      hex: rgbHex(representative.rgb),
      munsell: rgbToMunsell(representative.rgb),
      share,
      rawShare,
      pixelCount: group.pixels.length,
      weightedMass: weighted,
    };
    item.members = [memberSummary(item)];
    item.metrics = {
      area: share,
      rawArea: rawShare,
      pixelCount: group.pixels.length,
      weightedMass: weighted,
      members: item.members,
    };
    palette.push(item);
  }
  palette.sort((a, b) => b.share - a.share || Number(a.categoryId) - Number(b.categoryId));
  const merged = mergeIsccPalette(palette, groups, mergeDelta, chromaTopPercent);
  const unknown = makeUnknown(unknownPixels, totalRaw || 1, totalMass, chromaTopPercent);
  if (unknownPixels.length) merged.push(unknown);
  merged.sort((a, b) => b.share - a.share || String(a.categoryId).localeCompare(String(b.categoryId)));

  const unknownRawShare = unknownPixelRawShare(unknown, totalRaw);
  const unknownShare = unknown.share;
  const regionApplied = weightedRegions.polygons.length > 0;
  const bSettings = {
    algorithm: "ISCC-NBS",
    algorithmVersion: "iscc-nbs-13-chroma-v3",
    classificationLevel: CLASSIFICATION_LEVEL,
    mergeDelta,
    chromaTopPercent,
    representativeMethod: "chroma-top-pixel-fraction-weighted-mean-nearest",
    mergeMethod: "complete-link-original-representatives",
    categoryCount: categoryCount(),
  };
  return {
    palette: merged,
    pixelCount: totalRaw,
    visibleRatio: width * height ? totalRaw / (width * height) : 0,
    sampleSize: [width, height],
    alphaThreshold: ALPHA_THRESHOLD,
    algorithmVersion: bSettings.algorithmVersion,
    bSettings,
    classificationLevel: CLASSIFICATION_LEVEL,
    categoryCount: bSettings.categoryCount,
    totalWeightedMass: totalMass === 1 && totalRaw === 0 ? 0 : weightedMass(pixels),
    unknown,
    unknownPixelCount: unknown.pixelCount,
    unknownShare,
    unknownRawShare,
    lowValueFallbackCount,
    regionSettings: { weight: weightedRegions.weight, applied: regionApplied },
    regionsUsed: {
      active: weightedRegions.polygons.length > 0,
      polygons: weightedRegions.polygons,
      weight: weightedRegions.weight,
    },
  };
}

function unknownPixelRawShare(unknown, totalRaw) {
  return totalRaw ? unknown.pixelCount / totalRaw : 0;
}
