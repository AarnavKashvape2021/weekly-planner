/* ==========================================
   1. DISTINCT COLORS PER CATEGORY & SUB-CATEGORY
   ========================================== */
const STORAGE_KEY = "static_weekly_planner_v4";
const LEGACY_KEYS = ["static_weekly_planner_v3", "static_weekly_planner_v2"];
const DB_NAME     = "WeeklyPlannerPersistentDB";
const DB_STORE    = "plannerStore";
const DAYS        = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const SLOT_HEIGHT = 38;

const DEFAULT_CATEGORIES = [
  {
    name: "STUDY",
    color: "#6366f1",
    subs: [
      { name: "Maths",        color: "#3b82f6" }, // Blue
      { name: "Physics",      color: "#8b5cf6" }, // Violet
      { name: "Chemistry",    color: "#14b8a6" }, // Teal
      { name: "Further Math", color: "#ec4899" }  // Pink
    ]
  },
  {
    name: "PAPER SOLVING",
    color: "#f59e0b",
    subs: [
      { name: "Maths",        color: "#f97316" }, // Orange
      { name: "Phy",          color: "#eab308" }, // Amber/Gold
      { name: "Chem",         color: "#84cc16" }, // Lime
      { name: "Further Math", color: "#f43f5e" }  // Rose/Red
    ]
  },
  { name: "SCHOOL",       color: "#06b6d4", subs: [] }, // Cyan
  { name: "EXERCISE",     color: "#10b981", subs: [] }, // Emerald
  { name: "APPLICATIONS", color: "#a855f7", subs: [] }  // Purple
];

let state = getInitialStateSync();
let draggedBlockId = null;
let dragSlotOffset = 0;
let fileHandle = null;
let saveDebounceTimer = null;

// Mini Calendar state
const now = new Date();
let calYear = now.getFullYear();
let calMonth = now.getMonth();
let selectedCalDate = toISODate(now);

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getDefaultState() {
  const todayISO = toISODate(new Date());
  return {
    updatedAt: Date.now(),
    theme: "dark",
    startHour: 6,
    endHour: 24,
    categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
    blocks: [
      { id: "b1", title: "Electrodynamics & Fields", cat: "STUDY", sub: "Physics", day: 0, slot: 16, slots: 3, done: false },
      { id: "b2", title: "Timed Past Paper 9709", cat: "PAPER SOLVING", sub: "Maths", day: 1, slot: 18, slots: 4, done: false },
      { id: "b3", title: "Complex Numbers & Matrices", cat: "STUDY", sub: "Further Math", day: 2, slot: 16, slots: 3, done: false },
      { id: "b4", title: "Essay Draft & Supplements", cat: "APPLICATIONS", sub: "", day: 4, slot: 20, slots: 3, done: false },
      { id: "b5", title: "Evening Run / Workout", cat: "EXERCISE", sub: "", day: 3, slot: 34, slots: 2, done: false },
      { id: "b6", title: "Organic Mechanisms Review", cat: "STUDY", sub: "Chemistry", day: null, slot: null, slots: 2, done: false }
    ],
    deadlines: [
      { id: "d1", title: "Physics Paper 4 Mock", due: todayISO }
    ]
  };
}

function normalizeState(s) {
  if (!s || typeof s !== "object") return getDefaultState();
  if (!Array.isArray(s.categories) || !s.categories.length) {
    s.categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
  }
  const palette = ["#3b82f6", "#8b5cf6", "#14b8a6", "#ec4899", "#f97316", "#eab308", "#84cc16", "#f43f5e"];
  s.categories.forEach((cat, cIdx) => {
    if (!cat.color) cat.color = palette[cIdx % palette.length];
    if (!Array.isArray(cat.subs)) cat.subs = [];
    cat.subs = cat.subs.map((sub, sIdx) => {
      if (typeof sub === "string") {
        const defCat = DEFAULT_CATEGORIES.find(d => d.name === cat.name);
        const defSub = defCat?.subs.find(ds => ds.name === sub);
        return { name: sub, color: defSub ? defSub.color : palette[(cIdx + sIdx + 1) % palette.length] };
      }
      return sub;
    });
  });

  if (!Array.isArray(s.blocks)) s.blocks = [];
  if (!Array.isArray(s.deadlines)) s.deadlines = [];

  s.blocks.forEach(b => {
    if (b.sub === undefined) b.sub = "";
    const exists = s.categories.some(c => c.name === b.cat);
    if (!exists) {
      b.cat = s.categories[0].name;
      b.sub = s.categories[0].subs[0]?.name || "";
    }
  });
  return s;
}

