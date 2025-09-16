// Production-grade multi-track timeline with interact.js drag, resize, snapping, zoom, ruler, playhead, and collision control

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

const sidebarLabelsEl = document.getElementById('trackLabels');
const rulerCanvas = document.getElementById('rulerCanvas');
const timelineEl = document.getElementById('timeline');
const gridLayerEl = document.getElementById('gridLayer');
const rowsLayerEl = document.getElementById('rowsLayer');
const clipsLayerEl = document.getElementById('clipsLayer');
const viewportEl = document.getElementById('tracksViewport');
const playheadEl = document.getElementById('playhead');

const zoomRangeEl = document.getElementById('zoomRange');
const zoomOutEl = document.getElementById('zoomOut');
const snapInputEl = document.getElementById('snapInput');
const snapToggleEl = document.getElementById('snapToggle');
const btnAddClip = document.getElementById('btnAddClip');
const btnDelete = document.getElementById('btnDelete');
const btnFit = document.getElementById('btnFit');

// Core state
const state = {
  pixelsPerSecond: Number(zoomRangeEl.value),
  snapEnabled: snapToggleEl.checked,
  snapIntervalSec: Number(snapInputEl.value),
  trackHeight: parseInt(getComputedStyle(document.documentElement).getPropertyValue('--track-height'), 10) || 64,
  trackGap: parseInt(getComputedStyle(document.documentElement).getPropertyValue('--track-gap'), 10) || 8,
  playheadSec: 0,
  selection: new Set(),
  // Demo content
  tracks: [
    {
      id: 't1', name: '音乐', color: '#5b8cff', clips: [
        { id: 'c1', name: 'Intro', start: 0, duration: 3, color: '#4f46e5' },
        { id: 'c2', name: 'Beat', start: 3.5, duration: 2.5, color: '#06b6d4' }
      ]
    },
    { id: 't2', name: '人声', color: '#34d399', clips: [
      { id: 'c3', name: 'Verse', start: 1.2, duration: 3.2, color: '#22c55e' }
    ]},
    { id: 't3', name: '效果', color: '#f59e0b', clips: [
      { id: 'c4', name: 'FX', start: 0.2, duration: 0.8, color: '#f97316' },
      { id: 'c5', name: 'Whoosh', start: 2.0, duration: 1.0, color: '#f43f5e' }
    ]}
  ]
};

// Computed helpers
const laneHeight = () => state.trackHeight + state.trackGap;
const px = (sec) => Math.round(sec * state.pixelsPerSecond);
const sec = (pxVal) => pxVal / state.pixelsPerSecond;
const gridX = () => Math.max(1, Math.round(state.pixelsPerSecond * state.snapIntervalSec));

function withIdMap() {
  const map = new Map();
  for (const track of state.tracks) {
    for (const clip of track.clips) map.set(clip.id, { trackId: track.id, clip });
  }
  return map;
}

function getTrackIndexById(trackId) {
  return state.tracks.findIndex(t => t.id === trackId);
}

function timeSpanSec() {
  let end = 10;
  for (const t of state.tracks) {
    for (const c of t.clips) {
      end = Math.max(end, c.start + c.duration + 2);
    }
  }
  return end;
}

function updateTimelineSize() {
  const widthPx = px(timeSpanSec());
  timelineEl.style.width = widthPx + 'px';
  // Update CSS grid size for background vertical lines
  gridLayerEl.style.setProperty('--grid-size-x', gridX() + 'px');
}

function renderSidebarLabels() {
  sidebarLabelsEl.innerHTML = '';
  state.tracks.forEach((t, idx) => {
    const div = document.createElement('div');
    div.className = 'sidebar__label';
    div.textContent = `${idx + 1}. ${t.name}`;
    sidebarLabelsEl.appendChild(div);
  });
}

