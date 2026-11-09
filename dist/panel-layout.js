/* Lightweight, local-first panel tiling for the Color Timeline workspace. */
const VERSION = 1;
const STORAGE_KEY = "color-timeline:panel-layout:v1";
const IDS = ["media", "timeline", "analysis", "current", "hue", "munsell", "settings", "notes"];
const SELECTORS = {
  media: ".media-panel", timeline: ".timeline-panel", analysis: ".analysis-panel",
  current: ".current-panel", hue: ".hue-panel", munsell: ".munsell-panel",
  settings: ".settings-panel", notes: ".notes-panel",
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function readState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!s || s.version !== VERSION || !Number.isFinite(s.ratio) || s.ratio < .28 || s.ratio > .72) return null;
    const left = Array.isArray(s.columns?.left) ? s.columns.left : [];
    const right = Array.isArray(s.columns?.right) ? s.columns.right : [];
    if (left.length + right.length !== IDS.length || new Set([...left, ...right]).size !== IDS.length || [...left, ...right].some((id) => !IDS.includes(id))) return null;
    return { ratio: s.ratio, columns: { left: [...left], right: [...right] } };
  } catch { return null; }
}
function writeState(state) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, ...state })); } catch { /* storage can be disabled */ } }
function complete(left, right) {
  const seen = new Set();
  const take = (items) => items.filter((id) => IDS.includes(id) && !seen.has(id) && (seen.add(id), true));
  const columns = { left: take(left), right: take(right) };
  for (const id of IDS) if (!seen.has(id)) columns.left.push(id);
  return columns;
}
function title(panel) { return panel.querySelector("h1,h2")?.textContent?.trim() || panel.getAttribute("aria-label") || "パネル"; }

