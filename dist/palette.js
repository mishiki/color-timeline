// Algorithm provenance: the unweighted B family-grouping path from this local
// project's earlier palette prototype. This module contains no source imagery.

export const DEFAULT_SETTINGS = Object.freeze({
  neutralSat: 0.08,
  accentSat: 0.58,
  accentMinArea: 0.004,
  hueMerge: 18,
});

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

function oklabToRgb(L, a, b) {
  let l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  let m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  let s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  let r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  let bb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  function gamma(x) {
    x = Math.max(0, Math.min(1, x));
    return 255 * Math.round(1e6 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055)) / 1e6;
  }
  return [gamma(r), gamma(g), gamma(bb)];
}

function rgbToHsv(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

function luminance(r, g, b) {
  const linear = (x) => {
    x /= 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function dist2(a, b) {
  const x = a[0] - b[0];
  const y = a[1] - b[1];
  const z = a[2] - b[2];
  return x * x + y * y + z * z;
}

function makeSamples(rgba, w, h) {
  const pixels = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      const a = rgba[i + 3];
      if (a < 24) continue;
      const hsv = rgbToHsv(r, g, b);
      pixels.push({
        rgb: [r, g, b],
        lab: rgbToOklab(r, g, b),
        hsv,
        y,
        x,
        tile: Math.floor((y / h) * 8) * 8 + Math.floor((x / w) * 8),
        lum: luminance(r, g, b),
      });
    }
  }
  return pixels;
}

function hueDistance(a, b) {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

function circularMeanHue(items) {
  let x = 0;
  let y = 0;
  for (const p of items) {
    const rad = p.hsv.h * Math.PI / 180;
    const w = Math.max(0.01, p.hsv.s);
    x += Math.cos(rad) * w;
    y += Math.sin(rad) * w;
  }
  const d = Math.atan2(y, x) * 180 / Math.PI;
  return (d + 360) % 360;
}

function centroidLab(items) {
  const m = [0, 0, 0];
  for (const p of items) {
    m[0] += p.lab[0];
    m[1] += p.lab[1];
    m[2] += p.lab[2];
  }
  return m.map((v) => v / items.length);
}

function medoidPixel(items, mean) {
  let pick = items[0];
  let best = Infinity;
  for (const p of items) {
    const d = dist2(p.lab, mean);
    if (d < best) {
      best = d;
      pick = p;
    }
  }
  return pick;
}

function familyGroups(pixels, settings) {
  const neutralSat = settings.neutralSat ?? 0.08;
  const hueBins = Array.from({ length: 12 }, () => ({ items: [], hue: null, accent: false }));
  const neutral = [{ items: [], neutral: true }, { items: [], neutral: true }, { items: [], neutral: true }];
  for (const p of pixels) {
    if (p.hsv.s < neutralSat || p.hsv.s === 0) {
      const band = p.lab[0] < 0.34 ? 0 : p.lab[0] < 0.73 ? 1 : 2;
      neutral[band].items.push(p);
    } else {
      const idx = Math.floor(((p.hsv.h + 15) % 360) / 30) % 12;
      hueBins[idx].items.push(p);
    }
  }
  const out = [];
  for (const accent of [false, true]) {
    const bins = hueBins.map((b, i) => {
      const items = b.items.filter((p) => (p.hsv.s >= settings.accentSat) === accent);
      return { idx: i, items, hue: items.length ? circularMeanHue(items) : null, accent };
    }).filter((b) => b.items.length > 0).sort((a, b) => b.items.length - a.items.length);
    const used = new Set();
    for (const anchor of bins) {
      if (used.has(anchor.idx)) continue;
      used.add(anchor.idx);
      const items = anchor.items.slice();
      for (const candidate of bins) {
        if (used.has(candidate.idx)) continue;
        if (hueDistance(anchor.hue, candidate.hue) <= settings.hueMerge) {
          used.add(candidate.idx);
          items.push(...candidate.items);
        }
      }
      out.push({ items, accent, hue: circularMeanHue(items) });
    }
  }
  for (let i = 0; i < neutral.length; i++) {
    if (neutral[i].items.length) out.push({ items: neutral[i].items, accent: false, neutral: true, band: i });
  }
  return out.map((g) => {
    const mean = centroidLab(g.items);
    const rep = medoidPixel(g.items, mean);
    const sat = g.items.reduce((s, p) => s + p.hsv.s, 0) / g.items.length;
    return {
      items: g.items,
      rgb: rep.rgb.slice(),
      lab: rep.lab.slice(),
      share: g.items.length / pixels.length,
      meanSat: sat,
      accent: g.accent,
      neutral: !!g.neutral,
      hue: g.hue,
    };
  });
}

function farthestPixel(pixels, chosen) {
  const used = new Set(chosen.map((c) => c.rgb.join(",")));
  let best = null;
  let bestD = -1;
  for (const p of pixels) {
    if (used.has(p.rgb.join(","))) continue;
    let d = Infinity;
    for (const c of chosen) d = Math.min(d, dist2(p.lab, c.lab));
    if (d > bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

function paletteB(pixels, settings, k) {
  if (!pixels.length) return [];
  const groups = familyGroups(pixels, settings);
  const accentMin = settings.accentMinArea;
  const eligible = groups.filter((g) => g.share >= accentMin && g.accent && g.meanSat >= settings.accentSat);
  const protectedGroups = eligible.slice()
    .sort((a, b) => (b.share * (1 + 2.2 * b.meanSat)) - (a.share * (1 + 2.2 * a.meanSat)))
    .slice(0, Math.min(2, k));
  const chosen = [];
  for (const g of protectedGroups) if (chosen.length < k) chosen.push(g);
  const ranked = groups.slice().sort((a, b) =>
    (b.share * (1 + (b.accent ? 1.3 * b.meanSat : 0))) - (a.share * (1 + (a.accent ? 1.3 * a.meanSat : 0))));
  for (const g of ranked) {
    if (chosen.length >= k) break;
    if (!chosen.includes(g)) chosen.push(g);
  }
  while (chosen.length < k) {
    const far = farthestPixel(pixels, chosen);
    if (!far) break;
    chosen.push({
      rgb: far.rgb.slice(),
      lab: far.lab.slice(),
      share: 0,
      meanSat: far.hsv.s,
      accent: far.hsv.s >= settings.accentSat,
      items: [far],
    });
  }
  if (!chosen.length) return [];
  const labs = chosen.map((g) => g.lab);
  const counts = new Uint32Array(chosen.length);
  const satSum = new Float64Array(chosen.length);
  const lumSum = new Float64Array(chosen.length);
  const tiles = Array.from({ length: chosen.length }, () => new Set());
  const meanLum = pixels.reduce((s, p) => s + p.lum, 0) / pixels.length;
  for (const p of pixels) {
    let best = 0;
    let d = Infinity;
    for (let i = 0; i < labs.length; i++) {
      const q = dist2(p.lab, labs[i]);
      if (q < d) {
        d = q;
        best = i;
      }
    }
    counts[best]++;
    satSum[best] += p.hsv.s;
    lumSum[best] += p.lum;
    tiles[best].add(p.tile);
  }
  const total = pixels.length;
  const result = chosen.map((g, i) => {
    const share = counts[i] / total;
    const meanSat = counts[i] ? satSum[i] / counts[i] : g.meanSat;
    const meanL = counts[i] ? lumSum[i] / counts[i] : meanLum;
    return {
      rgb: g.rgb.slice(),
      share,
      metrics: {
        area: share,
        sat: meanSat,
        contrast: Math.min(1, Math.abs(meanL - meanLum) * 1.8),
        repeat: tiles[i].size / 64,
      },
      accent: !!g.accent,
    };
  }).filter((x) => x.share > 0);
  return result.sort((a, b) => b.share - a.share);
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

function rgbHex(rgb) {
  return "#" + rgb.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** Analyze unweighted full-frame RGBA pixels using the B palette algorithm. */
export function analyzeRGBA(rgba, w, h, settings = DEFAULT_SETTINGS) {
  if (!Number.isSafeInteger(w) || w < 0 || !Number.isSafeInteger(h) || h < 0) {
    throw new RangeError("width and height must be non-negative safe integers");
  }
  const bytes = toRGBABytes(rgba);
  const requiredLength = w * h * 4;
  if (!Number.isSafeInteger(requiredLength) || bytes.length < requiredLength) {
    throw new RangeError("rgba does not contain width * height RGBA pixels");
  }
  const options = { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
  const pixels = makeSamples(bytes, w, h);
  const palette = paletteB(pixels, options, 5).map(({ rgb, share }) => ({ rgb, hex: rgbHex(rgb), share }));
  return { palette, pixelCount: pixels.length };
}
