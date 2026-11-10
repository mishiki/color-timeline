const CHROMA_RANGE = 40;
const CHROMA_STEP = 4;
const HEIGHT_RADIUS = 0.76;
const HUE_NAMES = ["R", "YR", "Y", "GY", "G", "BG", "B", "PB", "P", "RP"];
const BACKGROUND = "#0b1220";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const wrapHue = (h) => ((h % 100) + 100) % 100;

function worldPoint(h, v, c) {
  const angle = wrapHue(h) * Math.PI * 2 / 100;
  const radius = c / CHROMA_RANGE;
  return {
    x: Math.cos(angle) * radius,
    y: (v / 5 - 1) * HEIGHT_RADIUS,
    z: Math.sin(angle) * radius,
  };
}

/** Project a Munsell HVC point into CSS-pixel canvas coordinates. */
export function projectMunsellPoint(
  point,
  camera = {},
  viewport = {},
) {
  const width = Math.max(1, Number(viewport.width) || 1);
  const height = Math.max(1, Number(viewport.height) || 1);
  const yaw = Number(camera.yaw) || 0;
  const pitch = Number(camera.pitch) || 0;
  const distance = Math.max(0.1, Number(camera.distance) || 4.2);
  const p = worldPoint(Number(point.h) || 0, Number(point.v) || 0, Number(point.c) || 0);
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);
  const right = p.x * cy - p.z * sy;
  const up = -p.x * sy * sp + p.y * cp - p.z * cy * sp;
  const depth = p.x * sy * cp + p.y * sp + p.z * cy * cp;
  const focal = Math.min(width, height) * 1.65;
  const scale = focal / Math.max(0.2, distance - depth);
  return {
    x: width / 2 + right * scale,
    y: height / 2 - up * scale,
    depth,
    scale,
  };
}

function hueLabel(h) {
  const hue = wrapHue(h);
  const sector = Math.floor(hue / 10);
  const within = hue - sector * 10;
  if (within < 1e-8) {
    const previous = (sector + HUE_NAMES.length - 1) % HUE_NAMES.length;
    return `10${HUE_NAMES[previous]}`;
  }
  return `${Number(within.toFixed(1))}${HUE_NAMES[sector]}`;
}

function formatValue(value) {
  return Number(value).toFixed(1).replace(/\.0$/, "");
}