export function initPanelLayout(workspace, { onLayoutChange } = {}) {
  if (!workspace) return () => {};
  const map = new Map();
  for (const [id, selector] of Object.entries(SELECTORS)) {
    const panel = workspace.querySelector(selector);
    if (panel) { panel.dataset.panelId = id; panel.dataset.layoutId = id; map.set(id, panel); }
  }
  const editor = workspace.querySelector(":scope > .editor-column");
  const inspector = workspace.querySelector(":scope > .inspector-column");
  if (!editor || !inspector || map.size !== IDS.length) return () => {};
  const defaults = {
    left: [...editor.querySelectorAll(":scope > .panel")].map((p) => p.dataset.panelId),
    right: [...inspector.querySelectorAll(":scope > .panel")].map((p) => p.dataset.panelId),
  };
  const saved = readState();
  let columns = complete(...(saved ? [saved.columns.left, saved.columns.right] : [defaults.left, defaults.right]));
  let ratio = clamp(saved?.ratio ?? .66, .28, .72);
  let drag = null;
  let destroyed = false;
  workspace.classList.add("panel-layout-enabled");

  const toolbar = document.createElement("div");
  toolbar.className = "panel-layout-toolbar";
  toolbar.innerHTML = '<span class="panel-layout-label">配置</span><span class="panel-layout-hint">ドラッグで並べ替え</span><button id="resetPanelLayout" type="button" class="button button-quiet">初期配置に戻す</button>';
  workspace.parentNode?.insertBefore(toolbar, workspace);
  const splitter = document.createElement("div");
  splitter.className = "layout-splitter panel-layout-splitter";
  splitter.setAttribute("role", "separator"); splitter.setAttribute("aria-orientation", "vertical"); splitter.setAttribute("aria-label", "左右の列幅"); splitter.tabIndex = 0;
  workspace.append(splitter);

  function setRatio(next, save = true) {
    ratio = clamp(next, .28, .72);
    workspace.style.setProperty("--panel-layout-ratio", ratio);
    splitter.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
    splitter.setAttribute("aria-valuemin", "28"); splitter.setAttribute("aria-valuemax", "72");
    if (save) persist();
  }
  function persist() {
    writeState({ ratio, columns: { left: [...columns.left], right: [...columns.right] } });
    onLayoutChange?.();
  }
  function moveNode(node, parent, before=null) {
    if(node.parentNode===parent && node.nextSibling===before)return;
    if(typeof parent.moveBefore==='function' && node.isConnected){
      try {parent.moveBefore(node,before);return;} catch {}
    }
    const media=[...node.querySelectorAll('video,audio')].map(el=>({el,time:el.currentTime,playing:!el.paused}));
    parent.insertBefore(node,before);
    for(const {el,time,playing} of media){if(Number.isFinite(time)&&el.readyState>0&&Math.abs(el.currentTime-time)>.05)el.currentTime=time;if(playing)el.play().catch(()=>{});}
  }
  function apply() {
    for(const [name,parent] of [['left',editor],['right',inspector]]){
      let before=null;
      for(const id of [...columns[name]].reverse()){const node=map.get(id);moveNode(node,parent,before);before=node;}
    }
    setRatio(ratio,false);
  }
  function reset() { columns = complete(defaults.left, defaults.right); ratio = .66; apply(); persist(); }
  function columnOf(panel) { return columns.left.includes(panel.dataset.panelId) ? "left" : "right"; }
  function move(panel, action) {
    const id = panel.dataset.panelId; const column = columnOf(panel); const list = columns[column]; const index = list.indexOf(id);
    let targetColumn = column; let targetIndex = index;
    if (action === "up") { if (index > 0) targetIndex--; else if (column === "right" && columns.left.length) { targetColumn = "left"; targetIndex = columns.left.length; } }
    if (action === "down") { if (index < list.length - 1) targetIndex++; else if (column === "left" && columns.right.length) { targetColumn = "right"; targetIndex = 0; } }
    if (action === "left" || action === "right") { targetColumn = action === "left" ? "left" : "right"; if (targetColumn === column) return; targetIndex = columns[targetColumn].length; }
    if (targetColumn === column && targetIndex === index) return;
    columns.left = columns.left.filter((x) => x !== id); columns.right = columns.right.filter((x) => x !== id);
    columns[targetColumn].splice(clamp(targetIndex, 0, columns[targetColumn].length), 0, id); apply(); persist();
    panel.querySelector(".panel-drag-handle")?.focus();
  }
  function makePanelTools(panel) {
    let heading = panel.querySelector(":scope > .panel-heading");
    if (!heading) { heading = document.createElement("div"); heading.className = "panel-heading panel-layout-heading"; panel.prepend(heading); }
    heading.classList.add("panel-layout-heading-ready");
    const old = heading.querySelector(":scope > .panel-layout-tools"); if (old) old.remove();
    const tools = document.createElement("div"); tools.className = "panel-layout-tools";
    const grip = document.createElement("button"); grip.type = "button"; grip.className = "panel-drag-handle panel-layout-grip"; grip.textContent = "⠿"; grip.title = "ドラッグして配置を変更"; grip.setAttribute("aria-label", `${title(panel)}を移動`);
    const up = document.createElement("button"); up.type = "button"; up.className = "panel-layout-move"; up.textContent = "↑"; up.dataset.layoutAction = "up"; up.setAttribute("aria-label", "上へ移動");
    const down = document.createElement("button"); down.type = "button"; down.className = "panel-layout-move"; down.textContent = "↓"; down.dataset.layoutAction = "down"; down.setAttribute("aria-label", "下へ移動");
    const left = document.createElement("button"); left.type = "button"; left.className = "panel-layout-move panel-layout-column"; left.textContent = "⇄"; left.dataset.layoutAction = "column"; left.setAttribute("aria-label", "左右の列を移動");
    tools.append(grip, up, down, left); heading.prepend(tools);
    up.onclick = () => move(panel, "up"); down.onclick = () => move(panel, "down"); left.onclick = () => move(panel, columnOf(panel) === "left" ? "right" : "left");
    grip.addEventListener("keydown", (event) => { if (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); move(panel, { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" }[event.key]); } });
    grip.addEventListener("pointerdown", (event) => beginDrag(event, panel));
  }
  function placeholderFor(panel) { const p = document.createElement("div"); p.className = "panel-layout-placeholder"; p.style.minHeight = "8px"; p.setAttribute("aria-hidden", "true"); return p; }
  function targetColumn(event) {
    if (window.matchMedia?.("(max-width: 760px)").matches) {
      const under = document.elementsFromPoint(event.clientX, event.clientY).find((node) => node.classList?.contains("panel") && node !== drag?.panel);
      if (under) return under.parentElement === editor ? editor : inspector;
      const panels = [...editor.children, ...inspector.children].filter((node) => node.classList?.contains("panel") && node !== drag?.panel);
      const closest = panels.reduce((best, node) => {
        const rect = node.getBoundingClientRect();
        const distance = Math.abs(event.clientY - (rect.top + rect.height / 2));
        return !best || distance < best.distance ? { node, distance } : best;
      }, null);
      return closest?.node.parentElement === inspector ? inspector : editor;
    }
    const rect = workspace.getBoundingClientRect();
    return event.clientX < rect.left + rect.width * ratio ? editor : inspector;
  }
  function place(event) {
    if (!drag) return;
    const column = targetColumn(event); const panels = [...column.querySelectorAll(":scope > .panel")].filter((p) => p !== drag.panel);
    const before = panels.find((p) => event.clientY < p.getBoundingClientRect().top + p.getBoundingClientRect().height / 2);
    if (before) column.insertBefore(drag.placeholder, before); else column.append(drag.placeholder);
  }
  function cleanup() { document.removeEventListener("pointermove", onMove); document.removeEventListener("pointerup", onUp); document.removeEventListener("pointercancel", onCancel); }
  function finish(cancel) {
    if(!drag)return;
    const {panel,placeholder}=drag;
    if(!cancel)moveNode(panel,placeholder.parentNode,placeholder);
    placeholder.remove();panel.classList.remove('panel-layout-dragging');document.body.classList.remove('panel-layout-dragging-active');
    columns={left:[...editor.querySelectorAll(':scope > .panel')].map(p=>p.dataset.panelId),right:[...inspector.querySelectorAll(':scope > .panel')].map(p=>p.dataset.panelId)};
    drag=null;cancelAnimationFrame(scrollFrame);scrollFrame=0;
    if(!cancel)persist();
  }
  let scrollFrame=0;
  function autoScroll(){
    if(!drag)return;const y=drag.y;
    if(y<65)window.scrollBy(0,-14);else if(y>innerHeight-65)window.scrollBy(0,14);
    place({clientX:drag.x,clientY:drag.y});scrollFrame=requestAnimationFrame(autoScroll);
  }
  function onMove(event) { if (drag && event.pointerId===drag.pointerId) { event.preventDefault();drag.x=event.clientX;drag.y=event.clientY;place(event); } }
  function onUp() { finish(false); cleanup(); }
  function onCancel() { finish(true); cleanup(); }
  function onEscape(event) { if (event.key === "Escape" && drag) { finish(true); cleanup(); } }
  function beginDrag(event, panel) {
    if (destroyed || event.button !== 0 || panel.closest(".expanded")) return;
    event.preventDefault(); const placeholder = placeholderFor(panel); const originParent = panel.parentElement; const originNext = panel.nextElementSibling; originParent.insertBefore(placeholder, panel);
    drag = { panel, placeholder, originParent, originNext, pointerId:event.pointerId,x:event.clientX,y:event.clientY };scrollFrame=requestAnimationFrame(autoScroll); panel.classList.add("panel-layout-dragging"); document.body.classList.add("panel-layout-dragging-active");
    document.addEventListener("pointermove", onMove, { passive: false }); document.addEventListener("pointerup", onUp, { once: true }); document.addEventListener("pointercancel", onCancel, { once: true }); place(event);
  }
  let stopSplit=null;
  splitter.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;event.preventDefault();const original=ratio;
    const moving=e=>{if(e.pointerId!==event.pointerId)return;const rect=workspace.getBoundingClientRect();setRatio((e.clientX-rect.left-8)/Math.max(1,rect.width-16),false);onLayoutChange?.();};
    const escape=e=>{if(e.key==='Escape')stop(false);};
    const stop=save=>{document.removeEventListener('pointermove',moving);document.removeEventListener('pointerup',up);document.removeEventListener('pointercancel',cancel);document.removeEventListener('keydown',escape);stopSplit=null;if(save)persist();else setRatio(original,false);};
    const up=()=>stop(true),cancel=()=>stop(false);stopSplit=cancel;
    document.addEventListener('pointermove',moving);document.addEventListener('pointerup',up);document.addEventListener('pointercancel',cancel);document.addEventListener('keydown',escape);
  });
  splitter.addEventListener("keydown", (event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setRatio(ratio + (event.key === "ArrowLeft" ? -.02 : .02)); } if (event.key === "Home") { event.preventDefault(); setRatio(.66); } });
  toolbar.querySelector("#resetPanelLayout").onclick = reset;
  document.addEventListener("keydown", onEscape);
  for (const panel of map.values()) makePanelTools(panel);
  apply();
  return () => { destroyed = true; finish(true);stopSplit?.();cleanup(); document.removeEventListener("keydown", onEscape); toolbar.remove(); splitter.remove(); for (const panel of map.values()) panel.querySelector(".panel-layout-tools")?.remove(); };
}