function renderRows() {
  rowsLayerEl.innerHTML = '';
  state.tracks.forEach((t, idx) => {
    const row = document.createElement('div');
    row.className = 'row';
    row.style.top = (idx * laneHeight()) + 'px';
    rowsLayerEl.appendChild(row);
  });
  // Ensure content height covers all rows
  timelineEl.style.height = (state.tracks.length * laneHeight()) + 'px';
}

function formatTime(secVal) {
  const ms = Math.round(secVal * 1000);
  const s = Math.floor(ms / 1000);
  const remMs = ms % 1000;
  return `${s}.${String(remMs).padStart(3, '0')}s`;
}

function renderClips() {
  clipsLayerEl.innerHTML = '';
  for (const [trackIndex, track] of state.tracks.entries()) {
    for (const clip of track.clips) {
      const el = document.createElement('div');
      el.className = 'clip';
      el.dataset.id = clip.id;
      el.dataset.trackId = track.id;
      el.style.left = px(clip.start) + 'px';
      el.style.top = (trackIndex * laneHeight()) + 'px';
      el.style.width = px(clip.duration) + 'px';
      if (clip.color) el.style.background = clip.color;
      if (state.selection.has(clip.id)) el.classList.add('selected');

      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = clip.name || clip.id;
      const time = document.createElement('div');
      time.className = 'time';
      time.textContent = `${formatTime(clip.start)} ~ ${formatTime(clip.start + clip.duration)}`;
      const handleL = document.createElement('div');
      handleL.className = 'resize-handle left';
      const handleR = document.createElement('div');
      handleR.className = 'resize-handle right';
      el.append(name, time, handleL, handleR);

      el.addEventListener('pointerdown', (e) => {
        if (e.shiftKey) {
          if (state.selection.has(clip.id)) state.selection.delete(clip.id);
          else state.selection.add(clip.id);
        } else {
          if (!state.selection.has(clip.id)) {
            state.selection.clear();
            state.selection.add(clip.id);
          }
        }
        renderClips();
      });

      clipsLayerEl.appendChild(el);
    }
  }
}

// RULER
function computeNiceStep(pxPerSec) {
  const candidates = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 60];
  for (const s of candidates) {
    if (s * pxPerSec >= 70) return s; // keep label spacing readable
  }
  return 120; // fallback 2 minutes
}

function drawRuler() {
  const ctx = rulerCanvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const widthCss = rulerCanvas.clientWidth || rulerCanvas.offsetWidth;
  const heightCss = rulerCanvas.clientHeight || 32;
  rulerCanvas.width = Math.floor(widthCss * dpr);
  rulerCanvas.height = Math.floor(heightCss * dpr);
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, widthCss, heightCss);

  const viewLeft = viewportEl.scrollLeft;
  const viewRight = viewLeft + widthCss;
  const secLeft = sec(viewLeft);
  const secRight = sec(viewRight);

  ctx.fillStyle = '#dbe2ff';
  ctx.font = '12px ui-sans-serif, system-ui, -apple-system, Segoe UI';
  ctx.textBaseline = 'top';
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';

  const major = computeNiceStep(state.pixelsPerSecond);
  const minor = major / 5;

  const start = Math.floor(secLeft / minor) * minor;
  for (let t = start; t <= secRight; t += minor) {
    const x = Math.round(px(t) - viewLeft) + 0.5;
    const isMajor = Math.abs((t / major) - Math.round(t / major)) < 1e-6;
    const h = isMajor ? 18 : 10;
    ctx.globalAlpha = isMajor ? 0.8 : 0.4;
    ctx.beginPath();
    ctx.moveTo(x, heightCss - h);
    ctx.lineTo(x, heightCss);
    ctx.stroke();
    if (isMajor) {
      ctx.globalAlpha = 0.95;
      ctx.fillText(t.toFixed(2) + 's', x + 4, 2);
    }
  }
}

function updatePlayheadPosition() {
  const x = px(state.playheadSec) - viewportEl.scrollLeft;
  playheadEl.style.left = x + 'px';
}

viewportEl.addEventListener('scroll', () => {
  drawRuler();
  updatePlayheadPosition();
});

