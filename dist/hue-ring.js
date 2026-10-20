const BIN_COUNT = 360;

function rgbaBytes(rgba) {
  if (rgba instanceof ArrayBuffer) return new Uint8Array(rgba);
  if (rgba instanceof Uint8ClampedArray) {
    return new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  }
  throw new TypeError("rgba must be an ArrayBuffer or Uint8ClampedArray");
}

/** Summarize visible RGBA pixels into exact-degree HSV bins. */
export function summarizeHue(rgba) {
  const bytes = rgbaBytes(rgba);
  if (bytes.length % 4 !== 0) {
    throw new RangeError("rgba byte length must be divisible by four");
  }

  const count = Array(BIN_COUNT).fill(0);
  const s = Array(BIN_COUNT).fill(0);
  const v = Array(BIN_COUNT).fill(0);
  const sv = Array(BIN_COUNT).fill(0);
  let total = 0;
  let achromatic = 0;

  for (let i = 0; i < bytes.length; i += 4) {
    if (bytes[i + 3] < 24) continue;
    total++;

    const r = bytes[i] / 255;
    const g = bytes[i + 1] / 255;
    const b = bytes[i + 2] / 255;
    const hi = Math.max(r, g, b);
    const lo = Math.min(r, g, b);
    const delta = hi - lo;
    if (delta === 0) {
      achromatic++;
      continue;
    }

    let hue;
    if (hi === r) hue = 60 * (((g - b) / delta) % 6);
    else if (hi === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
    hue = ((hue % 360) + 360) % 360;
    const bin = Math.floor(hue) % BIN_COUNT;
    const saturation = hi === 0 ? 0 : delta / hi;

    count[bin]++;
    s[bin] += saturation;
    v[bin] += hi;
    sv[bin] += saturation * hi;
  }

  return { count, s, v, sv, total, achromatic };
}

function control(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
}

function smoothingSigma(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 6;
}

function smoothCircular(values, sigma) {
  if (sigma === 0) return values;
  const kernel = Array(BIN_COUNT);
  let kernelTotal = 0;
  for (let offset = 0; offset < BIN_COUNT; offset++) {
    const distance = Math.min(offset, BIN_COUNT - offset);
    const weight = Math.exp(-0.5 * (distance / sigma) ** 2);
    kernel[offset] = weight;
    kernelTotal += weight;
  }
  for (let i = 0; i < BIN_COUNT; i++) kernel[i] /= kernelTotal;

  const output = Array(BIN_COUNT).fill(0);
  for (let i = 0; i < BIN_COUNT; i++) {
    let sum = 0;
    for (let offset = 0; offset < BIN_COUNT; offset++) {
      sum += values[(i - offset + BIN_COUNT) % BIN_COUNT] * kernel[offset];
    }
    output[i] = sum;
  }
  return output;
}

function hueRgb(hue) {
  const sector = hue / 60;
  const x = 1 - Math.abs((sector % 2) - 1);
  if (sector < 1) return `rgb(255, ${Math.round(x * 255)}, 0)`;
  if (sector < 2) return `rgb(${Math.round(x * 255)}, 255, 0)`;
  if (sector < 3) return `rgb(0, 255, ${Math.round(x * 255)})`;
  if (sector < 4) return `rgb(0, ${Math.round(x * 255)}, 255)`;
  if (sector < 5) return `rgb(${Math.round(x * 255)}, 0, 255)`;
  return `rgb(255, 0, ${Math.round(x * 255)})`;
}

/** Draw a clockwise hue histogram ring, with hue zero at twelve o'clock. */
export function drawHueRing(
  canvas,
  summary,
  { saturation = 1, brightness = 1, smoothing = 6, scale = "auto" } = {},
) {
  const ctx = canvas?.getContext?.("2d");
  const emptyResult = { mass: 0, peak: 0, clipped: false };
  if (!ctx || !canvas.width || !canvas.height) return emptyResult;

  const width = canvas.width;
  const height = canvas.height;
  const size = Math.min(width, height);
  const cx = width / 2;
  const cy = height / 2;
  const baseRadius = size * 0.285;
  const maxExtension = size * 0.19;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#08111f";
  ctx.fillRect(0, 0, width, height);

  const satAmount = control(saturation, 1);
  const brightAmount = control(brightness, 1);
  const sigma = smoothingSigma(smoothing);
  const total = Number.isFinite(summary?.total) && summary.total > 0 ? summary.total : 0;
  const weights = Array(BIN_COUNT).fill(0);

  if (total > 0) {
    const count = summary.count;
    const s = summary.s;
    const v = summary.v;
    const sv = summary.sv;
    for (let i = 0; i < BIN_COUNT; i++) {
      const c = Number(count?.[i]) || 0;
      const sumS = Number(s?.[i]) || 0;
      const sumV = Number(v?.[i]) || 0;
      const sumSV = Number(sv?.[i]) || 0;
      weights[i] = (
        (1 - satAmount) * (1 - brightAmount) * c
        + satAmount * (1 - brightAmount) * sumS
        + (1 - satAmount) * brightAmount * sumV
        + satAmount * brightAmount * sumSV
      ) / total;
    }
  }

  const distribution = smoothCircular(weights, sigma);
  const mass = distribution.reduce((sum, value) => sum + value, 0);
  const peak = distribution.reduce((max, value) => Math.max(max, value), 0);
  const hasData = total > 0 && peak > 0;

  ctx.beginPath();
  ctx.arc(cx, cy, baseRadius, 0, Math.PI * 2);
  ctx.strokeStyle = hasData ? "rgba(191, 211, 233, 0.28)" : "rgba(157, 181, 208, 0.20)";
  ctx.lineWidth = Math.max(1, size / 480);
  ctx.stroke();

  let clipped = false;
  if (hasData) {
    const autoMax = peak;
    const fixedMax = 0.05;
    const scaleMax = scale === "auto" ? autoMax : fixedMax;
    const lineWidth = Math.max(1, (2 * Math.PI * (baseRadius + maxExtension / 2) / BIN_COUNT) * 0.78);
    ctx.lineCap = "butt";
    for (let hue = 0; hue < BIN_COUNT; hue++) {
      const share = distribution[hue];
      if (share <= 0) continue;
      if (scale !== "auto" && share > fixedMax) clipped = true;
      const extension = Math.min(1, share / scaleMax) * maxExtension;
      const angle = (hue - 90) * Math.PI / 180;
      const inner = baseRadius + 1;
      const outer = inner + extension;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
      ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
      ctx.strokeStyle = hueRgb(hue);
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.19, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(157, 181, 208, 0.10)";
    ctx.lineWidth = Math.max(1, size / 600);
    ctx.stroke();
  }

  return { mass, peak, clipped };
}