function normalizePalette(palette) {
  const entries = Array.isArray(palette)
    ? palette
    : Array.isArray(palette?.colors)
      ? palette.colors
      : [];
  const points = [];
  entries.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    const munsell = entry.munsell;
    const { h, v, c } = munsell || {};
    let rgb = typeof entry.rgb === "string" ? entry.rgb.trim() : entry.hex;
    if (Array.isArray(entry.rgb) && entry.rgb.length === 3
      && entry.rgb.every((channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255)) {
      rgb = `#${entry.rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
    }
    if (!Number.isFinite(h) || h < 0 || h > 100) return;
    if (!Number.isFinite(v) || v < 0 || v > 10) return;
    if (!Number.isFinite(c) || c < 0 || typeof rgb !== "string" || !/^#(?:[\da-f]{6})$/i.test(rgb)) return;
    const share = Number(entry.share);
    const rawShare = Number(entry.rawShare);
    points.push({
      ...entry,
      rgb: rgb.toLowerCase(),
      share: Number.isFinite(share) && share >= 0 && share <= 1 ? share : 0,
      rawShare: Number.isFinite(rawShare) && rawShare >= 0 && rawShare <= 1 ? rawShare : undefined,
      categoryName: typeof entry.categoryName === "string" ? entry.categoryName : "",
      munsell: { h: wrapHue(h), v, c, approximate: Boolean(munsell?.approximate) },
      index,
    });
  });
  return points;
}

function normalizeDistribution(distribution) {
  if (!distribution || typeof distribution !== "object") return null;
  const source = Array.isArray(distribution.bins) ? distribution.bins : [];
  const total = Number(distribution.total);
  const bins = source.map((bin) => {
    if (!bin || typeof bin !== "object") return null;
    const h = Number(bin.h), v = Number(bin.v), c = Number(bin.c);
    const count = Number(bin.count);
    if (![h, v, c, count].every(Number.isFinite) || count <= 0
      || h < 0 || h > 100 || v < 0 || v > 10 || c < 0 || c > CHROMA_RANGE) return null;
    const rgb = Array.isArray(bin.rgb) && bin.rgb.length === 3
      && bin.rgb.every((channel) => Number.isFinite(channel))
      ? bin.rgb.map((channel) => clamp(Math.round(channel), 0, 255))
      : [128, 150, 170];
    return {
      h: wrapHue(h), v, c, count, rgb,
      hStep: Number.isFinite(Number(bin.hStep)) ? clamp(Number(bin.hStep), 0.25, 25) : 5,
      vStep: Number.isFinite(Number(bin.vStep)) ? clamp(Number(bin.vStep), 0.05, 2) : 0.5,
      cStep: Number.isFinite(Number(bin.cStep)) ? clamp(Number(bin.cStep), 0.25, 8) : 2.5,
    };
  }).filter(Boolean);
  if (!bins.length) return null;
  const computedTotal = bins.reduce((sum, bin) => sum + bin.count, 0);
  return { version: 1, total: Number.isFinite(total) && total > 0 ? total : computedTotal, bins };
}

function rgbCss(rgb) {
  return `rgb(${rgb.map((channel) => Math.round(clamp(channel, 0, 255))).join(",")})`;
}

function pointPosition(point, camera, width, height) {
  const projected = projectMunsellPoint(
    point.munsell,
    camera,
    { width, height },
  );
  return { ...projected, radius: point.radius };
}

function drawPolyline(ctx, vertices, style, lineWidth = 1) {
  if (!vertices.length) return;
  ctx.beginPath();
  ctx.moveTo(vertices[0].x, vertices[0].y);
  for (let i = 1; i < vertices.length; i++) ctx.lineTo(vertices[i].x, vertices[i].y);
  ctx.strokeStyle = style;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function strokeLabel(ctx, text, x, y, align = "center") {
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = BACKGROUND;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = "#c5d2df";
  ctx.fillText(text, x, y);
}

function saveAttribute(element, name) {
  return element.hasAttribute(name) ? element.getAttribute(name) : null;
}

function restoreAttribute(element, name, value) {
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}

function distanceBetween(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Create an interactive, dependency-free Munsell HVC canvas view.
 * `setPalette` accepts entries with `rgb`, `share`, `categoryName`, and
 * `munsell: { h, v, c, approximate }`. Entries without valid HVC data are skipped.
 */
export function createMunsellView(canvas, { onSelect } = {}) {
  if (!canvas || typeof canvas.getContext !== "function") {
    throw new TypeError("createMunsellView requires a canvas element");
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("A 2D canvas context is unavailable");

  const doc = canvas.ownerDocument || globalThis.document;
  const original = {
    role: saveAttribute(canvas, "role"),
    label: saveAttribute(canvas, "aria-label"),
    shortcuts: saveAttribute(canvas, "aria-keyshortcuts"),
    tabIndex: saveAttribute(canvas, "tabindex"),
    title: saveAttribute(canvas, "title"),
    touchAction: canvas.style?.touchAction ?? "",
    cursor: canvas.style?.cursor ?? "",
  };
  const camera = { yaw: -0.64, pitch: 0.36, distance: 4.2 };
  const home = { ...camera };
  let points = [];
  let distribution = null;
  let distributionOptions = { mode: "both", scale: "log", vMin: 0, vMax: 10 };
  let positions = [];
  let width = 1;
  let height = 1;
  let dpr = 1;
  let hovered = -1;
  let selected = -1;
  let destroyed = false;
  let pinchDistance = 0;
  const pointers = new Map();
  let drag = null;

  canvas.setAttribute("role", "application");
  canvas.setAttribute(
    "aria-label",
    "Munsell HVC 三次元表示。ドラッグまたは矢印キーで回転、ホイールで拡大縮小、Home キーで視点をリセット。色点を選ぶと詳細を表示します。",
  );
  canvas.setAttribute("aria-keyshortcuts", "ArrowUp ArrowDown ArrowLeft ArrowRight Home Enter Escape + -");
  canvas.tabIndex = 0;
  if (canvas.style) {
    canvas.style.touchAction = "none";
    canvas.style.cursor = "grab";
  }

  const tooltip = doc?.createElement?.("div") || null;
  if (tooltip && doc.body) {
    tooltip.setAttribute("role", "tooltip");
    tooltip.hidden = true;
    Object.assign(tooltip.style, {
      position: "fixed",
      zIndex: "2147483647",
      maxWidth: "260px",
      padding: "7px 9px",
      border: "1px solid rgba(185, 203, 221, .35)",
      borderRadius: "6px",
      background: "rgba(8, 15, 27, .96)",
      color: "#ecf3fa",
      font: "12px/1.45 system-ui, sans-serif",
      whiteSpace: "pre-line",
      pointerEvents: "none",
      boxShadow: "0 4px 18px rgba(0, 0, 0, .28)",
    });
    doc.body.append(tooltip);
  }

  function updateTooltip(point, clientX, clientY) {
    if (!point || !tooltip) {
      if (tooltip) tooltip.hidden = true;
      canvas.title = original.title || "";
      return;
    }
    const { h, v, c } = point.munsell;
    const areaShare = point.rawShare ?? point.share;
    const sharePercent = areaShare * 100;
    const lines = [
      point.categoryName || `色 ${point.index + 1}`,
      `${point.rgb.toUpperCase()} · 元面積 ${sharePercent.toFixed(1)}%`,
      `${hueLabel(h)} ${formatValue(v)} / ${formatValue(c)} · 近似値`,
    ];
    tooltip.textContent = lines.join("\n");
    tooltip.hidden = false;
    const x = Number.isFinite(clientX) ? clientX : 12;
    const y = Number.isFinite(clientY) ? clientY : 12;
    const tipWidth = tooltip.offsetWidth || 240;
    const tipHeight = tooltip.offsetHeight || 66;
    tooltip.style.left = `${clamp(x + 12, 8, Math.max(8, (doc?.defaultView?.innerWidth || width) - tipWidth - 8))}px`;
    tooltip.style.top = `${clamp(y + 12, 8, Math.max(8, (doc?.defaultView?.innerHeight || height) - tipHeight - 8))}px`;
    canvas.title = lines.join(" · ");
  }

  function resize() {
    if (destroyed) return;
    const bounds = canvas.getBoundingClientRect?.();
    width = Math.max(1, bounds?.width || canvas.clientWidth || canvas.width || 640);
    height = Math.max(1, bounds?.height || canvas.clientHeight || canvas.height || 360);
    dpr = Math.max(1, Number(doc?.defaultView?.devicePixelRatio) || 1);
    const targetWidth = Math.round(width * dpr);
    const targetHeight = Math.round(height * dpr);
    if (canvas.width !== targetWidth) canvas.width = targetWidth;
    if (canvas.height !== targetHeight) canvas.height = targetHeight;
    sizeMarkers();
    render();
  }

  function projectWorld(p) {
    const widthNow = width;
    const heightNow = height;
    const sy = Math.sin(camera.yaw);
    const cy = Math.cos(camera.yaw);
    const sp = Math.sin(camera.pitch);
    const cp = Math.cos(camera.pitch);
    const right = p.x * cy - p.z * sy;
    const up = -p.x * sy * sp + p.y * cp - p.z * cy * sp;
    const depth = p.x * sy * cp + p.y * sp + p.z * cy * cp;
    const focal = Math.min(widthNow, heightNow) * 1.65;
    const scale = focal / Math.max(0.2, camera.distance - depth);
    return {
      x: widthNow / 2 + right * scale,
      y: heightNow / 2 - up * scale,
      depth,
      scale,
    };
  }

  function drawGrid() {
    for (let chroma = CHROMA_STEP; chroma <= CHROMA_RANGE; chroma += CHROMA_STEP) {
      const radius = chroma / CHROMA_RANGE;
      const outer = chroma === CHROMA_RANGE;
      const alpha = outer ? 0.23 : 0.085 + (chroma / CHROMA_RANGE) * 0.045;
      const color = `rgba(164, 185, 208, ${alpha})`;
      for (let v = 0; v <= 10; v += 2) {
        const vertices = [];
        for (let step = 0; step <= 100; step += 2) {
          const angle = step * Math.PI * 2 / 100;
          vertices.push(projectWorld({
            x: Math.cos(angle) * radius,
            y: (v / 5 - 1) * HEIGHT_RADIUS,
            z: Math.sin(angle) * radius,
          }));
        }
        drawPolyline(ctx, vertices, color, outer ? 1.05 : 0.75);
      }
      for (let hue = 0; hue < 100; hue += 10) {
        const angle = hue * Math.PI * 2 / 100;
        const bottom = projectWorld({
          x: Math.cos(angle) * radius,
          y: -HEIGHT_RADIUS,
          z: Math.sin(angle) * radius,
        });
        const top = projectWorld({
          x: Math.cos(angle) * radius,
          y: HEIGHT_RADIUS,
          z: Math.sin(angle) * radius,
        });
        drawPolyline(ctx, [bottom, top], `rgba(164, 185, 208, ${outer ? 0.20 : 0.07})`, outer ? 0.95 : 0.7);
      }
    }
  }

  function drawNeutralAxis() {
    const bottom = projectWorld({ x: 0, y: -HEIGHT_RADIUS, z: 0 });
    const top = projectWorld({ x: 0, y: HEIGHT_RADIUS, z: 0 });
    drawPolyline(ctx, [bottom, top], "rgba(224, 235, 246, .75)", 1.35);
    ctx.font = "10px system-ui, sans-serif";
    for (let v = 0; v <= 10; v++) {
      const p = projectWorld({ x: 0, y: (v / 5 - 1) * HEIGHT_RADIUS, z: 0 });
      ctx.beginPath();
      ctx.moveTo(p.x - 3.5, p.y);
      ctx.lineTo(p.x + 3.5, p.y);
      ctx.strokeStyle = "rgba(224, 235, 246, .66)";
      ctx.lineWidth = 1;
      ctx.stroke();
      strokeLabel(ctx, `V${v}`, p.x - 7, p.y, "right");
    }
  }

  function cubeVertices(bin, response) {
    // The histogram amount is encoded as volume: side length is proportional
    // to the cube root of the bin share.  The cube itself is Cartesian in the
    // displayed HVC solid; HVC is used only to locate its centre.
    const center = worldPoint(bin.h, bin.v, bin.c);
    const halfSize = 0.18 * Math.cbrt(clamp(response, 0, 1));
    const vertices = [];
    for (const y of [-halfSize, halfSize]) {
      for (const z of [-halfSize, halfSize]) {
        for (const x of [-halfSize, halfSize]) {
          vertices.push(projectWorld({ x: center.x + x, y: center.y + y, z: center.z + z }));
        }
      }
    }
    return vertices;
  }

  function distributionResponse(share) {
    const safe = clamp(share, 0, 1);
    if (distributionOptions.scale === "linear") return safe;
    return Math.log1p(100 * safe) / Math.log(101);
  }

  function drawDistribution() {
    if (!distribution || distributionOptions.mode === "palette") return;
    const bins = distribution.bins.filter((bin) => bin.v >= distributionOptions.vMin && bin.v <= distributionOptions.vMax);
    if (!bins.length) return;
    const total = Math.max(1e-12, distribution.total);
    const faces = [];
    for (const bin of bins) {
      const share = clamp(bin.count / total, 0, 1);
      const response = distributionResponse(share);
      const vertices = cubeVertices(bin, response);
      // [v,c,h] layout: c=0/1, h=0/1 within each vertical layer.
      const faceIndices = [
        [0, 1, 3, 2], [4, 6, 7, 5], // inner / outer chroma
        [0, 4, 5, 1], [2, 3, 7, 6], // lower / upper V
        [0, 2, 6, 4], [1, 5, 7, 3], // hue sides
      ];
      for (const indices of faceIndices) {
        const polygon = indices.map((index) => vertices[index]);
        const depth = polygon.reduce((sum, point) => sum + point.depth, 0) / polygon.length;
        faces.push({ polygon, depth, bin, response, share });
      }
    }
    faces.sort((a, b) => a.depth - b.depth);
    for (const face of faces) {
      ctx.beginPath();
      ctx.moveTo(face.polygon[0].x, face.polygon[0].y);
      for (let i = 1; i < face.polygon.length; i++) ctx.lineTo(face.polygon[i].x, face.polygon[i].y);
      ctx.closePath();
      ctx.fillStyle = `rgba(${face.bin.rgb.join(",")},0.45)`;
      ctx.fill();
      ctx.strokeStyle = "rgba(220,235,248,0.18)";
      ctx.lineWidth = 0.45;
      ctx.stroke();
    }
  }

  function drawHueLabels() {
    ctx.font = "10px system-ui, sans-serif";
    for (let i = 0; i < 10; i++) {
      const h = 5 + i * 10;
      const angle = h * Math.PI * 2 / 100;
      const p = projectWorld({
        x: Math.cos(angle) * 1.12,
        y: 0,
        z: Math.sin(angle) * 1.12,
      });
      const align = p.x < width * 0.43 ? "right" : p.x > width * 0.57 ? "left" : "center";
      const offset = align === "right" ? -3 : align === "left" ? 3 : 0;
      strokeLabel(ctx, `5${HUE_NAMES[i]}`, p.x + offset, p.y, align);
    }
  }

  function drawMarkers() {
    if (distributionOptions.mode === "distribution") { positions = []; return; }
    positions = points.map((point) => pointPosition(point, camera, width, height));
    const order = points.map((point, index) => ({ point, position: positions[index], index }))
      .sort((a, b) => a.position.depth - b.position.depth);
    for (const { point, position, index } of order) {
      const isHighlighted = index === hovered || index === selected;
      if (isHighlighted) {
        ctx.beginPath();
        ctx.arc(position.x, position.y, position.radius + 4, 0, Math.PI * 2);
        ctx.strokeStyle = index === selected ? "#ffffff" : "rgba(236, 244, 252, .82)";
        ctx.lineWidth = index === selected ? 2 : 1.25;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(position.x, position.y, position.radius, 0, Math.PI * 2);
      ctx.fillStyle = point.rgb;
      ctx.fill();
      // Representative markers have a fixed size.  Their area is already
      // reported beside the palette; using it again here would compete with
      // the distribution bins' quantity encoding.  A light keyline keeps a
      // pale representative visible over both dark and pale bins.
      ctx.beginPath();
      ctx.arc(position.x, position.y, position.radius + 1.6, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(3, 8, 15, .96)";
      ctx.lineWidth = 3.4;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(position.x, position.y, position.radius, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(245, 250, 255, .92)";
      ctx.lineWidth = 1.35;
      ctx.stroke();
      if (position.radius > 7) {
        ctx.beginPath();
        ctx.arc(position.x - position.radius * 0.28, position.y - position.radius * 0.3, Math.max(1, position.radius * 0.17), 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 255, 255, .42)";
        ctx.fill();
      }
    }
  }

  function render() {
    if (destroyed) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, width, height);
    drawGrid();
    drawNeutralAxis();
    drawDistribution();
    drawMarkers();
    drawHueLabels();

    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.font = "600 12px system-ui, sans-serif";
    ctx.fillStyle = "#e1eaf3";
    ctx.fillText("Munsell HVC · 推定値", 11, 9);
    ctx.font = "10px system-ui, sans-serif";
    ctx.fillStyle = "#a9bbcd";
    ctx.textAlign = "right";
    ctx.fillText("H 0–100 · V 0–10 · C 0–40", width - 11, 11);
    ctx.font = "9px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillStyle = "#8498ad";
    ctx.fillText(distribution && distributionOptions.mode !== "palette"
      ? `色分布 ${distributionOptions.scale === "log" ? "log" : "線形"} · 立方体の体積＝画素量`
      : "Chroma rings: C4 / C8 / C12 / … / C40", 11, 25);
    ctx.fillStyle = "#8498ad";
    if (width > 520) {
      ctx.fillText("代表点は固定サイズ。分布立方体の体積が画素量。C目盛は色域境界を示しません。", 11, height - 16);
      ctx.textAlign = "right";
      ctx.fillText("ドラッグで回転 · ホイールで拡大縮小 · Home でリセット", width - 11, height - 16);
    } else {
      ctx.fillText("代表点は固定サイズ", 11, height - 46);
      ctx.fillText("C は座標目盛（色域境界ではありません）", 11, height - 31);
      ctx.textAlign = "center";
      ctx.fillText("ドラッグ回転 · ホイール拡大 · Home", width / 2, height - 16);
    }
    if (!points.length && distributionOptions.mode !== "distribution") {
      ctx.textAlign = "center";
      ctx.font = "10px system-ui, sans-serif";
      ctx.fillStyle = "#8194a8";
      ctx.fillText("Munsell HVC 値のある色はありません", width / 2, height / 2 + 48);
    }
  }

  function findPoint(x, y) {
    if (distributionOptions.mode === "distribution") return -1;
    const candidates = points.map((point, index) => ({ point, index, position: positions[index] }))
      .sort((a, b) => b.position.depth - a.position.depth);
    for (const candidate of candidates) {
      if (Math.hypot(candidate.position.x - x, candidate.position.y - y) <= candidate.position.radius + 5) {
        return candidate.index;
      }
    }
    return -1;
  }

  function eventPosition(event) {
    const bounds = canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  function callOnSelect(index) {
    if (typeof onSelect === "function") onSelect(index < 0 ? null : points[index]);
  }

  function onPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    canvas.focus?.({ preventScroll: true });
    const p = eventPosition(event);
    pointers.set(event.pointerId, p);
    try { canvas.setPointerCapture?.(event.pointerId); } catch {}
    if (pointers.size === 1) {
      drag = { id: event.pointerId, startX: p.x, startY: p.y, lastX: p.x, lastY: p.y, moved: false };
      pinchDistance = 0;
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDistance = distanceBetween(a, b);
      drag = { id: event.pointerId, moved: true };
    }
    if (canvas.style) canvas.style.cursor = "grabbing";
  }

  function onPointerMove(event) {
    const p = eventPosition(event);
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, p);
    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const nextDistance = distanceBetween(a, b);
      if (pinchDistance > 1 && nextDistance > 1) {
        camera.distance = clamp(camera.distance * pinchDistance / nextDistance, 2.3, 11);
      }
      pinchDistance = nextDistance;
      if (drag) drag.moved = true;
      render();
      return;
    }
    if (drag && pointers.has(event.pointerId)) {
      const dx = p.x - drag.lastX;
      const dy = p.y - drag.lastY;
      if (Math.hypot(p.x - drag.startX, p.y - drag.startY) > 3) drag.moved = true;
      camera.yaw += dx * 0.008;
      camera.pitch = clamp(camera.pitch + dy * 0.008, -1.18, 1.18);
      drag.lastX = p.x;
      drag.lastY = p.y;
      if (drag.moved) {
        if (tooltip) tooltip.hidden = true;
        render();
      }
      return;
    }
    const next = findPoint(p.x, p.y);
    if (next !== hovered) {
      hovered = next;
      if (canvas.style) canvas.style.cursor = next >= 0 ? "pointer" : "grab";
      updateTooltip(next >= 0 ? points[next] : null, event.clientX, event.clientY);
      render();
    } else if (next >= 0 && tooltip) {
      updateTooltip(points[next], event.clientX, event.clientY);
    }
  }

  function endPointer(event, cancelled = false) {
    const p = eventPosition(event);
    const wasSingleClick = !cancelled && pointers.size === 1 && drag && !drag.moved;
    pointers.delete(event.pointerId);
    if (wasSingleClick) {
      const hit = findPoint(p.x, p.y);
      selected = hit;
      callOnSelect(hit);
      render();
    }
    if (pointers.size === 1) {
      const [remainingId, remaining] = pointers.entries().next().value;
      drag = { id: remainingId, startX: remaining.x, startY: remaining.y, lastX: remaining.x, lastY: remaining.y, moved: true };
      pinchDistance = 0;
    } else {
      drag = null;
      pinchDistance = 0;
      if (canvas.style) canvas.style.cursor = hovered >= 0 ? "pointer" : "grab";
    }
  }

  function onPointerLeave() {
    if (pointers.size) return;
    if (hovered !== -1) {
      hovered = -1;
      updateTooltip(null);
      render();
    }
  }

  function onPointerUp(event) {
    endPointer(event);
  }

  function onPointerCancel(event) {
    endPointer(event, true);
  }

  function onWheel(event) {
    event.preventDefault();
    camera.distance = clamp(camera.distance * Math.exp(clamp(event.deltaY, -500, 500) * 0.001), 2.3, 11);
    render();
  }

  function onKeyDown(event) {
    let handled = true;
    switch (event.key) {
      case "ArrowLeft": camera.yaw -= 0.12; break;
      case "ArrowRight": camera.yaw += 0.12; break;
      case "ArrowUp": camera.pitch = clamp(camera.pitch + 0.12, -1.18, 1.18); break;
      case "ArrowDown": camera.pitch = clamp(camera.pitch - 0.12, -1.18, 1.18); break;
      case "Home": reset(); break;
      case "+":
      case "=": camera.distance = clamp(camera.distance * 0.88, 2.3, 11); break;
      case "-": camera.distance = clamp(camera.distance * 1.14, 2.3, 11); break;
      case "Enter":
      case " ": selected = hovered; callOnSelect(selected); break;
      case "Escape": selected = -1; callOnSelect(-1); break;
      default: handled = false;
    }
    if (handled) {
      event.preventDefault();
      render();
    }
  }

  function reset() {
    Object.assign(camera, home);
    render();
  }

  function setPalette(palette) {
    points = normalizePalette(palette);
    sizeMarkers();
    hovered = -1;
    selected = -1;
    updateTooltip(null);
    render();
  }

  function setDistribution(next) {
    distribution = normalizeDistribution(next);
    render();
  }

  function setOptions(next = {}) {
    const mode = ["both", "distribution", "palette"].includes(next.mode) ? next.mode : distributionOptions.mode;
    const scale = ["log", "linear"].includes(next.scale) ? next.scale : distributionOptions.scale;
    const vMin = Number.isFinite(Number(next.vMin)) ? clamp(Number(next.vMin), 0, 10) : distributionOptions.vMin;
    const vMax = Number.isFinite(Number(next.vMax)) ? clamp(Number(next.vMax), vMin, 10) : distributionOptions.vMax;
    distributionOptions = { mode, scale, vMin, vMax };
    hovered = -1; selected = -1; updateTooltip(null); callOnSelect(-1);
    render();
  }

  function sizeMarkers() {
    const minDimension = Math.min(width, height);
    const minRadius = clamp(minDimension * 0.017, 5.5, 7.2);
    for (const point of points) {
      point.radius = minRadius;
    }
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("keydown", onKeyDown);
  const resizeObserver = typeof globalThis.ResizeObserver === "function"
    ? new globalThis.ResizeObserver(resize)
    : null;
  resizeObserver?.observe(canvas);
  const view = doc?.defaultView;
  if (!resizeObserver) view?.addEventListener("resize", resize);
  resize();

  return {
    setPalette,
    setDistribution,
    setOptions,
    reset,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      resizeObserver?.disconnect();
      if (!resizeObserver) view?.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("keydown", onKeyDown);
      canvas.style.touchAction = original.touchAction;
      canvas.style.cursor = original.cursor;
      restoreAttribute(canvas, "role", original.role);
      restoreAttribute(canvas, "aria-label", original.label);
      restoreAttribute(canvas, "aria-keyshortcuts", original.shortcuts);
      restoreAttribute(canvas, "tabindex", original.tabIndex);
      restoreAttribute(canvas, "title", original.title);
      tooltip?.remove();
      pointers.clear();
    },
    export() {
      return canvas.toDataURL("image/png");
    },
  };
}