// PLAYHEAD interactions
function setPlayheadByClientX(clientX) {
  const rect = viewportEl.getBoundingClientRect();
  const xInContent = viewportEl.scrollLeft + Math.max(0, Math.min(rect.width, clientX - rect.left));
  let s = sec(xInContent);
  if (state.snapEnabled) {
    const step = state.snapIntervalSec;
    s = Math.round(s / step) * step;
  }
  state.playheadSec = Math.max(0, s);
  updatePlayheadPosition();
}

playheadEl.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const move = (ev) => setPlayheadByClientX(ev.clientX);
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up, { once: true });
});

// Click on ruler area to set playhead
$('.timeline__rulerWrap').addEventListener('pointerdown', (e) => {
  setPlayheadByClientX(e.clientX);
});

// GRID AND INTERACT
function initInteract() {
  const currentGridX = gridX();
  const gridY = laneHeight();

  interact('.clip').unset();

  interact('.clip')
    .draggable({
      inertia: false,
      listeners: {
        start(event) {
          const target = event.target;
          // Store initial data for batch move (single or multi)
          const ids = new Set(state.selection.size ? state.selection : [target.dataset.id]);
          const map = new Map();
          for (const id of ids) {
            const el = clipsLayerEl.querySelector(`.clip[data-id="${id}"]`);
            map.set(id, {
              startLeft: parseFloat(el.style.left) || 0,
              startTop: parseFloat(el.style.top) || 0,
              startTrackIndex: Math.round((parseFloat(el.style.top) || 0) / gridY),
              startX: 0,
              startY: 0
            });
          }
          target._dragBatch = { ids, map };
        },
        move(event) {
          const { target, dx, dy } = event;
          const batch = target._dragBatch;
          if (!batch) return;
          // tentative offset
          const nx = (batch.map.get(target.dataset.id).startX || 0) + dx;
          const ny = (batch.map.get(target.dataset.id).startY || 0) + dy;
          // Snap while dragging
          const sx = state.snapEnabled ? Math.round(nx / currentGridX) * currentGridX : nx;
          const sy = Math.round(ny / gridY) * gridY; // always snap vertically by track rows

          for (const id of batch.ids) {
            const el = clipsLayerEl.querySelector(`.clip[data-id="${id}"]`);
            el.style.transform = `translate(${sx}px, ${sy}px)`;
          }
          // Update cached offset on the leader
          batch.map.get(target.dataset.id).startX = sx;
          batch.map.get(target.dataset.id).startY = sy;
        },
        end(event) {
          const { target } = event;
          const batch = target._dragBatch;
          if (!batch) return;
          const changes = [];
          for (const id of batch.ids) {
            const el = clipsLayerEl.querySelector(`.clip[data-id="${id}"]`);
            const base = batch.map.get(id);
            const toLeft = base.startLeft + (base.startX || 0);
            const toTop = base.startTop + (base.startY || 0);
            const newTrackIndex = clamp(Math.round(toTop / gridY), 0, state.tracks.length - 1);
            const newStartSec = Math.max(0, sec(toLeft));
            changes.push({ id, toLeft, toTop, newTrackIndex, newStartSec });
          }

          // Validate collisions per track
          const snapshot = serializeClips();
          let valid = true;
          for (const ch of changes) {
            const info = findClip(snapshot, ch.id);
            // Temporarily move in snapshot
            info.trackId = state.tracks[ch.newTrackIndex].id;
            info.clip.start = ch.newStartSec;
            if (hasOverlap(snapshot, info.trackId, info.clip)) { valid = false; break; }
          }

          if (!valid) {
            // Revert transforms
            for (const id of batch.ids) {
              const el = clipsLayerEl.querySelector(`.clip[data-id="${id}"]`);
              el.style.transform = '';
            }
          } else {
            // Commit
            for (const ch of changes) {
              const { clip, track } = getClipAndTrack(ch.id);
              // Remove from old track if moved cross-track
              const oldTrack = track;
              const newTrack = state.tracks[ch.newTrackIndex];
              if (oldTrack !== newTrack) {
                oldTrack.clips = oldTrack.clips.filter(c => c.id !== clip.id);
                newTrack.clips.push(clip);
              }
              clip.start = ch.newStartSec;
            }
            // Normalize order inside tracks
            for (const t of state.tracks) {
              t.clips.sort((a, b) => a.start - b.start);
            }
            // Re-render to clear transforms
            renderClips();
          }
          target._dragBatch = null;
        }
      }
    })
    .styleCursor(false);

  interact('.clip')
    .resizable({
      edges: { left: '.resize-handle.left', right: '.resize-handle.right', bottom: false, top: false },
      inertia: false,
      listeners: {
        start(event) {
          const el = event.target;
          el._resizeBase = {
            left: parseFloat(el.style.left) || 0,
            width: parseFloat(el.style.width) || 0,
            trackIndex: Math.round((parseFloat(el.style.top) || 0) / gridY)
          };
        },
        move(event) {
          const el = event.target;
          const base = el._resizeBase;
          let newLeft = base.left + event.deltaRect.left;
          let newWidth = base.width + event.deltaRect.width;

          // Bounds
          newLeft = Math.max(0, newLeft);
          newWidth = Math.max(gridX(), newWidth);

          // Snap in pixels if enabled
          if (state.snapEnabled) {
            newLeft = Math.round(newLeft / currentGridX) * currentGridX;
            newWidth = Math.round(newWidth / currentGridX) * currentGridX;
            newWidth = Math.max(currentGridX, newWidth);
          }

          // Tentatively apply via transform to avoid layout thrash
          el.style.transform = `translate(${newLeft - base.left}px, 0px)`;
          el.style.width = `${newWidth}px`;
        },
        end(event) {
          const el = event.target;
          const base = el._resizeBase;
          let newLeft = base.left + (parseFloat(el.style.transform.replace(/translate\(([^,]+)px,.*/, '$1')) || 0);
          if (!isFinite(newLeft)) newLeft = base.left;
          let newWidth = parseFloat(el.style.width) || base.width;

          const { clip, track } = getClipAndTrack(el.dataset.id);
          const newStartSec = Math.max(0, sec(newLeft));
          const newDuration = Math.max(sec(newWidth), state.snapIntervalSec);

          const snapshot = serializeClips();
          const info = findClip(snapshot, clip.id);
          info.clip.start = newStartSec;
          info.clip.duration = newDuration;
          if (hasOverlap(snapshot, track.id, info.clip)) {
            // Revert
            el.style.transform = '';
            el.style.width = base.width + 'px';
          } else {
            clip.start = newStartSec;
            clip.duration = newDuration;
            track.clips.sort((a, b) => a.start - b.start);
            renderClips();
          }
          el._resizeBase = null;
        }
      }
    });
}

function getClipAndTrack(clipId) {
  for (const track of state.tracks) {
    const clip = track.clips.find(c => c.id === clipId);
    if (clip) return { clip, track };
  }
  throw new Error('clip not found: ' + clipId);
}

function serializeClips() {
  // Deep-ish copy for simulation
  return state.tracks.map(t => ({
    id: t.id,
    clips: t.clips.map(c => ({ id: c.id, start: c.start, duration: c.duration }))
  }));
}

function findClip(snapshot, clipId) {
  for (const t of snapshot) {
    const c = t.clips.find(x => x.id === clipId);
    if (c) return { trackId: t.id, clip: c };
  }
  throw new Error('clip not found in snapshot: ' + clipId);
}

function hasOverlap(snapshot, trackId, clipCandidate) {
  const track = snapshot.find(t => t.id === trackId);
  if (!track) return false;
  const aStart = clipCandidate.start;
  const aEnd = clipCandidate.start + clipCandidate.duration;
  for (const c of track.clips) {
    if (c.id === clipCandidate.id) continue;
    const bStart = c.start;
    const bEnd = c.start + c.duration;
    if (aStart < bEnd && aEnd > bStart) return true;
  }
  return false;
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// UI controls
zoomRangeEl.addEventListener('input', () => {
  state.pixelsPerSecond = Number(zoomRangeEl.value);
  zoomOutEl.textContent = String(state.pixelsPerSecond);
  updateTimelineSize();
  drawRuler();
  renderClips();
  initInteract();
  updatePlayheadPosition();
});

snapToggleEl.addEventListener('change', () => {
  state.snapEnabled = snapToggleEl.checked;
});

snapInputEl.addEventListener('change', () => {
  const v = Number(snapInputEl.value);
  if (!isFinite(v) || v <= 0) { snapInputEl.value = String(state.snapIntervalSec); return; }
  state.snapIntervalSec = v;
  updateTimelineSize();
  initInteract();
});

btnAddClip.addEventListener('click', () => {
  // Add to top track at playhead
  const t = state.tracks[0];
  const id = 'c' + Math.random().toString(36).slice(2, 8);
  const duration = Math.max(state.snapIntervalSec, 1.0);
  const newClip = { id, name: 'New', start: Math.max(0, state.playheadSec), duration, color: '#8b5cf6' };

  // Snap start
  if (state.snapEnabled) {
    const step = state.snapIntervalSec;
    newClip.start = Math.round(newClip.start / step) * step;
  }

  // Ensure not overlapping; if overlap, push to the end of last clip
  const snapshot = serializeClips();
  const trackSnap = snapshot.find(x => x.id === t.id);
  trackSnap.clips.push({ id, start: newClip.start, duration });
  if (hasOverlap(snapshot, t.id, trackSnap.clips[trackSnap.clips.length - 1])) {
    const end = t.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
    newClip.start = end;
  }

  t.clips.push(newClip);
  t.clips.sort((a, b) => a.start - b.start);
  renderClips();
  initInteract();
});

btnDelete.addEventListener('click', () => {
  if (!state.selection.size) return;
  for (const track of state.tracks) {
    track.clips = track.clips.filter(c => !state.selection.has(c.id));
  }
  state.selection.clear();
  renderClips();
  initInteract();
});

btnFit.addEventListener('click', () => {
  const totalSec = timeSpanSec();
  const viewWidth = viewportEl.clientWidth || 1200;
  const pps = clamp(Math.floor(viewWidth / totalSec), 40, 400);
  state.pixelsPerSecond = pps;
  zoomRangeEl.value = String(pps);
  zoomOutEl.textContent = String(pps);
  updateTimelineSize();
  drawRuler();
  renderClips();
  initInteract();
});

// Keyboard shortcuts: Delete, arrows to nudge, A to select all in view
document.addEventListener('keydown', (e) => {
  if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    btnDelete.click();
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    if (!state.selection.size) return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    const step = e.altKey ? (state.snapIntervalSec / 5) : state.snapIntervalSec;
    const delta = dir * step;
    const snapshot = serializeClips();
    let valid = true;
    for (const id of state.selection) {
      const info = findClip(snapshot, id);
      info.clip.start = Math.max(0, info.clip.start + delta);
      if (hasOverlap(snapshot, info.trackId, info.clip)) { valid = false; break; }
    }
    if (valid) {
      for (const id of state.selection) {
        const { clip } = getClipAndTrack(id);
        clip.start = Math.max(0, clip.start + delta);
      }
      for (const t of state.tracks) t.clips.sort((a, b) => a.start - b.start);
      renderClips();
      initInteract();
    }
  } else if (e.key.toLowerCase() === 'a' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    state.selection.clear();
    for (const t of state.tracks) for (const c of t.clips) state.selection.add(c.id);
    renderClips();
  }
});

// Initial render
function renderAll() {
  updateTimelineSize();
  renderSidebarLabels();
  renderRows();
  renderClips();
  initInteract();
  drawRuler();
  updatePlayheadPosition();
}

window.addEventListener('resize', () => {
  drawRuler();
  updatePlayheadPosition();
});

renderAll();