function getInitialStateSync() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeState(JSON.parse(raw));

    for (const k of LEGACY_KEYS) {
      const legacy = localStorage.getItem(k);
      if (legacy) return normalizeState(JSON.parse(legacy));
    }
  } catch (e) {
    console.warn("State load warning:", e);
  }
  return getDefaultState();
}

/* ==========================================
   2. CLOUDFLARE D1 + INDEXEDDB + LOCAL PERSISTENCE
   ========================================== */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(DB_STORE);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

async function idbGet(key) {
  try {
    const db = await openDB();
    return new Promise(resolve => {
      const tx = db.transaction(DB_STORE, "readonly");
      const req = tx.objectStore(DB_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

async function idbSet(key, val) {
  try {
    const db = await openDB();
    return new Promise(resolve => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(val, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch { return false; }
}

function saveState() {
  state.updatedAt = Date.now();
  const serialized = JSON.stringify(state);
  try { localStorage.setItem(STORAGE_KEY, serialized); } catch {}
  idbSet("state", state);

  clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(() => {
    if (fileHandle) writeToDiskFile();
    syncToCloudflareD1();
  }, 250);

  const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  updateSaveBadge(`&#10003; Saved (${timeStr})`, false);
}

async function syncToCloudflareD1() {
  try {
    const res = await fetch("/api/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state)
    });
    if (res.ok) {
      const info = await res.json();
      if (info.cloudEnabled && info.saved) {
        updateSaveBadge("&#9729; Synced to Cloudflare D1", true);
      }
    }
  } catch {
    // Offline or running without Worker; local persistence remains active
  }
}

async function loadFromCloudflareD1() {
  try {
    const res = await fetch("/api/schedule");
    if (!res.ok) return;
    const payload = await res.json();
    if (payload.cloudEnabled && payload.data && Array.isArray(payload.data.blocks)) {
      if ((payload.data.updatedAt || 0) > (state.updatedAt || 0)) {
        state = normalizeState(payload.data);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        document.documentElement.setAttribute("data-theme", state.theme || "dark");
        document.getElementById("startHourSelect").value = state.startHour;
        document.getElementById("endHourSelect").value = state.endHour;
        renderAll();
        updateSaveBadge("&#9729; Loaded from Cloudflare D1", true);
      } else {
        // Push newer local state up to D1
        syncToCloudflareD1();
      }
    } else if (payload.cloudEnabled && !payload.data) {
      // First boot with empty D1 table: seed D1 with current state
      syncToCloudflareD1();
    }
  } catch {}
}

function updateSaveBadge(htmlText, isCloud) {
  const badge = document.getElementById("saveBadge");
  if (!badge) return;
  badge.innerHTML = htmlText;
  badge.classList.toggle("cloud-active", !!isCloud);
}

window.addEventListener("beforeunload", () => {
  const active = document.activeElement;
  if (active && active.getAttribute("contenteditable") === "true") active.blur();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
});

/* ==========================================
   3. COLOR RESOLUTION (CATEGORY vs SUB-CATEGORY)
   ========================================== */
function hexToRgba(hex, alpha) {
  let c = (hex || "#6366f1").replace("#", "");
  if (c.length === 3) c = c.split("").map(x => x + x).join("");
  const num = parseInt(c, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getBlockColor(catName, subName) {
  const catObj = state.categories.find(c => c.name === catName);
  if (!catObj) return "#6366f1";
  if (subName && Array.isArray(catObj.subs)) {
    const subObj = catObj.subs.find(s => s.name === subName);
    if (subObj && subObj.color) return subObj.color;
  }
  return catObj.color || "#6366f1";
}

function slotToTimeStr(absSlot) {
  const totalMins = absSlot * 30;
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function formatDuration(slots) {
  const hrs = (slots * 30) / 60;
  return hrs === 0.5 ? "30m" : `${hrs}h`;
}

function buildTileDropdownOptions(selectedCat, selectedSub) {
  return state.categories.map(cat => {
    if (cat.subs && cat.subs.length > 0) {
      const options = cat.subs.map(sub => {
        const val = `${cat.name}|||${sub.name}`;
        const isSel = (cat.name === selectedCat && sub.name === selectedSub) ? "selected" : "";
        return `<option value="${escapeHtml(val)}" ${isSel}>${escapeHtml(cat.name)} ▸ ${escapeHtml(sub.name)}</option>`;
      }).join("");
      return `<optgroup label="${escapeHtml(cat.name)}">${options}</optgroup>`;
    } else {
      const val = `${cat.name}|||`;
      const isSel = (cat.name === selectedCat && !selectedSub) ? "selected" : "";
      return `<option value="${escapeHtml(val)}" ${isSel}>${escapeHtml(cat.name)}</option>`;
    }
  }).join("");
}

/* ==========================================
   4. INITIALIZATION & RENDERING
   ========================================== */
async function init() {
  document.documentElement.setAttribute("data-theme", state.theme || "dark");
  document.getElementById("startHourSelect").value = state.startHour;
  document.getElementById("endHourSelect").value = state.endHour;
  document.getElementById("deadlineDate").value = selectedCalDate;

  renderAll();

  // Check IndexedDB fallback
  const idbState = await idbGet("state");
  if (idbState && Array.isArray(idbState.blocks)) {
    if (!localStorage.getItem(STORAGE_KEY) || (idbState.updatedAt || 0) > (state.updatedAt || 0)) {
      state = normalizeState(idbState);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      renderAll();
    }
  }

  // Sync with Cloudflare D1 database
  await loadFromCloudflareD1();

  // Check local disk file handle
  const savedHandle = await idbGet("diskFileHandle");
  if (savedHandle) {
    fileHandle = savedHandle;
    const btn = document.getElementById("reconnectBtn");
    btn.textContent = `⚡ Resume Disk Sync (${savedHandle.name})`;
    btn.style.display = "inline-flex";
  }
}

function renderAll() {
  populatePoolCatSelect();
  renderTimetableGrid();
  renderBlocks();
  renderCalendar();
  renderDeadlines();
}

function populatePoolCatSelect() {
  const catSel = document.getElementById("newTaskCat");
  const prev = catSel.value;
  catSel.innerHTML = state.categories.map(c =>
    `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`
  ).join("");
  if (state.categories.some(c => c.name === prev)) catSel.value = prev;
  populatePoolSubSelect();
}

function populatePoolSubSelect() {
  const catName = document.getElementById("newTaskCat").value;
  const subSel = document.getElementById("newTaskSub");
  const catObj = state.categories.find(c => c.name === catName);

  if (!catObj || !catObj.subs || catObj.subs.length === 0) {
    subSel.innerHTML = `<option value="">— No Sub-category —</option>`;
    subSel.disabled = true;
  } else {
    subSel.disabled = false;
    subSel.innerHTML = catObj.subs.map(s =>
      `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`
    ).join("");
  }
}

function renderTimetableGrid() {
  const container = document.getElementById("timetable");
  const startSlot = state.startHour * 2;
  const endSlot = state.endHour * 2;
  let html = `<div class="day-header corner">TIME</div>`;

  DAYS.forEach(day => {
    html += `<div class="day-header">${day}</div>`;
  });

  for (let s = startSlot; s < endSlot; s++) {
    const timeLabel = slotToTimeStr(s);
    const isHourStart = s % 2 === 0;
    const isHourEnd = s % 2 === 1;

    html += `<div class="time-label ${isHourStart ? 'hour-mark' : ''}">${timeLabel}</div>`;

    for (let d = 0; d < 7; d++) {
      html += `
        <div
          class="grid-cell ${isHourEnd ? 'hour-end' : ''}"
          data-day="${d}"
          data-slot="${s}"
          ondblclick="onCellDblClick(event, ${d}, ${s})"
          ondragover="onDragOverCell(event)"
          ondragleave="onDragLeaveCell(event)"
          ondrop="onDropToCell(event, ${d}, ${s})"
        ></div>
      `;
    }
  }

  container.innerHTML = html;
}

function computeOverlapLayout(dayBlocks) {
  const layout = {};
  const sorted = [...dayBlocks].sort((a, b) => a.slot - b.slot || b.slots - a.slots);
  let cluster = [];
  let clusterEnd = -1;

  function flushCluster(items) {
    if (!items.length) return;
    const cols = [];
    items.forEach(b => {
      let placed = false;
      for (let c = 0; c < cols.length; c++) {
        if (cols[c] <= b.slot) {
          cols[c] = b.slot + b.slots;
          layout[b.id] = { col: c, totalCols: 0 };
          placed = true;
          break;
        }
      }
      if (!placed) {
        layout[b.id] = { col: cols.length, totalCols: 0 };
        cols.push(b.slot + b.slots);
      }
    });
    items.forEach(b => { layout[b.id].totalCols = cols.length; });
  }

  sorted.forEach(b => {
    if (cluster.length && b.slot >= clusterEnd) {
      flushCluster(cluster);
      cluster = [];
      clusterEnd = -1;
    }
    cluster.push(b);
    clusterEnd = Math.max(clusterEnd, b.slot + b.slots);
  });
  flushCluster(cluster);
  return layout;
}

function renderBlocks() {
  document.querySelectorAll(".timetable .task-block").forEach(el => el.remove());
  const pool = document.getElementById("backlogZone");
  pool.innerHTML = "";

  const minSlot = state.startHour * 2;
  const maxSlot = state.endHour * 2;

  const dayLayouts = {};
  for (let d = 0; d < 7; d++) {
    const scheduledForDay = state.blocks.filter(
      b => b.day === d && b.slot !== null && b.slot >= minSlot && b.slot < maxSlot
    );
    dayLayouts[d] = computeOverlapLayout(scheduledForDay);
  }

  state.blocks.forEach(block => {
    const isScheduled = block.day !== null && block.slot !== null;
    const targetCell = isScheduled
      ? document.querySelector(`.grid-cell[data-day="${block.day}"][data-slot="${block.slot}"]`)
      : null;

    if (isScheduled && targetCell) {
      const clampedSlots = Math.min(block.slots, maxSlot - block.slot);
      const el = createBlockElement(block, true, clampedSlots);

      const pos = dayLayouts[block.day]?.[block.id] || { col: 0, totalCols: 1 };
      const widthPct = 100 / pos.totalCols;
      const leftPct = pos.col * widthPct;

      el.style.width = `calc(${widthPct}% - 4px)`;
      el.style.left = `calc(${leftPct}% + 2px)`;
      el.style.height = `calc(${clampedSlots} * var(--slot-height) - 3px)`;

      targetCell.appendChild(el);
    } else {
      const el = createBlockElement(block, false, block.slots);
      pool.appendChild(el);
    }
  });

  if (!pool.children.length) {
    pool.innerHTML = `<div style="color:var(--text-muted); font-size:0.74rem; text-align:center; padding:14px 4px; pointer-events:none;">
      Pool is empty. Add blocks above or drag from table.
    </div>`;
  }
}

function createBlockElement(block, isOnGrid, displaySlots) {
  const div = document.createElement("div");
  div.className = `task-block ${block.done ? "done" : ""}`;
  div.draggable = true;
  div.dataset.id = block.id;

  const colorHex = getBlockColor(block.cat, block.sub);
  const isLight = state.theme === "light";
  div.style.background = hexToRgba(colorHex, isLight ? 0.22 : 0.28);
  div.style.border = `1px solid ${hexToRgba(colorHex, 0.7)}`;
  div.style.borderLeft = `5px solid ${colorHex}`;

  div.addEventListener("dblclick", e => e.stopPropagation());

  const timeRange = isOnGrid
    ? `${slotToTimeStr(block.slot)}–${slotToTimeStr(block.slot + displaySlots)}`
    : `${formatDuration(block.slots)}`;

  div.innerHTML = `
    <div class="block-top">
      <input
        type="checkbox"
        class="block-check"
        ${block.done ? "checked" : ""}
        onchange="toggleBlockDone('${block.id}')"
        title="Mark completed"
      />
      <div
        class="block-title"
        contenteditable="true"
        spellcheck="false"
        oninput="liveUpdateBlockTitle('${block.id}', this)"
        onblur="finalizeBlockTitle('${block.id}', this)"
        onkeydown="if(event.key==='Enter'){event.preventDefault(); this.blur();}"
      >${escapeHtml(block.title)}</div>
      <button class="block-delete" onclick="deleteBlock('${block.id}')" title="Delete block">&times;</button>
    </div>
    <div class="block-footer">
      <select
        class="tile-cat-select"
        onchange="changeBlockCategory('${block.id}', this.value)"
        title="Change Category / Sub-category"
      >
        ${buildTileDropdownOptions(block.cat, block.sub)}
      </select>
      <span class="block-time">${timeRange}</span>
    </div>
    <div class="resize-handle" onmousedown="startResize(event, '${block.id}')" title="Drag to resize duration">═</div>
  `;

  const titleEl = div.querySelector(".block-title");
  const selectEl = div.querySelector(".tile-cat-select");
  const interactiveEls = div.querySelectorAll(".block-title, .tile-cat-select, .block-check, .block-delete, .resize-handle");

  interactiveEls.forEach(el => {
    el.addEventListener("mousedown", e => {
      div.draggable = false;
      e.stopPropagation();
    });
    el.addEventListener("mouseup", () => {
      if (document.activeElement !== titleEl && document.activeElement !== selectEl) {
        div.draggable = true;
      }
    });
  });

  titleEl.addEventListener("focus", () => { div.draggable = false; });
  titleEl.addEventListener("blur", () => { div.draggable = true; });
  selectEl.addEventListener("focus", () => { div.draggable = false; });
  selectEl.addEventListener("blur", () => { div.draggable = true; });

  div.addEventListener("mousedown", e => {
    div.draggable = true;
    if (isOnGrid) {
      const rect = div.getBoundingClientRect();
      dragSlotOffset = Math.max(0, Math.floor((e.clientY - rect.top) / SLOT_HEIGHT));
    } else {
      dragSlotOffset = 0;
    }
  });

  div.addEventListener("dragstart", e => {
    if (document.activeElement === titleEl || document.activeElement === selectEl) {
      e.preventDefault();
      return;
    }
    draggedBlockId = block.id;
    e.dataTransfer.setData("text/plain", block.id);
    e.dataTransfer.effectAllowed = "move";
    setTimeout(() => {
      div.classList.add("dragging");
      document.body.classList.add("is-dragging");
    }, 0);
  });

  div.addEventListener("dragend", () => {
    draggedBlockId = null;
    dragSlotOffset = 0;
    div.classList.remove("dragging");
    document.body.classList.remove("is-dragging");
    document.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));
  });

  return div;
}

function changeBlockCategory(blockId, combinedVal) {
  const block = state.blocks.find(b => b.id === blockId);
  if (!block) return;
  const [cat, sub] = combinedVal.split("|||");
  block.cat = cat;
  block.sub = sub || "";
  saveState();
  renderBlocks();
}

/* ==========================================
   5. DRAG, DROP & RESIZE
   ========================================== */
function onDragOverCell(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  e.currentTarget.classList.add("drag-over");
}

function onDragLeaveCell(e) {
  e.currentTarget.classList.remove("drag-over");
}

function onDropToCell(e, day, droppedSlot) {
  e.preventDefault();
  e.currentTarget.classList.remove("drag-over");
  document.body.classList.remove("is-dragging");

  const id = draggedBlockId || e.dataTransfer.getData("text/plain");
  const block = state.blocks.find(b => b.id === id);
  if (!block) return;

  const minSlot = state.startHour * 2;
  const maxSlot = state.endHour * 2;

  let targetSlot = droppedSlot - dragSlotOffset;
  targetSlot = Math.max(minSlot, Math.min(maxSlot - 1, targetSlot));
  if (targetSlot + block.slots > maxSlot) {
    targetSlot = Math.max(minSlot, maxSlot - block.slots);
  }

  block.day = day;
  block.slot = targetSlot;
  saveState();
  renderBlocks();
}

function onDragOverZone(e) {
  e.preventDefault();
  e.currentTarget.classList.add("drag-over");
}

function onDragLeaveZone(e) {
  e.currentTarget.classList.remove("drag-over");
}

function onDropToPool(e) {
  e.preventDefault();
  e.currentTarget.classList.remove("drag-over");
  document.body.classList.remove("is-dragging");

  const id = draggedBlockId || e.dataTransfer.getData("text/plain");
  const block = state.blocks.find(b => b.id === id);
  if (block) {
    block.day = null;
    block.slot = null;
    saveState();
    renderBlocks();
  }
}

function startResize(e, blockId) {
  e.stopPropagation();
  e.preventDefault();
  const block = state.blocks.find(b => b.id === blockId);
  const blockEl = document.querySelector(`.timetable .task-block[data-id="${blockId}"]`);
  if (!block || !blockEl) return;

  blockEl.draggable = false;
  document.body.classList.add("is-resizing");

  const startY = e.clientY;
  const startSlots = block.slots;
  const maxSlot = state.endHour * 2;

  function onMouseMove(moveEvent) {
    const deltaY = moveEvent.clientY - startY;
    const deltaSlots = Math.round(deltaY / SLOT_HEIGHT);
    const maxAllowedSlots = maxSlot - block.slot;
    const newSlots = Math.max(1, Math.min(maxAllowedSlots, startSlots + deltaSlots));

    if (newSlots !== block.slots) {
      block.slots = newSlots;
      blockEl.style.height = `calc(${block.slots} * var(--slot-height) - 3px)`;
      const timeSpan = blockEl.querySelector(".block-time");
      if (timeSpan) {
        timeSpan.textContent = `${slotToTimeStr(block.slot)}–${slotToTimeStr(block.slot + block.slots)}`;
      }
    }
  }

  function onMouseUp() {
    blockEl.draggable = true;
    document.body.classList.remove("is-resizing");
    saveState();
    renderBlocks();
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
  }

  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
}

/* ==========================================
   6. BLOCK CRUD ACTIONS
   ========================================== */
function createPoolTask(e) {
  e.preventDefault();
  const titleInput = document.getElementById("newTaskTitle");
  const cat = document.getElementById("newTaskCat").value;
  const sub = document.getElementById("newTaskSub").value;
  const slots = parseInt(document.getElementById("newTaskSlots").value, 10);

  state.blocks.push({
    id: "b_" + Date.now(),
    title: titleInput.value.trim(),
    cat,
    sub: sub || "",
    day: null,
    slot: null,
    slots,
    done: false
  });

  titleInput.value = "";
  saveState();
  renderBlocks();
}

function onCellDblClick(e, day, slot) {
  if (e.target !== e.currentTarget) return;

  const maxSlot = state.endHour * 2;
  const defaultCat = state.categories[0] || { name: "STUDY", subs: [{ name: "Physics", color: "#8b5cf6" }] };
  const defaultSub = (defaultCat.subs && defaultCat.subs[0]) ? defaultCat.subs[0].name : "";
  const newId = "b_" + Date.now();

  state.blocks.push({
    id: newId,
    title: "New Task",
    cat: defaultCat.name,
    sub: defaultSub,
    day,
    slot,
    slots: Math.min(2, maxSlot - slot),
    done: false
  });
  saveState();
  renderBlocks();

  const createdTitle = document.querySelector(`.task-block[data-id="${newId}"] .block-title`);
  if (createdTitle) {
    createdTitle.focus();
    const range = document.createRange();
    range.selectNodeContents(createdTitle);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

function liveUpdateBlockTitle(id, el) {
  const block = state.blocks.find(b => b.id === id);
  if (!block) return;
  const cleaned = el.innerText.trim();
  if (cleaned) {
    block.title = cleaned;
    saveState();
  }
}

function finalizeBlockTitle(id, el) {
  const block = state.blocks.find(b => b.id === id);
  if (!block) return;
  const cleaned = el.innerText.trim();
  if (cleaned) {
    block.title = cleaned;
    saveState();
  } else {
    el.innerText = block.title;
  }
}

function toggleBlockDone(id) {
  const block = state.blocks.find(b => b.id === id);
  if (block) {
    block.done = !block.done;
    saveState();
    renderBlocks();
  }
}

function deleteBlock(id) {
  state.blocks = state.blocks.filter(b => b.id !== id);
  saveState();
  renderBlocks();
}

/* ==========================================
   7. MINI CALENDAR & DEADLINES TRACKER
   ========================================== */
function changeCalMonth(delta) {
  calMonth += delta;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  if (calMonth > 11) { calMonth = 0; calYear++; }
  renderCalendar();
}

function selectCalDate(isoDate) {
  selectedCalDate = isoDate;
  document.getElementById("deadlineDate").value = isoDate;
  renderCalendar();
}

function renderCalendar() {
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  document.getElementById("calMonthLabel").textContent = `${monthNames[calMonth]} ${calYear}`;

  const grid = document.getElementById("calGrid");
  const dows = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
  let html = dows.map(d => `<div class="cal-dow">${d}</div>`).join("");

  const firstDay = new Date(calYear, calMonth, 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const todayISO = toISODate(new Date());

  const deadlineMap = {};
  state.deadlines.forEach(d => {
    if (!deadlineMap[d.due]) deadlineMap[d.due] = [];
    deadlineMap[d.due].push(d.title);
  });

  for (let i = 0; i < startOffset; i++) {
    html += `<div class="cal-day other-month"></div>`;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const isToday = iso === todayISO;
    const isSelected = iso === selectedCalDate;
    const dueItems = deadlineMap[iso] || [];
    const hasDeadline = dueItems.length > 0;
    const tooltip = hasDeadline ? `Due on ${iso}: ${dueItems.join(", ")}` : `Click to set date: ${iso}`;

    const classes = [
      "cal-day",
      isToday ? "is-today" : "",
      isSelected ? "is-selected" : "",
      hasDeadline ? "has-deadline" : ""
    ].filter(Boolean).join(" ");

    html += `<div class="${classes}" onclick="selectCalDate('${iso}')" title="${escapeHtml(tooltip)}">${day}</div>`;
  }

  grid.innerHTML = html;
}

function getCountdownInfo(dueISO) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dueISO + "T00:00:00");
  if (isNaN(target.getTime())) return { label: dueISO, cls: "" };

  const diffDays = Math.round((target - today) / 86400000);
  if (diffDays < 0) return { label: `${Math.abs(diffDays)}d overdue`, cls: "urgent" };
  if (diffDays === 0) return { label: "Due Today!", cls: "urgent" };
  if (diffDays === 1) return { label: "Tomorrow", cls: "urgent" };
  if (diffDays <= 5) return { label: `In ${diffDays}d`, cls: "" };
  return { label: `In ${diffDays}d`, cls: "ok" };
}

function renderDeadlines() {
  const list = document.getElementById("deadlineList");
  if (!state.deadlines.length) {
    list.innerHTML = `<li style="color:var(--text-muted); font-size:0.74rem; text-align:center; padding:8px;">No upcoming deadlines.</li>`;
    return;
  }

  const sorted = [...state.deadlines].sort((a, b) => a.due.localeCompare(b.due));

  list.innerHTML = sorted.map(d => {
    const cd = getCountdownInfo(d.due);
    return `
      <li class="deadline-item">
        <div class="deadline-info">
          <span
            class="deadline-title"
            contenteditable="true"
            spellcheck="false"
            oninput="liveEditDeadline('${d.id}', this)"
          >${escapeHtml(d.title)}</span>
          <span class="deadline-sub">${escapeHtml(d.due)}</span>
        </div>
        <span class="countdown-badge ${cd.cls}">${escapeHtml(cd.label)}</span>
        <button class="block-delete" onclick="deleteDeadline('${d.id}')">&times;</button>
      </li>
    `;
  }).join("");
}

function addDeadline(e) {
  e.preventDefault();
  const titleInput = document.getElementById("deadlineTitle");
  const dateInput = document.getElementById("deadlineDate");

  state.deadlines.push({
    id: "d_" + Date.now(),
    title: titleInput.value.trim(),
    due: dateInput.value
  });

  titleInput.value = "";
  saveState();
  renderCalendar();
  renderDeadlines();
}

function liveEditDeadline(id, el) {
  const item = state.deadlines.find(d => d.id === id);
  if (!item) return;
  const val = el.innerText.trim();
  if (val) {
    item.title = val;
    saveState();
    renderCalendar();
  }
}

function deleteDeadline(id) {
  state.deadlines = state.deadlines.filter(d => d.id !== id);
  saveState();
  renderCalendar();
  renderDeadlines();
}

/* ==========================================
   8. CATEGORY & SUB-CATEGORY COLOR MANAGER
   ========================================== */
function openCatModal() {
  renderCatManagerList();
  document.getElementById("catModal").classList.add("open");
}

function closeCatModal() {
  document.getElementById("catModal").classList.remove("open");
}

function renderCatManagerList() {
  const container = document.getElementById("catManagerList");
  container.innerHTML = state.categories.map((cat, idx) => {
    const subsHtml = (cat.subs || []).map((s, sIdx) => `
      <span class="sub-chip" style="border-left: 3px solid ${s.color};">
        <input
          type="color"
          class="sub-color-input"
          value="${s.color}"
          onchange="updateSubCategoryColor(${idx}, ${sIdx}, this.value)"
          title="Pick color for ${escapeHtml(s.name)}"
        />
        ${escapeHtml(s.name)}
        <button type="button" onclick="removeSubCategory(${idx}, ${sIdx})" title="Remove sub-category">&times;</button>
      </span>
    `).join("");

    return `
      <div class="cat-manager-item" style="border-left: 4px solid ${cat.color};">
        <div class="cat-manager-top">
          <div style="display:flex; align-items:center; gap:8px;">
            <input
              type="color"
              value="${cat.color}"
              onchange="updateCategoryColor(${idx}, this.value)"
              class="color-picker"
              title="Default color for ${escapeHtml(cat.name)}"
            />
            <strong style="font-size:0.86rem;">${escapeHtml(cat.name)}</strong>
          </div>
          <button type="button" onclick="removeCategory(${idx})" style="color:var(--danger); font-size:0.74rem;">Delete Category</button>
        </div>

        <div class="sub-chips">
          ${subsHtml || `<span style="font-size:0.72rem; color:var(--text-muted);">No sub-categories (uses main category color)</span>`}
        </div>

        <form class="form-row" onsubmit="addSubCategory(event, ${idx})" style="margin-top:2px;">
          <input type="text" id="subInput_${idx}" placeholder="Add sub-category to ${escapeHtml(cat.name)}..." required />
          <input type="color" id="subColor_${idx}" value="${cat.color}" class="color-picker" title="Sub-category color" />
          <button type="submit" style="flex:0 0 auto;">+ Add Sub</button>
        </form>
      </div>
    `;
  }).join("");
}

function addNewCategory(e) {
  e.preventDefault();
  const nameInput = document.getElementById("addCatName");
  const colorInput = document.getElementById("addCatColor");
  const cleanName = nameInput.value.trim().toUpperCase();
  if (!cleanName) return;

  if (state.categories.some(c => c.name.toUpperCase() === cleanName)) {
    alert("Category already exists!");
    return;
  }

  state.categories.push({
    name: cleanName,
    color: colorInput.value,
    subs: []
  });

  nameInput.value = "";
  saveState();
  renderCatManagerList();
  renderAll();
}

function updateCategoryColor(catIdx, newColor) {
  if (state.categories[catIdx]) {
    state.categories[catIdx].color = newColor;
    saveState();
    renderCatManagerList();
    renderBlocks();
  }
}

function updateSubCategoryColor(catIdx, subIdx, newColor) {
  const sub = state.categories[catIdx]?.subs?.[subIdx];
  if (sub) {
    sub.color = newColor;
    saveState();
    renderCatManagerList();
    renderBlocks();
  }
}

function removeCategory(catIdx) {
  if (state.categories.length <= 1) {
    alert("You must keep at least one category.");
    return;
  }
  const removed = state.categories[catIdx];
  if (!confirm(`Delete category "${removed.name}"? Existing blocks in this category will be reassigned.`)) return;

  state.categories.splice(catIdx, 1);
  const fallback = state.categories[0];
  state.blocks.forEach(b => {
    if (b.cat === removed.name) {
      b.cat = fallback.name;
      b.sub = fallback.subs[0]?.name || "";
    }
  });

  saveState();
  renderCatManagerList();
  renderAll();
}

function addSubCategory(e, catIdx) {
  e.preventDefault();
  const input = document.getElementById(`subInput_${catIdx}`);
  const colorInput = document.getElementById(`subColor_${catIdx}`);
  const val = input.value.trim();
  if (!val) return;

  const cat = state.categories[catIdx];
  if (!cat.subs.some(s => s.name.toLowerCase() === val.toLowerCase())) {
    cat.subs.push({ name: val, color: colorInput.value });
    saveState();
    renderCatManagerList();
    renderAll();
  }
  input.value = "";
}

function removeSubCategory(catIdx, subIdx) {
  const cat = state.categories[catIdx];
  const removedSub = cat.subs[subIdx];
  cat.subs.splice(subIdx, 1);

  state.blocks.forEach(b => {
    if (b.cat === cat.name && b.sub === removedSub.name) {
      b.sub = cat.subs[0]?.name || "";
    }
  });

  saveState();
  renderCatManagerList();
  renderAll();
}

/* ==========================================
   9. DISK SYNC & GLOBAL UTILITIES
   ========================================== */
async function linkDiskFile() {
  if (!window.showSaveFilePicker) {
    alert("Your browser doesn't support direct disk auto-sync. Use 'Export' instead.");
    return;
  }
  try {
    fileHandle = await window.showSaveFilePicker({
      suggestedName: "weekly-schedule.json",
      types: [{ description: "JSON Schedule File", accept: { "application/json": [".json"] } }]
    });
    await idbSet("diskFileHandle", fileHandle);
    document.getElementById("reconnectBtn").style.display = "none";
    await writeToDiskFile();
  } catch (err) {
    if (err.name !== "AbortError") console.error(err);
  }
}

async function reconnectDiskFile() {
  if (!fileHandle) return;
  try {
    const perm = await fileHandle.requestPermission({ mode: "readwrite" });
    if (perm === "granted") {
      document.getElementById("reconnectBtn").style.display = "none";
      const file = await fileHandle.getFile();
      const text = await file.text();
      if (text.trim()) {
        state = normalizeState(JSON.parse(text));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        renderAll();
      }
      await writeToDiskFile();
    }
  } catch (e) { console.error(e); }
}

async function writeToDiskFile() {
  if (!fileHandle) return;
  try {
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(state, null, 2));
    await writable.close();
    updateSaveBadge(`&#9889; Synced (${fileHandle.name})`, true);
  } catch {
    document.getElementById("reconnectBtn").style.display = "inline-flex";
  }
}

function updateHours() {
  const start = parseInt(document.getElementById("startHourSelect").value, 10);
  const end = parseInt(document.getElementById("endHourSelect").value, 10);
  if (start >= end) {
    alert("Start hour must be earlier than end hour.");
    document.getElementById("startHourSelect").value = state.startHour;
    document.getElementById("endHourSelect").value = state.endHour;
    return;
  }
  state.startHour = start;
  state.endHour = end;
  saveState();
  renderAll();
}

function resetChecks() {
  state.blocks.forEach(b => b.done = false);
  saveState();
  renderBlocks();
}

function clearAllBlocks() {
  if (confirm("Remove all scheduled and unscheduled blocks from the planner?")) {
    state.blocks = [];
    saveState();
    renderBlocks();
  }
}

function toggleTheme() {
  state.theme = state.theme === "light" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", state.theme);
  saveState();
  renderBlocks();
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "weekly-planner-backup.json";
  a.click();
  URL.revokeObjectURL(url);
}

function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (data && Array.isArray(data.blocks)) {
        state = normalizeState(data);
        saveState();
        init();
      } else {
        alert("Invalid backup file.");
      }
    } catch {
      alert("Error reading JSON file.");
    }
    e.target.value = "";
  };
  reader.readAsText(file);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

init();
