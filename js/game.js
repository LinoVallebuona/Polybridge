/*
 * Bridgewright — editor, renderer, input and UI.
 * Depends on physics.js and levels.js (window.BW).
 */
(function () {
  'use strict';

  const { World, MATERIALS, MATERIAL_ORDER, VEHICLES, LEVELS, pointInPoly, closestT, designCost } = window.BW;

  const GRID = 0.5;
  const STEP = 1 / 60;
  const HIT_PX = 14;
  const STORE = 'bridgewright.v1';

  /* ---------- tiny storage wrapper (storage can be unavailable) ---------- */
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(`${STORE}.${key}`); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(`${STORE}.${key}`, JSON.stringify(value)); } catch (e) { /* ignore */ }
    },
  };

  /* ---------- DOM ---------- */
  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const ui = {
    levelNum: $('level-num'), levelName: $('level-name'),
    budget: $('budget'), budgetText: $('budget-text'), budgetFill: $('budget-fill'), budgetStars: $('budget-stars'), tick2: $('tick-2'), tick3: $('tick-3'),
    resultStars: $('result-stars'), starTotal: $('star-total'),
    materials: $('materials'), tools: [...document.querySelectorAll('.tool')],
    play: $('btn-play'), stress: $('btn-stress'), slow: $('btn-slow'), sound: $('btn-sound'),
    undo: $('btn-undo'), redo: $('btn-redo'), clear: $('btn-clear'), share: $('btn-share'), menuBtn: $('btn-menu'),
    simStatus: $('sim-status'), toast: $('toast'),
    menu: $('menu'), levelGrid: $('level-grid'),
    result: $('result'), resultEyebrow: $('result-eyebrow'), resultTitle: $('result-title'), resultText: $('result-text'), resultStats: $('result-stats'),
    resultEdit: $('btn-result-edit'), resultWatch: $('btn-result-watch'), resultNext: $('btn-result-next'),
    shareBox: $('share'), shareCode: $('share-code'), importCode: $('import-code'), importError: $('import-error'),
    copy: $('btn-copy'), importBtn: $('btn-import'), shareClose: $('btn-share-close'),
    topbar: $('topbar'), toolbar: $('toolbar'), editActions: $('edit-actions'),
  };

  /* ---------- state ---------- */
  const S = {
    mode: 'build',            // build | sim
    levelIndex: 0,
    level: LEVELS[0],
    points: [],               // {x, y, anchor}
    beams: [],                // {a, b, mat}   (a/b are point objects)
    mat: 'road',
    tool: 'build',
    stress: false,
    slow: false,
    sound: store.get('sound', true),
    undo: [], redo: [],
    world: null,
    resultShown: false,
    // interaction
    from: null,               // point a beam is being drawn from
    dragMode: false,          // true while the pointer is held after pressing on `from`
    cursor: { x: 0, y: 0, sx: 0, sy: 0, inside: false },
    hoverPoint: null, hoverBeam: null,
    moving: null, moveOrigin: null,
    pan: null,
    pointers: new Map(),
    pinch: null,
    particles: [],
    time: 0,
  };
  const cam = { x: 0, y: 0, scale: 40 };
  let W = 0, H = 0, DPR = 1;

  /* ---------- helpers ---------- */
  const fmt = (n) => (n === Infinity ? '∞' : '$' + Math.round(n).toLocaleString('en-US'));
  const snap = (v) => Math.round(v / GRID) * GRID;
  const toScreen = (x, y) => [(x - cam.x) * cam.scale + W / 2, (cam.y - y) * cam.scale + H / 2];
  const toWorld = (sx, sy) => [(sx - W / 2) / cam.scale + cam.x, cam.y - (sy - H / 2) / cam.scale];
  const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
  const insideTerrain = (x, y) => S.level.terrain.some((poly) => pointInPoly(x, y, poly));
  const inBounds = (x, y) => { const b = S.level.bounds; return x >= b.x0 - 1e-6 && x <= b.x1 + 1e-6 && y >= b.y0 - 1e-6 && y <= b.y1 + 1e-6; };

  const allowedMats = (lv = S.level) => lv.materials || MATERIAL_ORDER;
  const isUnlocked = (key, lv = S.level) => allowedMats(lv).includes(key);
  function unlockLevel(key) {
    const i = LEVELS.findIndex((lv) => isUnlocked(key, lv));
    return i < 0 ? null : i;
  }

  /* materials that first become available on level i */
  function newMaterials(i) {
    if (i === 0 || LEVELS[i].sandbox) return [];
    return allowedMats(LEVELS[i]).filter((k) => !LEVELS.slice(0, i).some((lv) => isUnlocked(k, lv)));
  }

  function beamLen(b) { return dist(b.a.x, b.a.y, b.b.x, b.b.y); }
  function cost() {
    let c = 0;
    for (const b of S.beams) c += beamLen(b) * MATERIALS[b.mat].cost;
    return Math.round(c);
  }

  /* ---------- design (de)serialisation ---------- */
  function serialize() {
    const anchors = S.points.filter((p) => p.anchor);
    const free = S.points.filter((p) => !p.anchor);
    const order = [...anchors, ...free];
    const idx = new Map(order.map((p, i) => [p, i]));
    return {
      points: free.map((p) => [round3(p.x), round3(p.y)]),
      beams: S.beams.map((b) => [idx.get(b.a), idx.get(b.b), b.mat]),
    };
  }
  const round3 = (v) => Math.round(v * 1000) / 1000;

  function deserialize(data) {
    const anchors = S.level.anchors.map(([x, y]) => ({ x, y, anchor: true }));
    const free = (data && data.points ? data.points : []).map(([x, y]) => ({ x, y, anchor: false }));
    const all = [...anchors, ...free];
    const beams = [];
    for (const [i, j, mat] of (data && data.beams) || []) {
      if (all[i] && all[j] && MATERIALS[mat] && isUnlocked(mat) && i !== j) beams.push({ a: all[i], b: all[j], mat });
    }
    S.points = all;
    S.beams = beams;
    pruneOrphans();
  }

  /* World-ready design: anchors first, in level order. */
  function worldDesign() {
    const d = serialize();
    return { points: [...S.level.anchors.map((a) => [a[0], a[1]]), ...d.points], beams: d.beams };
  }

  function encodeDesign() {
    const json = JSON.stringify({ l: S.level.id, ...serialize() });
    return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeDesign(code) {
    code = String(code).trim().replace(/^.*#/, '');
    const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(escape(atob(b64 + '==='.slice((b64.length + 3) % 4))));
    const d = JSON.parse(json);
    if (!d || typeof d.l !== 'string' || !Array.isArray(d.points) || !Array.isArray(d.beams)) throw new Error('bad design');
    return d;
  }

  function saveDesign() { store.set(`design.${S.level.id}`, serialize()); }

  function pushHistory() {
    S.undo.push(JSON.stringify(serialize()));
    if (S.undo.length > 200) S.undo.shift();
    S.redo.length = 0;
  }
  function restore(snapshot) { deserialize(JSON.parse(snapshot)); S.from = null; changed(false); }
  function undo() {
    if (S.mode !== 'build' || !S.undo.length) return;
    S.redo.push(JSON.stringify(serialize()));
    restore(S.undo.pop());
  }
  function redo() {
    if (S.mode !== 'build' || !S.redo.length) return;
    S.undo.push(JSON.stringify(serialize()));
    restore(S.redo.pop());
  }
  function changed(sound = true) {
    saveDesign();
    updateHud();
    if (sound) sfx.click();
  }

  /* ---------- editing ---------- */
  function findPointAt(x, y) {
    let best = null, bd = 1e-6;
    for (const p of S.points) { const d = dist(p.x, p.y, x, y); if (d < bd) { bd = d; best = p; } }
    return best;
  }
  function pickPoint(sx, sy) {
    let best = null, bd = HIT_PX;
    for (const p of S.points) {
      const [px, py] = toScreen(p.x, p.y);
      const d = dist(px, py, sx, sy);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  function pickBeam(sx, sy) {
    const [wx, wy] = toWorld(sx, sy);
    let best = null, bd = Math.max(0.2, 10 / cam.scale);
    for (const b of S.beams) {
      const t = closestT(wx, wy, b.a.x, b.a.y, b.b.x, b.b.y);
      const qx = b.a.x + (b.b.x - b.a.x) * t, qy = b.a.y + (b.b.y - b.a.y) * t;
      const d = dist(wx, wy, qx, qy);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  /*
   * A spot on an existing beam under the cursor where a new joint can split it.
   * Prefers a grid point lying on the beam, keeps clear of the beam's own ends.
   */
  function beamSpotAt(sx, sy, skip) {
    const b = pickBeam(sx, sy);
    if (!b || (skip && skip(b))) return null;
    const [wx, wy] = toWorld(sx, sy);
    const L = beamLen(b);
    let t = closestT(wx, wy, b.a.x, b.a.y, b.b.x, b.b.y);
    // a grid point that sits on the beam (within 2 cm) and near the cursor wins
    const gx = snap(wx), gy = snap(wy);
    const gt = closestT(gx, gy, b.a.x, b.a.y, b.b.x, b.b.y);
    const ox = b.a.x + (b.b.x - b.a.x) * gt, oy = b.a.y + (b.b.y - b.a.y) * gt;
    if (dist(ox, oy, gx, gy) < 0.02 && dist(gx, gy, wx, wy) < GRID * 0.75) t = gt;
    if (t * L < 0.25 || (1 - t) * L < 0.25) return null; // too close to an end: use the joint instead
    return { x: b.a.x + (b.b.x - b.a.x) * t, y: b.a.y + (b.b.y - b.a.y) * t, beam: b };
  }
  const beamTouches = (b, p) => !!p && (b.a === p || b.b === p || (p.split && p.split === b));

  /* Split beam b at (x, y) and return the new joint. */
  function splitBeam(b, x, y) {
    const p = { x, y, anchor: false };
    S.points.push(p);
    S.beams = S.beams.filter((q) => q !== b);
    S.beams.push({ a: b.a, b: p, mat: b.mat }, { a: p, b: b.b, mat: b.mat });
    return p;
  }

  /* Where a beam from `from` would end if released at the cursor. */
  function previewEnd(from) {
    const m = MATERIALS[S.mat];
    const hit = pickPoint(S.cursor.sx, S.cursor.sy);
    let x, y, existing = null, split = null;
    const spot = hit ? null : beamSpotAt(S.cursor.sx, S.cursor.sy, (b) => beamTouches(b, from));
    if (hit && hit !== from && dist(from.x, from.y, hit.x, hit.y) <= m.maxLen + 1e-6) {
      x = hit.x; y = hit.y; existing = hit;
    } else if (spot && dist(from.x, from.y, spot.x, spot.y) <= m.maxLen + 1e-6) {
      x = spot.x; y = spot.y; split = spot.beam;
    } else {
      x = snap(S.cursor.x); y = snap(S.cursor.y);
      const d = dist(from.x, from.y, x, y);
      if (d > m.maxLen) {
        // clamp along the cursor direction, then look for the best grid point inside the limit
        const dx = S.cursor.x - from.x, dy = S.cursor.y - from.y, dl = Math.hypot(dx, dy) || 1;
        const cx = from.x + (dx / dl) * m.maxLen, cy = from.y + (dy / dl) * m.maxLen;
        let best = null, bd = Infinity;
        for (let gx = snap(cx) - GRID * 2; gx <= snap(cx) + GRID * 2 + 1e-9; gx += GRID) {
          for (let gy = snap(cy) - GRID * 2; gy <= snap(cy) + GRID * 2 + 1e-9; gy += GRID) {
            if (dist(from.x, from.y, gx, gy) > m.maxLen + 1e-6) continue;
            const e = dist(gx, gy, cx, cy);
            if (e < bd) { bd = e; best = [gx, gy]; }
          }
        }
        if (best && bd < GRID * 0.9) { x = best[0]; y = best[1]; } else { x = cx; y = cy; }
      }
      existing = findPointAt(x, y);
    }
    const len = dist(from.x, from.y, x, y);
    let valid = len > 0.24 && existing !== from;
    let reason = '';
    if (!existing && !split) {
      if (!inBounds(x, y)) { valid = false; reason = 'Outside the build area'; }
      else if (insideTerrain(x, y)) { valid = false; reason = 'Cannot build inside rock'; }
    }
    if (existing && S.beams.some((b) => (b.a === from && b.b === existing) || (b.b === from && b.a === existing) ) && S.beams.find((b) => (b.a === from && b.b === existing) || (b.b === from && b.a === existing)).mat === S.mat) {
      valid = false; reason = 'Already built';
    }
    return { x, y, existing, split, len, valid, reason };
  }

  function placeBeam(from, end) {
    if (!end.valid) { if (end.reason) toast(end.reason, true); sfx.error(); return null; }
    pushHistory();
    if (from.split) from = splitBeam(from.split, from.x, from.y); // started on the middle of a beam
    let p = end.existing;
    if (!p && end.split) p = splitBeam(end.split, end.x, end.y);
    if (!p) { p = { x: end.x, y: end.y, anchor: false }; S.points.push(p); }
    S.lastPlace = performance.now();
    const dup = S.beams.find((b) => (b.a === from && b.b === p) || (b.b === from && b.a === p));
    if (dup) dup.mat = S.mat; else S.beams.push({ a: from, b: p, mat: S.mat });
    changed();
    return p;
  }

  function pruneOrphans() {
    const used = new Set();
    for (const b of S.beams) { used.add(b.a); used.add(b.b); }
    S.points = S.points.filter((p) => p.anchor || used.has(p));
  }
  function deleteBeam(b) {
    pushHistory();
    S.beams = S.beams.filter((q) => q !== b);
    pruneOrphans();
    changed();
  }
  function deletePoint(p) {
    if (p.anchor) {
      const attached = S.beams.filter((b) => b.a === p || b.b === p);
      if (!attached.length) return;
      pushHistory();
      S.beams = S.beams.filter((b) => b.a !== p && b.b !== p);
    } else {
      pushHistory();
      S.beams = S.beams.filter((b) => b.a !== p && b.b !== p);
    }
    pruneOrphans();
    changed();
  }
  function deleteAt(sx, sy) {
    const p = pickPoint(sx, sy);
    if (p && !p.anchor) { deletePoint(p); return true; }
    const b = pickBeam(sx, sy);
    if (b) { deleteBeam(b); return true; }
    return false;
  }

  function tryMove(p, x, y) {
    if (p.x === x && p.y === y) return;
    if (!inBounds(x, y) || insideTerrain(x, y)) return;
    const other = findPointAt(x, y);
    if (other && other !== p) return;
    for (const b of S.beams) {
      if (b.a !== p && b.b !== p) continue;
      const q = b.a === p ? b.b : b.a;
      const l = dist(q.x, q.y, x, y);
      if (l > MATERIALS[b.mat].maxLen + 1e-6 || l < 0.24) return;
    }
    p.x = x; p.y = y;
    updateHud();
  }

  function clearDesign() {
    if (!S.beams.length) return;
    pushHistory();
    S.beams = [];
    pruneOrphans();
    changed();
  }

  /* ---------- level flow ---------- */
  function loadLevel(i, design) {
    stopSim(true);
    S.levelIndex = i;
    S.level = LEVELS[i];
    S.undo = []; S.redo = [];
    S.from = null; S.moving = null;
    deserialize(design || store.get(`design.${S.level.id}`, null));
    if (!isUnlocked(S.mat)) S.mat = 'road';
    store.set('lastLevel', i);
    fitCamera();
    updateHud();
    const fresh = newMaterials(i);
    toast(fresh.length ? `New: ${fresh.map((k) => MATERIALS[k].name).join(' and ')}. ${S.level.hint}` : S.level.hint);
  }

  function progress() { return store.get('progress', {}); }
  function recordWin(c) {
    const p = progress();
    const prev = p[S.level.id] || {};
    const underBudget = c <= S.level.budget;
    p[S.level.id] = {
      held: true,
      done: prev.done || underBudget,
      best: underBudget ? Math.min(prev.best || Infinity, c) : prev.best,
    };
    store.set('progress', p);
  }

  /* ---------- stars: 1 = under budget, 2 = ≤85 % of budget, 3 = ≤70 % ---------- */
  const STAR_RATIOS = [1, 0.85, 0.7];
  function starThresholds(lv) { return STAR_RATIOS.map((r) => Math.floor(lv.budget * r)); }
  function starsFor(lv, c) {
    if (lv.sandbox || c == null || !(c <= lv.budget)) return 0;
    return starThresholds(lv).filter((t) => c <= t).length;
  }
  const STAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.9 6 6.6.8-4.9 4.6 1.3 6.5L12 17.3l-5.9 3.2 1.3-6.5L2.5 9.4l6.6-.8z"/></svg>';
  function starsHTML(n) {
    let out = '';
    for (let i = 0; i < 3; i++) out += `<span class="star${i < n ? ' on' : ''}">${STAR_SVG}</span>`;
    return out;
  }
  function totalStars() {
    const p = progress();
    let got = 0, max = 0;
    for (const lv of LEVELS) { if (lv.sandbox) continue; max += 3; got += starsFor(lv, (p[lv.id] || {}).best); }
    return { got, max };
  }

  function startSim() {
    if (S.mode === 'sim') return;
    if (!S.beams.some((b) => MATERIALS[b.mat].drivable)) { toast('Lay some road first. Vehicles only drive on road.', true); sfx.error(); return; }
    S.from = null; S.moving = null; S.pan = null;
    S.mode = 'sim';
    S.world = new World(S.level, worldDesign());
    S.resultShown = false;
    S.particles = [];
    simAcc = 0;
    hideToast();
    updateHud();
    sfx.start();
  }
  function stopSim(silent) {
    if (S.mode !== 'sim') return;
    S.mode = 'build';
    S.world = null;
    S.particles = [];
    ui.result.hidden = true;
    updateHud();
    if (!silent) sfx.click();
  }
  function toggleSim() { if (S.mode === 'sim') stopSim(); else startSim(); }

  function showResult() {
    const w = S.world;
    const c = cost();
    const budget = S.level.budget;
    const won = w.status === 'won';
    const under = c <= budget;
    ui.resultEyebrow.className = 'eyebrow ' + (won && under ? 'ok' : 'bad');
    if (won) {
      recordWin(c);
      ui.resultEyebrow.textContent = under ? 'Level complete' : 'Over budget';
      ui.resultTitle.textContent = under ? 'The bridge held' : 'It held, but it cost too much';
      ui.resultText.textContent = under
        ? `Every vehicle reached the flag.${S.level.sandbox ? '' : ' Try trimming it for a cheaper record.'}`
        : `Every vehicle made it, but you are ${fmt(c - budget)} over budget. Trim some material and try again.`;
    } else {
      ui.resultEyebrow.textContent = 'Test failed';
      ui.resultTitle.textContent = 'Back to the drawing board';
      ui.resultText.textContent = w.failReason + ' Turn on Stress to find the weak spots.';
    }
    const best = (progress()[S.level.id] || {}).best;
    const broken = w.beams.filter((b) => b.broken && !b.stub).length;
    ui.resultStats.innerHTML = '';
    const stat = (k, v, cls) => {
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = v; if (cls) dd.className = cls;
      ui.resultStats.append(dt, dd);
    };
    stat('Cost', fmt(c), under ? '' : 'bad');
    stat('Budget', fmt(budget));
    stat('Vehicles across', `${w.vehiclesDone} / ${w.vehiclesTotal}`, won ? 'ok' : 'bad');
    stat('Beams broken', String(broken), broken ? 'bad' : '');
    if (best) stat('Best under budget', fmt(best), 'ok');
    const earned = won ? starsFor(S.level, c) : 0;
    ui.resultStars.hidden = !(won && under && !S.level.sandbox);
    ui.resultStars.innerHTML = starsHTML(earned);
    ui.resultStars.setAttribute('aria-label', `${earned} of 3 stars`);
    if (won && under && !S.level.sandbox) {
      const th = starThresholds(S.level);
      if (earned < 3) {
        ui.resultText.textContent = `Every vehicle reached the flag. Get it to ${fmt(th[earned])} or less for ${earned + 1} star${earned ? 's' : ''}.`;
      } else {
        ui.resultText.textContent = 'Every vehicle reached the flag, and cheaply. Three stars.';
      }
    }
    const hasNext = S.levelIndex < LEVELS.length - 1;
    ui.resultNext.hidden = !(won && under && hasNext);
    ui.resultWatch.hidden = false;
    ui.result.hidden = false;
    if (won && under) sfx.win(); else sfx.fail();
    renderMenu();
  }

  /* ---------- camera ---------- */
  function hudInsets() {
    return { top: ui.topbar.offsetHeight || 60, bottom: ui.toolbar.offsetHeight || 80 };
  }
  function fitCamera() {
    const lv = S.level, b = lv.bounds;
    const x0 = Math.min(b.x0, lv.start - 3), x1 = Math.max(b.x1, lv.finish + 1);
    const y0 = Math.min(b.y0, lv.waterY) - 1, y1 = b.y1 + 0.5;
    const ins = hudInsets();
    const availH = Math.max(100, H - ins.top - ins.bottom - 20);
    const availW = Math.max(100, W - 24);
    // show the whole crossing when it fits comfortably, otherwise frame the build area
    const sBuild = Math.min(availW / (b.x1 - b.x0 + 4), availH / (y1 - y0));
    const sAll = Math.min(availW / (x1 - x0), availH / (y1 - y0));
    const showAll = sAll > sBuild * 0.72;
    cam.scale = Math.max(8, Math.min(90, showAll ? sAll : sBuild));
    cam.x = showAll ? (x0 + x1) / 2 : (b.x0 + b.x1) / 2;
    const midY = (y0 + y1) / 2;
    cam.y = midY - ((ins.top - ins.bottom) / 2) / cam.scale;
  }
  function zoomAt(sx, sy, factor) {
    const [wx, wy] = toWorld(sx, sy);
    cam.scale = Math.max(6, Math.min(160, cam.scale * factor));
    const [nx, ny] = toWorld(sx, sy);
    cam.x += wx - nx; cam.y += wy - ny;
  }

  /* ---------- input ---------- */
  function updateCursor(e) {
    const r = canvas.getBoundingClientRect();
    S.cursor.sx = e.clientX - r.left; S.cursor.sy = e.clientY - r.top;
    const [x, y] = toWorld(S.cursor.sx, S.cursor.sy);
    S.cursor.x = x; S.cursor.y = y;
    S.cursor.inside = true;
  }

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    sfx.unlock();
    updateCursor(e);
    S.pointers.set(e.pointerId, { x: S.cursor.sx, y: S.cursor.sy });
    if (S.pointers.size === 2) {
      // second finger: switch to pinch-zoom, abandon whatever the first finger was doing
      if (S.dragMode) { S.from = null; S.dragMode = false; }
      S.moving = null; S.pan = null;
      const [a, b] = [...S.pointers.values()];
      S.pinch = { d: dist(a.x, a.y, b.x, b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      return;
    }
    if (S.pointers.size > 2) return;
    S.downAt = { sx: S.cursor.sx, sy: S.cursor.sy, moved: false, button: e.button };

    if (e.button === 1 || S.mode === 'sim') { startPan(); return; }
    if (e.button === 2) {
      if (S.from) { S.from = null; S.dragMode = false; } else deleteAt(S.cursor.sx, S.cursor.sy);
      return;
    }
    const p = pickPoint(S.cursor.sx, S.cursor.sy);
    if (S.tool === 'build') {
      if (S.from) { S.pendingPlace = true; return; } // finish on pointerup
      if (p) { S.from = p; S.dragMode = true; return; }
      const spot = beamSpotAt(S.cursor.sx, S.cursor.sy);
      if (spot) { S.from = { x: spot.x, y: spot.y, split: spot.beam }; S.dragMode = true; return; }
      startPan();
    } else if (S.tool === 'delete') {
      if (!deleteAt(S.cursor.sx, S.cursor.sy)) startPan(); else S.deleting = true;
    } else if (S.tool === 'move') {
      if (p && !p.anchor) { pushHistory(); S.moving = p; S.moveOrigin = { x: p.x, y: p.y }; return; }
      startPan();
    }
  });

  function startPan() {
    S.pan = { sx: S.cursor.sx, sy: S.cursor.sy, cx: cam.x, cy: cam.y };
    canvas.classList.add('panning');
  }

  canvas.addEventListener('pointermove', (e) => {
    updateCursor(e);
    if (S.pointers.has(e.pointerId)) S.pointers.set(e.pointerId, { x: S.cursor.sx, y: S.cursor.sy });
    if (S.pinch && S.pointers.size >= 2) {
      const [a, b] = [...S.pointers.values()];
      const d = dist(a.x, a.y, b.x, b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      zoomAt(cx, cy, d / (S.pinch.d || d));
      cam.x -= (cx - S.pinch.cx) / cam.scale; cam.y += (cy - S.pinch.cy) / cam.scale;
      S.pinch = { d, cx, cy };
      return;
    }
    if (S.downAt && dist(S.downAt.sx, S.downAt.sy, S.cursor.sx, S.cursor.sy) > 6) S.downAt.moved = true;
    if (S.pan) {
      cam.x = S.pan.cx - (S.cursor.sx - S.pan.sx) / cam.scale;
      cam.y = S.pan.cy + (S.cursor.sy - S.pan.sy) / cam.scale;
      return;
    }
    if (S.mode !== 'build') return;
    if (S.moving) { tryMove(S.moving, snap(S.cursor.x), snap(S.cursor.y)); return; }
    if (S.deleting && (e.buttons & 1)) { deleteAt(S.cursor.sx, S.cursor.sy); return; }
    S.hoverPoint = pickPoint(S.cursor.sx, S.cursor.sy);
    S.hoverBeam = S.hoverPoint ? null : pickBeam(S.cursor.sx, S.cursor.sy);
  });

  function endPointer(e) {
    const wasPinch = !!S.pinch;
    S.pointers.delete(e.pointerId);
    if (S.pointers.size < 2) S.pinch = null;
    if (wasPinch) { S.downAt = null; S.pendingPlace = false; return; }
    if (S.pan) { S.pan = null; canvas.classList.remove('panning'); }
    S.deleting = false;
    if (S.moving) {
      const p = S.moving; S.moving = null;
      if (p.x === S.moveOrigin.x && p.y === S.moveOrigin.y) S.undo.pop(); else changed();
    }
    const down = S.downAt; S.downAt = null;
    if (!down || S.mode !== 'build' || S.tool !== 'build' || e.type === 'pointercancel') { S.pendingPlace = false; return; }
    if (S.from && S.dragMode) {
      S.dragMode = false;
      if (down.moved) {
        const end = previewEnd(S.from);
        placeBeam(S.from, end);
        S.from = null;
      } // a click without moving keeps `from` armed: the next click places the beam
      return;
    }
    if (S.from && S.pendingPlace) {
      S.pendingPlace = false;
      if (down.moved) { // dragged in click mode: still place where released
        const end = previewEnd(S.from);
        const p = placeBeam(S.from, end);
        S.from = p || S.from;
        return;
      }
      const hit = pickPoint(S.cursor.sx, S.cursor.sy);
      const [fx, fy] = toScreen(S.from.x, S.from.y);
      if (hit === S.from || (S.from.split && dist(fx, fy, S.cursor.sx, S.cursor.sy) < HIT_PX)) { S.from = null; return; }
      const end = previewEnd(S.from);
      const p = placeBeam(S.from, end);
      if (p) S.from = p; // chain from the new joint
    }
  }
  canvas.addEventListener('pointerup', endPointer);
  function doubleDelete(sx, sy) {
    if (S.mode !== 'build' || S.tool === 'move') return;
    S.from = null; S.dragMode = false;
    // a double-click that just finished a chain of beams should not delete the beam it made
    if (S.lastPlace && performance.now() - S.lastPlace < 600) return;
    deleteAt(sx, sy);
  }
  let lastTap = null, lastTouchDouble = 0;
  canvas.addEventListener('dblclick', (e) => {
    if (performance.now() - lastTouchDouble < 700) return; // already handled as a double-tap
    updateCursor(e);
    doubleDelete(S.cursor.sx, S.cursor.sy);
  });
  // touch screens: detect double-taps ourselves
  canvas.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'touch') return;
    const now = performance.now();
    const r = canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    if (lastTap && now - lastTap.t < 350 && dist(lastTap.sx, lastTap.sy, sx, sy) < 24) {
      lastTap = null; lastTouchDouble = now;
      doubleDelete(sx, sy);
    } else lastTap = { t: now, sx, sy };
  });
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', () => { S.cursor.inside = false; });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    updateCursor(e);
    const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
    zoomAt(S.cursor.sx, S.cursor.sy, f);
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT')) return;
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (!ui.menu.hidden) { if (k === 'escape' && S.started) toggleMenu(false); return; }
    if (!ui.shareBox.hidden) { if (k === 'escape') ui.shareBox.hidden = true; return; }
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    if (mod) return;
    if (k === ' ' || k === 'enter') { e.preventDefault(); if (!ui.result.hidden) ui.result.hidden = true; toggleSim(); return; }
    if (k === 'escape') {
      if (!ui.result.hidden) { ui.result.hidden = true; return; }
      if (S.from) { S.from = null; S.dragMode = false; return; }
      if (S.mode === 'sim') { stopSim(); return; }
      return;
    }
    const n = parseInt(k, 10);
    if (n >= 1 && n <= MATERIAL_ORDER.length) { setMaterial(MATERIAL_ORDER[n - 1]); return; }
    if (k === 'b') setTool('build');
    else if (k === 'x' || k === 'delete' || k === 'backspace') setTool('delete');
    else if (k === 'm') setTool('move');
    else if (k === 's') toggleStress();
    else if (k === 't') toggleSlow();
    else if (k === 'f' || k === 'r') fitCamera();
    else if (k === 'l') toggleMenu(true);
  });

  /* ---------- UI wiring ---------- */
  function buildMaterialButtons() {
    ui.materials.innerHTML = '';
    MATERIAL_ORDER.forEach((key, i) => {
      const m = MATERIALS[key];
      const b = document.createElement('button');
      b.className = 'btn mat';
      b.dataset.mat = key;
      b.setAttribute('role', 'radio');
      b.title = `${m.name}: ${fmt(m.cost)} per metre, up to ${m.maxLen} m${m.drivable ? ', vehicles drive on it' : ''}${m.tensionOnly ? ', only pulls' : ''} (${i + 1})`;
      b.innerHTML = `<span class="swatch" style="background:${m.color}"></span><span class="mat-text"><span class="mat-name">${m.short || m.name}</span><span class="mat-meta">${fmt(m.cost)}/m · ${m.maxLen} m</span></span><span class="key">${i + 1}</span>`;
      b.insertAdjacentHTML('beforeend', '<svg class="lock" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>');
      b.addEventListener('click', () => setMaterial(key));
      ui.materials.appendChild(b);
    });
  }
  function setMaterial(key) {
    if (!isUnlocked(key)) {
      const at = unlockLevel(key);
      toast(`${MATERIALS[key].name} unlocks at level ${at + 1}, ${LEVELS[at].name}.`, true);
      sfx.error();
      return;
    }
    S.mat = key;
    if (S.tool !== 'build') setTool('build');
    updateHud();
  }
  function setTool(t) {
    S.tool = t;
    S.from = null; S.dragMode = false;
    updateHud();
  }
  function toggleStress() { S.stress = !S.stress; updateHud(); }
  function toggleSlow() { S.slow = !S.slow; updateHud(); }

  ui.tools.forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
  ui.play.addEventListener('click', () => { sfx.unlock(); toggleSim(); });
  ui.stress.addEventListener('click', toggleStress);
  ui.slow.addEventListener('click', toggleSlow);
  ui.undo.addEventListener('click', undo);
  ui.redo.addEventListener('click', redo);
  let clearArmed = 0;
  ui.clear.addEventListener('click', () => {
    if (!S.beams.length) return;
    if (Date.now() - clearArmed < 3000) { clearArmed = 0; ui.clear.querySelector('.label').textContent = 'Clear'; ui.clear.classList.remove('danger'); clearDesign(); return; }
    clearArmed = Date.now();
    ui.clear.querySelector('.label').textContent = 'Sure?';
    ui.clear.classList.add('danger');
    setTimeout(() => { if (clearArmed && Date.now() - clearArmed >= 2900) { clearArmed = 0; ui.clear.querySelector('.label').textContent = 'Clear'; ui.clear.classList.remove('danger'); } }, 3000);
  });
  ui.sound.addEventListener('click', () => { S.sound = !S.sound; store.set('sound', S.sound); sfx.unlock(); updateHud(); });
  ui.menuBtn.addEventListener('click', () => toggleMenu(true));

  ui.resultEdit.addEventListener('click', () => { ui.result.hidden = true; stopSim(); });
  ui.resultWatch.addEventListener('click', () => { ui.result.hidden = true; });
  ui.resultNext.addEventListener('click', () => { ui.result.hidden = true; loadLevel(S.levelIndex + 1); });

  ui.share.addEventListener('click', () => {
    ui.shareCode.value = encodeDesign();
    ui.importCode.value = '';
    ui.importError.hidden = true;
    ui.shareBox.hidden = false;
    ui.shareCode.focus(); ui.shareCode.select();
  });
  ui.shareClose.addEventListener('click', () => { ui.shareBox.hidden = true; });
  ui.copy.addEventListener('click', () => {
    const text = ui.shareCode.value;
    const done = () => { ui.copy.textContent = 'Copied'; setTimeout(() => { ui.copy.textContent = 'Copy code'; }, 1500); };
    const fallback = () => { ui.shareCode.focus(); ui.shareCode.select(); try { document.execCommand('copy'); done(); } catch (e) { ui.copy.textContent = 'Press Ctrl+C'; } };
    try { navigator.clipboard.writeText(text).then(done, fallback); } catch (e) { fallback(); }
  });
  ui.importBtn.addEventListener('click', () => {
    try {
      const d = decodeDesign(ui.importCode.value);
      const i = LEVELS.findIndex((l) => l.id === d.l);
      if (i < 0) throw new Error('unknown level');
      ui.shareBox.hidden = true;
      loadLevel(i);
      pushHistory();
      deserialize(d);
      changed(false);
      toast(`Loaded a shared design for ${LEVELS[i].name}.`);
    } catch (e) {
      ui.importError.textContent = 'That code could not be read. Check that you copied all of it.';
      ui.importError.hidden = false;
    }
  });

  function toggleMenu(show) {
    if (show) { if (S.mode === 'sim') stopSim(true); renderMenu(); }
    ui.menu.hidden = !show;
    document.getElementById('app').classList.toggle('menu-open', !!show);
  }
  function renderMenu() {
    const prog = progress();
    const t = totalStars();
    ui.starTotal.innerHTML = `<span class="stars"><span class="star on">${STAR_SVG}</span></span> ${t.got} / ${t.max} stars`;
    ui.levelGrid.innerHTML = '';
    LEVELS.forEach((lv, i) => {
      const p = prog[lv.id] || {};
      const b = document.createElement('button');
      b.className = 'level-card';
      const veh = summarizeVehicles(lv);
      const st = starsFor(lv, p.best);
      const status = lv.sandbox ? '<span class="pill">Free build</span>'
        : p.done ? `<span class="stars card-stars" aria-label="${st} of 3 stars">${starsHTML(st)}</span>`
        : p.held ? '<span class="pill held">Over budget</span>' : '<span class="pill">New</span>';
      b.innerHTML = `<div class="lc-top"><span class="lc-num">${lv.sandbox ? '∞' : String(i + 1).padStart(2, '0')}</span>${status}</div>
        <div class="lc-name">${lv.name}</div>
        <div class="lc-veh">${veh}</div>
        ${newMaterials(i).length ? `<div class="lc-new">New: ${newMaterials(i).map((k) => MATERIALS[k].name).join(', ')}</div>` : ''}
        <div class="lc-meta"><span>Budget ${fmt(lv.budget)}</span><span>${p.best ? 'Best ' + fmt(p.best) : ''}</span></div>`;
      b.addEventListener('click', () => { S.started = true; toggleMenu(false); loadLevel(i); });
      ui.levelGrid.appendChild(b);
    });
  }
  function summarizeVehicles(lv) {
    const counts = {};
    for (const v of lv.vehicles) counts[v.type] = (counts[v.type] || 0) + 1;
    const gap = lv.anchors[1][0] - lv.anchors[0][0];
    return `${gap} m gap · ` + Object.entries(counts).map(([k, n]) => `${n > 1 ? n + '× ' : ''}${VEHICLES[k].name.toLowerCase()}`).join(', ');
  }

  let toastTimer = 0;
  function toast(text, bad) {
    if (!text) return;
    ui.toast.textContent = text;
    ui.toast.classList.toggle('bad', !!bad);
    ui.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, bad ? 2600 : 6000);
  }
  function hideToast() { ui.toast.hidden = true; }

  function updateHud() {
    const lv = S.level;
    ui.levelNum.textContent = lv.sandbox ? 'Sandbox' : `Level ${S.levelIndex + 1}`;
    ui.levelName.textContent = lv.name;
    const c = cost();
    ui.budgetText.textContent = `${fmt(c)} / ${fmt(lv.budget)}`;
    const ratio = lv.budget === Infinity ? 0 : c / lv.budget;
    ui.budgetFill.style.width = `${Math.min(100, ratio * 100)}%`;
    const showStars = !lv.sandbox;
    ui.budgetStars.hidden = !showStars;
    ui.tick2.hidden = ui.tick3.hidden = !showStars;
    if (showStars) {
      const n = starsFor(lv, c);
      ui.budgetStars.innerHTML = starsHTML(n);
      ui.budgetStars.setAttribute('aria-label', `${n} of 3 stars at this cost`);
      const th = starThresholds(lv);
      ui.tick2.style.left = `${STAR_RATIOS[1] * 100}%`;
      ui.tick3.style.left = `${STAR_RATIOS[2] * 100}%`;
      ui.budget.title = `Cost against budget. 3 stars at ${fmt(th[2])} or less, 2 stars at ${fmt(th[1])} or less, 1 star within ${fmt(th[0])}.`;
    }
    ui.budget.classList.toggle('over', ratio > 1);
    ui.budget.classList.toggle('warn', ratio > 0.85 && ratio <= 1);
    for (const b of ui.materials.children) {
      const locked = !isUnlocked(b.dataset.mat);
      b.classList.toggle('locked', locked);
      const m = MATERIALS[b.dataset.mat];
      b.querySelector('.mat-meta').textContent = locked ? `Level ${unlockLevel(b.dataset.mat) + 1}` : `${fmt(m.cost)}/m · ${m.maxLen} m`;
      const on = b.dataset.mat === S.mat && S.tool === 'build';
      b.classList.toggle('active', on); b.setAttribute('aria-checked', on);
    }
    ui.tools.forEach((b) => { const on = b.dataset.tool === S.tool; b.classList.toggle('active', on); b.setAttribute('aria-checked', on); });
    const sim = S.mode === 'sim';
    ui.play.classList.toggle('running', sim);
    ui.play.querySelector('span').textContent = sim ? 'Edit' : 'Test';
    ui.play.querySelector('svg').innerHTML = sim ? '<path d="M6 6h12v12H6z"/>' : '<path d="M7 4v16l13-8z"/>';
    ui.play.title = sim ? 'Stop and return to building (Space)' : 'Run the simulation (Space)';
    ui.stress.setAttribute('aria-pressed', S.stress);
    ui.slow.setAttribute('aria-pressed', S.slow);
    ui.sound.setAttribute('aria-pressed', S.sound);
    ui.sound.style.opacity = S.sound ? 1 : 0.5;
    ui.undo.disabled = sim || !S.undo.length;
    ui.redo.disabled = sim || !S.redo.length;
    ui.clear.disabled = sim || !S.beams.length;
    ui.share.disabled = sim;
    ui.tools.forEach((b) => { b.disabled = sim; });
    for (const b of ui.materials.children) b.disabled = sim;
    ui.simStatus.hidden = !sim;
  }

  function updateSimStatus() {
    const w = S.world;
    if (!w) return;
    const t = Math.floor(w.time);
    const cls = w.status === 'won' ? 'ok' : w.status === 'failed' ? 'bad' : '';
    const label = w.status === 'won' ? 'Passed' : w.status === 'failed' ? 'Failed' : 'Testing';
    const html = `<span class="${cls}">${label}</span><span>Vehicles ${w.vehiclesDone}/${w.vehiclesTotal}</span><span>${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}</span>${S.slow ? '<span>Slow-mo</span>' : ''}`;
    if (ui.simStatus.innerHTML !== html) ui.simStatus.innerHTML = html;
  }

  /* ---------- sound ---------- */
  const sfx = (() => {
    let ac = null;
    const ok = () => S.sound && ac && ac.state === 'running';
    function tone(freq, dur, type = 'sine', vol = 0.12, slide = 0) {
      if (!ok()) return;
      const t = ac.currentTime;
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
    }
    function noise(dur, vol, freq, q = 1) {
      if (!ok()) return;
      const t = ac.currentTime;
      const len = Math.floor(ac.sampleRate * dur);
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
      const src = ac.createBufferSource(); src.buffer = buf;
      const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
      const g = ac.createGain(); g.gain.value = vol;
      src.connect(f).connect(g).connect(ac.destination); src.start(t);
    }
    let lastBreak = 0;
    return {
      unlock() {
        try {
          if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
          if (ac.state === 'suspended') ac.resume();
        } catch (e) { /* audio unavailable */ }
      },
      click() { tone(520, 0.05, 'triangle', 0.06); },
      error() { tone(180, 0.12, 'square', 0.04); },
      start() { tone(330, 0.08, 'triangle', 0.08); setTimeout(() => tone(495, 0.1, 'triangle', 0.08), 70); },
      snap(mat) {
        const now = performance.now(); if (now - lastBreak < 40) return; lastBreak = now;
        if (mat === 'rope' || mat === 'cable') { tone(900, 0.12, 'sawtooth', 0.05, 0.3); return; }
        noise(0.25, mat === 'wood' ? 0.5 : 0.35, mat === 'wood' ? 900 : 2400, 0.8);
        tone(mat === 'steel' ? 1400 : 220, 0.15, 'square', 0.03, 0.5);
      },
      splash(big) { noise(big ? 0.7 : 0.3, big ? 0.6 : 0.2, 500, 0.6); },
      finish() { tone(880, 0.09, 'triangle', 0.07); },
      win() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'triangle', 0.09), i * 110)); },
      fail() { [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.22, 'triangle', 0.08), i * 150)); },
    };
  })();

  /* ---------- particles ---------- */
  function emit(ev) {
    if (ev.type === 'break') {
      const col = MATERIALS[ev.mat].color;
      for (let i = 0; i < 10; i++) S.particles.push({ x: ev.x, y: ev.y, vx: (Math.random() - 0.5) * 6, vy: Math.random() * 5, life: 0.8 + Math.random() * 0.5, size: 0.06 + Math.random() * 0.08, color: col, g: 1 });
      sfx.snap(ev.mat);
    } else if (ev.type === 'splash') {
      const n = ev.big ? 40 : 14;
      for (let i = 0; i < n; i++) S.particles.push({ x: ev.x + (Math.random() - 0.5) * 2, y: ev.y, vx: (Math.random() - 0.5) * 5, vy: 3 + Math.random() * 6, life: 1 + Math.random() * 0.6, size: 0.08 + Math.random() * 0.12, color: '#e8f7fb', g: 1, water: true });
      sfx.splash(ev.big);
    } else if (ev.type === 'finish') {
      for (let i = 0; i < 18; i++) S.particles.push({ x: S.level.finish, y: ev.y + 2.5, vx: (Math.random() - 0.5) * 5, vy: 2 + Math.random() * 4, life: 1.2 + Math.random(), size: 0.1, color: ['#ff7a2f', '#ffd23f', '#3fae5a', '#2a5b82'][i % 4], g: 0.4 });
      sfx.finish();
    }
  }
  function updateParticles(dt) {
    for (const p of S.particles) {
      p.vy += -9.81 * p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.life -= dt;
      if (p.water && p.y < S.level.waterY && p.vy < 0) p.life = 0;
    }
    S.particles = S.particles.filter((p) => p.life > 0);
  }

  /* ---------- rendering ---------- */
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  }

  const SKY_TOP = '#7cc4d6', SKY_BOT = '#e9f2e6';
  const ROCK = '#c98f5a', ROCK_DARK = '#9c6a3f', ROCK_LIGHT = '#dfa771', GRASS = '#6aa84f', GRASS_DARK = '#4f8a3a';
  const WATER_TOP = '#3fa7b5', WATER_DEEP = '#1f6f86';

  // deterministic pseudo random for scenery
  function rand(seed) { const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, SKY_TOP); g.addColorStop(1, SKY_BOT);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // sun
    const [sunX, sunY] = [W * 0.82 - cam.x * 0.5, H * 0.2];
    ctx.fillStyle = 'rgba(255, 244, 214, 0.9)';
    ctx.beginPath(); ctx.arc(sunX, sunY, Math.max(26, H * 0.05), 0, Math.PI * 2); ctx.fill();
    // far mountain ranges (parallax, low poly)
    const ranges = [
      { par: 0.15, base: 0.62, amp: 0.22, col: '#a9cfd0', seed: 3 },
      { par: 0.3, base: 0.7, amp: 0.17, col: '#86b8b3', seed: 9 },
      { par: 0.5, base: 0.78, amp: 0.12, col: '#6aa39a', seed: 17 },
    ];
    for (const r of ranges) {
      ctx.fillStyle = r.col;
      ctx.beginPath();
      const step = 90;
      const off = cam.x * cam.scale * r.par;
      const startI = Math.floor((off - step) / step);
      const [, waterSy] = toScreen(0, S.level.waterY);
      const baseY = Math.min(H * r.base, waterSy + 40);
      ctx.moveTo(-10, H);
      for (let i = startI; i * step - off < W + step; i++) {
        const sx = i * step - off;
        const h = (0.35 + rand(i + r.seed * 101) * 0.65) * r.amp * H;
        ctx.lineTo(sx, baseY - h);
      }
      ctx.lineTo(W + 10, H);
      ctx.closePath(); ctx.fill();
    }
    // clouds
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (let i = 0; i < 6; i++) {
      const speed = 6 + rand(i) * 8;
      const span = W + 400;
      const x = ((rand(i + 50) * span + S.time * speed - cam.x * cam.scale * 0.08) % span + span) % span - 200;
      const y = H * (0.08 + rand(i + 7) * 0.22);
      const s = 0.7 + rand(i + 3) * 0.8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 30 * s, y - 16 * s); ctx.lineTo(x + 62 * s, y - 22 * s); ctx.lineTo(x + 96 * s, y - 10 * s);
      ctx.lineTo(x + 120 * s, y); ctx.closePath(); ctx.fill();
    }
  }

  function drawWater(front) {
    const lv = S.level;
    const [, wy] = toScreen(0, lv.waterY);
    if (wy > H) return;
    const t = S.time;
    if (!front) {
      const g = ctx.createLinearGradient(0, wy, 0, H);
      g.addColorStop(0, WATER_TOP); g.addColorStop(1, WATER_DEEP);
      ctx.fillStyle = g;
      ctx.fillRect(0, wy, W, H - wy);
      return;
    }
    // translucent front layer with waves so sunk things look submerged
    ctx.fillStyle = 'rgba(42, 140, 160, 0.55)';
    ctx.beginPath();
    ctx.moveTo(0, H);
    const amp = Math.max(1.5, cam.scale * 0.06);
    for (let sx = 0; sx <= W + 20; sx += 20) {
      const [wx] = toWorld(sx, 0);
      ctx.lineTo(sx, wy + Math.sin(wx * 1.3 + t * 1.6) * amp);
    }
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(232, 247, 251, 0.7)';
    ctx.lineWidth = Math.max(1, cam.scale * 0.05);
    ctx.beginPath();
    for (let sx = 0; sx <= W + 20; sx += 20) {
      const [wx] = toWorld(sx, 0);
      const y = wy + Math.sin(wx * 1.3 + t * 1.6) * amp;
      if (sx === 0) ctx.moveTo(sx, y); else ctx.lineTo(sx, y);
    }
    ctx.stroke();
  }

  function drawTerrain() {
    for (const poly of S.level.terrain) {
      // body
      const g = ctx.createLinearGradient(0, toScreen(0, 2)[1], 0, toScreen(0, S.level.waterY - 4)[1]);
      g.addColorStop(0, ROCK_LIGHT); g.addColorStop(0.5, ROCK); g.addColorStop(1, ROCK_DARK);
      ctx.fillStyle = g;
      ctx.beginPath();
      poly.forEach(([x, y], i) => { const [sx, sy] = toScreen(x, y); if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy); });
      ctx.closePath(); ctx.fill();
      // facets: strata lines clipped to the rock
      ctx.save(); ctx.clip();
      ctx.strokeStyle = 'rgba(110, 70, 35, 0.22)';
      ctx.lineWidth = Math.max(1, cam.scale * 0.06);
      const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
      const x0 = Math.max(Math.min(...xs), toWorld(-50, 0)[0]), x1 = Math.min(Math.max(...xs), toWorld(W + 50, 0)[0]);
      for (let yy = Math.floor(Math.max(...ys)) - 1; yy > S.level.waterY - 6; yy -= 1.4) {
        ctx.beginPath();
        for (let xx = Math.floor(x0); xx <= x1 + 1; xx += 1.5) {
          const jy = yy + (rand(Math.floor(xx * 7) + Math.floor(yy * 13)) - 0.5) * 0.5;
          const [sx, sy] = toScreen(xx, jy);
          if (xx === Math.floor(x0)) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
      }
      ctx.restore();
      // grass on upward-facing edges
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        if (dx <= 0.01 || Math.abs(dy / dx) > 0.8) continue; // only edges walked left→right on top
        const [ax, ay] = toScreen(a[0], a[1]); const [bx, by] = toScreen(b[0], b[1]);
        const th = Math.max(3, cam.scale * 0.28);
        ctx.fillStyle = GRASS;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(bx, by + th); ctx.lineTo(ax, ay + th * 0.6); ctx.closePath(); ctx.fill();
        ctx.fillStyle = GRASS_DARK;
        ctx.beginPath(); ctx.moveTo(ax, ay + th * 0.6); ctx.lineTo(bx, by + th); ctx.lineTo(bx, by + th * 1.3); ctx.lineTo(ax, ay + th * 0.9); ctx.closePath(); ctx.fill();
      }
    }
  }

  function drawGrid() {
    const b = S.level.bounds;
    const [x0, y0] = toScreen(b.x0, b.y1);
    const [x1, y1] = toScreen(b.x1, b.y0);
    ctx.fillStyle = 'rgba(42, 91, 130, 0.07)';
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    const fine = cam.scale * GRID >= 9;
    ctx.lineWidth = 1;
    for (let gx = Math.ceil(b.x0 / GRID) * GRID; gx <= b.x1 + 1e-6; gx += GRID) {
      const major = Math.abs(gx - Math.round(gx)) < 1e-6;
      if (!major && !fine) continue;
      ctx.strokeStyle = major ? 'rgba(42, 91, 130, 0.22)' : 'rgba(42, 91, 130, 0.09)';
      const [sx] = toScreen(gx, 0);
      ctx.beginPath(); ctx.moveTo(Math.round(sx) + 0.5, y0); ctx.lineTo(Math.round(sx) + 0.5, y1); ctx.stroke();
    }
    for (let gy = Math.ceil(b.y0 / GRID) * GRID; gy <= b.y1 + 1e-6; gy += GRID) {
      const major = Math.abs(gy - Math.round(gy)) < 1e-6;
      if (!major && !fine) continue;
      ctx.strokeStyle = major ? 'rgba(42, 91, 130, 0.22)' : 'rgba(42, 91, 130, 0.09)';
      const [, sy] = toScreen(0, gy);
      ctx.beginPath(); ctx.moveTo(x0, Math.round(sy) + 0.5); ctx.lineTo(x1, Math.round(sy) + 0.5); ctx.stroke();
    }
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = 'rgba(42, 91, 130, 0.55)';
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0);
    ctx.setLineDash([]);
  }

  function stressColor(r) {
    r = Math.max(0, Math.min(1, r));
    // green → yellow → red
    const h = 130 - 130 * r;
    return `hsl(${h}, 80%, ${48 - r * 6}%)`;
  }

  /* Draw one beam between screen points. */
  function drawBeam(ax, ay, bx, by, m, opts = {}) {
    const s = cam.scale;
    const col = opts.color || m.color;
    const alpha = opts.alpha == null ? 1 : opts.alpha;
    ctx.globalAlpha = alpha;
    if (m.drivable) {
      // road slab hangs below the driving line
      let nx = -(by - ay), ny = bx - ax; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
      if (ny < 0) { nx = -nx; ny = -ny; } // screen-down normal
      const th = m.width * s;
      ctx.fillStyle = opts.color ? col : m.color;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(bx + nx * th, by + ny * th); ctx.lineTo(ax + nx * th, ay + ny * th); ctx.closePath(); ctx.fill();
      if (!opts.color) {
        ctx.strokeStyle = m.key === 'reinforced' ? '#8d97a3' : '#7d848d';
        ctx.lineWidth = Math.max(1, s * 0.05);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        if (m.key === 'reinforced') {
          ctx.strokeStyle = '#c9483b'; ctx.lineWidth = Math.max(1, s * 0.05);
          ctx.beginPath(); ctx.moveTo(ax + nx * th * 0.75, ay + ny * th * 0.75); ctx.lineTo(bx + nx * th * 0.75, by + ny * th * 0.75); ctx.stroke();
        }
        ctx.setLineDash([Math.max(2, s * 0.25), Math.max(2, s * 0.25)]);
        ctx.strokeStyle = '#f2c53d'; ctx.lineWidth = Math.max(1, s * 0.035);
        ctx.beginPath(); ctx.moveTo(ax + nx * th * 0.4, ay + ny * th * 0.4); ctx.lineTo(bx + nx * th * 0.4, by + ny * th * 0.4); ctx.stroke();
        ctx.setLineDash([]);
      }
    } else if (m.tensionOnly) {
      ctx.strokeStyle = col; ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1.5, m.width * s);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      if (m.key === 'rope' && !opts.color && s > 18) {
        ctx.strokeStyle = 'rgba(90, 70, 40, 0.5)'; ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
      }
    } else {
      ctx.lineCap = 'round';
      ctx.strokeStyle = opts.color ? 'rgba(0,0,0,0.35)' : (m.key === 'steel' ? '#7f2a22' : '#7a5530');
      ctx.lineWidth = Math.max(3, m.width * s + 2);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(2, m.width * s);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      if (!opts.color && s > 16) {
        ctx.strokeStyle = m.key === 'steel' ? 'rgba(255, 190, 180, 0.55)' : 'rgba(255, 225, 180, 0.55)';
        ctx.lineWidth = Math.max(1, m.width * s * 0.25);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      }
    }
    ctx.lineCap = 'butt';
    ctx.globalAlpha = 1;
  }

  function drawJoint(sx, sy, anchor, highlight) {
    const r = Math.max(3.5, cam.scale * (anchor ? 0.17 : 0.12));
    if (anchor) {
      ctx.fillStyle = '#d23f34';
      ctx.strokeStyle = '#5e1712';
      ctx.lineWidth = Math.max(1.5, r * 0.35);
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fbe3df';
      ctx.beginPath(); ctx.arc(sx, sy, r * 0.35, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = '#f4f1e8';
      ctx.strokeStyle = '#1c2730';
      ctx.lineWidth = Math.max(1.2, r * 0.4);
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    if (highlight) {
      ctx.strokeStyle = highlight;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(sx, sy, r + 5, 0, Math.PI * 2); ctx.stroke();
    }
  }

  function drawBuildDesign() {
    const order = ['rope', 'cable', 'wood', 'steel', 'road', 'reinforced'];
    const sorted = [...S.beams].sort((a, b) => order.indexOf(a.mat) - order.indexOf(b.mat));
    for (const b of sorted) {
      const [ax, ay] = toScreen(b.a.x, b.a.y), [bx, by] = toScreen(b.b.x, b.b.y);
      const m = MATERIALS[b.mat];
      drawBeam(ax, ay, bx, by, m);
      if (b === S.hoverBeam && (S.tool === 'delete' || (S.tool === 'build' && !S.from))) {
        ctx.strokeStyle = S.tool === 'delete' ? 'rgba(210, 63, 52, 0.85)' : 'rgba(255, 255, 255, 0.6)';
        ctx.lineWidth = Math.max(2, m.width * cam.scale * 0.5);
        ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    // preview
    let end = null;
    if (S.from && S.cursor.inside && S.mode === 'build') {
      end = previewEnd(S.from);
      const m = MATERIALS[S.mat];
      const [ax, ay] = toScreen(S.from.x, S.from.y), [bx, by] = toScreen(end.x, end.y);
      drawBeam(ax, ay, bx, by, m, { alpha: 0.6, color: end.valid ? null : '#d23f34' });
      if (!end.existing) drawJoint(bx, by, false, end.valid ? (end.split ? '#ff7a2f' : null) : '#d23f34');
      if (S.from.split) drawJoint(ax, ay, false, '#ff7a2f');
      // max-length circle
      ctx.strokeStyle = 'rgba(28, 39, 48, 0.25)';
      ctx.setLineDash([4, 6]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(ax, ay, m.maxLen * cam.scale, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      // label
      const label = `${end.len.toFixed(2)} m · ${fmt(end.len * m.cost)}`;
      ctx.font = '600 12px "Chakra Petch", system-ui, sans-serif';
      const tw = ctx.measureText(label).width;
      const lx = bx + 14, ly = by - 18;
      ctx.fillStyle = 'rgba(28, 39, 48, 0.85)';
      roundRect(lx - 6, ly - 13, tw + 12, 20, 5); ctx.fill();
      ctx.fillStyle = '#f4f1e8'; ctx.fillText(label, lx, ly + 1);
    }
    for (const p of S.points) {
      const [sx, sy] = toScreen(p.x, p.y);
      let hl = null;
      if (p === S.from) hl = '#ff7a2f';
      else if (end && p === end.existing) hl = end.valid ? '#ff7a2f' : '#d23f34';
      else if (p === S.hoverPoint) hl = S.tool === 'delete' && !p.anchor ? '#d23f34' : S.tool === 'move' && p.anchor ? null : '#2a5b82';
      drawJoint(sx, sy, p.anchor, hl);
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }

  /* pass 'road' draws the deck (vehicles go on top of it); pass 'structure' draws everything else above the vehicles */
  function drawSimBridge(pass) {
    const w = S.world;
    const order = ['rope', 'cable', 'wood', 'steel', 'road', 'reinforced'];
    const road = pass === 'road';
    const beams = w.beams
      .filter((b) => !b.broken && b.mat.drivable === road)
      .sort((a, b) => order.indexOf(a.mat.key) - order.indexOf(b.mat.key));
    for (const b of beams) {
      const A = w.nodes[b.a], B = w.nodes[b.b];
      const [ax, ay] = toScreen(A.x, A.y), [bx, by] = toScreen(B.x, B.y);
      const ratio = Math.abs(b.smooth) / b.mat.strength;
      const color = S.stress && !b.stub ? (b.mat.tensionOnly && b.smooth <= 0 ? '#9aa4ad' : stressColor(ratio)) : null;
      drawBeam(ax, ay, bx, by, b.mat, { color });
    }
    if (road) return;
    const used = new Set();
    for (const b of w.beams) if (!b.broken) { used.add(b.a); used.add(b.b); }
    w.nodes.forEach((n, i) => {
      if (!used.has(i)) return;
      const [sx, sy] = toScreen(n.x, n.y);
      drawJoint(sx, sy, n.fixed, null);
    });
  }

  /* ---------- vehicles ----------
   * Drawn in the vehicle's own frame, in metres: origin at the rear wheel centre,
   * +x toward the front wheel, +y up. drawVehicle() sets up the canvas transform.
   */
  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const t = f < 0 ? 0 : 255, k = Math.abs(f);
    r = Math.round(r + (t - r) * k); g = Math.round(g + (t - g) * k); b = Math.round(b + (t - b) * k);
    return `rgb(${r}, ${g}, ${b})`;
  }

  function vehiclePainter() {
    const px = 1 / cam.scale;                      // one screen pixel in metres
    const OUT = 'rgba(18, 26, 34, 0.7)';
    const lw = (p) => Math.max(1, p * cam.scale) * px; // a line p metres wide, at least 1px
    const path = (pts) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
    const fill = (pts, style, stroke = true) => {
      path(pts); ctx.fillStyle = style; ctx.fill();
      if (stroke) { ctx.strokeStyle = OUT; ctx.lineWidth = lw(0.035); ctx.lineJoin = 'round'; ctx.stroke(); }
    };
    const rect = (x, y, w, h, style, stroke = false) => fill([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], style, stroke);
    const vgrad = (y0, y1, top, bottom) => { const g = ctx.createLinearGradient(0, y1, 0, y0); g.addColorStop(0, top); g.addColorStop(1, bottom); return g; };
    const paint = (pts, color, y0, y1) => fill(pts, vgrad(y0, y1, shade(color, 0.22), shade(color, -0.2)));
    const line = (pts, color, w) => {
      ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.strokeStyle = color; ctx.lineWidth = lw(w); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(); ctx.lineCap = 'butt';
    };
    const circle = (x, y, r, style, stroke = false) => {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = style; ctx.fill();
      if (stroke) { ctx.strokeStyle = OUT; ctx.lineWidth = lw(0.03); ctx.stroke(); }
    };
    // tinted glass with a soft reflection streak
    const glass = (pts) => {
      const ys = pts.map((p) => p[1]), xs = pts.map((p) => p[0]);
      const y0 = Math.min(...ys), y1 = Math.max(...ys), x0 = Math.min(...xs), x1 = Math.max(...xs);
      fill(pts, vgrad(y0, y1, '#d9f0f7', '#7fb3c6'), false);
      ctx.save(); path(pts); ctx.clip();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
      const w = (x1 - x0) * 0.18, cx = x0 + (x1 - x0) * 0.35;
      path([[cx, y1 + 0.1], [cx + w, y1 + 0.1], [cx + w - (y1 - y0) * 0.6, y0 - 0.1], [cx - (y1 - y0) * 0.6, y0 - 0.1]]); ctx.fill();
      ctx.restore();
      path(pts); ctx.strokeStyle = 'rgba(18, 26, 34, 0.55)'; ctx.lineWidth = lw(0.025); ctx.stroke();
    };
    const headlight = (x, y, w, h) => { fill([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], '#fff4c2', false); circle(x + w * 0.5, y + h * 0.5, Math.min(w, h) * 0.32, '#ffffff'); };
    const taillight = (x, y, w, h) => fill([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], '#e2463a', false);
    const bumper = (x, y, w, h) => rect(x, y, w, h, vgrad(y, y + h, '#9aa3ab', '#4d555d'), true);
    const handle = (x, y) => rect(x, y, 0.16, 0.045, 'rgba(18, 26, 34, 0.55)');
    const seam = (x, y0, y1) => line([[x, y0], [x, y1]], 'rgba(18, 26, 34, 0.45)', 0.025);
    // dark wheel well cut into the body
    const arches = (body, xs, r) => {
      ctx.save(); path(body); ctx.clip();
      for (const x of xs) circle(x, 0, r * 1.13, '#151a1f');
      ctx.restore();
    };
    const wheel = (x, r, ang, chunky) => {
      ctx.save(); ctx.translate(x, 0);
      circle(0, 0, r, '#1b2025');
      if (chunky) {
        // tread blocks around a knobbly tyre
        ctx.fillStyle = '#1b2025';
        for (let i = 0; i < 14; i++) {
          const a = ang + (i / 14) * Math.PI * 2;
          ctx.save(); ctx.rotate(a); ctx.fillRect(r * 0.9, -r * 0.1, r * 0.16, r * 0.2); ctx.restore();
        }
      }
      ctx.beginPath(); ctx.arc(0, 0, r * 0.84, 0, Math.PI * 2); ctx.strokeStyle = '#353d45'; ctx.lineWidth = lw(r * 0.07); ctx.stroke();
      const rim = r * (chunky ? 0.5 : 0.56);
      const g = ctx.createRadialGradient(-rim * 0.3, rim * 0.3, rim * 0.1, 0, 0, rim);
      g.addColorStop(0, '#f2f5f7'); g.addColorStop(1, '#8f99a2');
      circle(0, 0, rim, g);
      ctx.strokeStyle = '#6c757d'; ctx.lineWidth = lw(rim * 0.12);
      ctx.beginPath();
      for (let i = 0; i < 5; i++) { const a = ang + (i / 5) * Math.PI * 2; ctx.moveTo(Math.cos(a) * rim * 0.25, Math.sin(a) * rim * 0.25); ctx.lineTo(Math.cos(a) * rim * 0.92, Math.sin(a) * rim * 0.92); }
      ctx.stroke();
      circle(0, 0, rim * 0.28, '#4a535b');
      ctx.restore();
    };
    return { px, lw, path, fill, rect, vgrad, paint, line, circle, glass, headlight, taillight, bumper, handle, seam, arches, wheel, OUT };
  }

  const VEHICLE_ART = {
    car(p, d, wb, r, a) {
      const body = [[-0.8, -0.02], [wb + 0.86, -0.02], [wb + 0.93, 0.28], [wb + 0.84, 0.5], [wb + 0.2, 0.62], [wb - 0.38, 1.08], [0.22, 1.08], [-0.36, 0.64], [-0.74, 0.58], [-0.84, 0.3]];
      p.paint(body, d.color, -0.02, 1.08);
      p.rect(-0.8, -0.02, wb + 1.66, 0.13, 'rgba(18, 26, 34, 0.28)');
      p.arches(body, [0, wb], r);
      p.glass([[0.95, 0.99], [0.3, 0.99], [-0.12, 0.67], [0.95, 0.67]]);
      p.glass([[wb - 0.45, 0.99], [1.07, 0.99], [1.07, 0.67], [wb + 0.08, 0.67]]);
      p.seam(1.01, 0.12, 1.03); p.seam(wb - 0.05, 0.12, 0.64);
      p.handle(0.7, 0.5); p.handle(wb - 0.38, 0.5);
      p.line([[0.25, 1.06], [wb - 0.4, 1.06]], 'rgba(255, 255, 255, 0.35)', 0.03);
      p.headlight(wb + 0.78, 0.32, 0.13, 0.12); p.taillight(-0.84, 0.34, 0.1, 0.13);
      p.bumper(-0.88, -0.03, 0.26, 0.15); p.bumper(wb + 0.7, -0.03, 0.27, 0.15);
      p.wheel(0, r, a[0]); p.wheel(wb, r, a[1]);
    },
    van(p, d, wb, r, a) {
      const body = [[-0.84, -0.02], [wb + 0.88, -0.02], [wb + 0.93, 0.6], [wb + 0.6, 0.8], [wb + 0.25, 1.46], [wb + 0.05, 1.5], [-0.78, 1.5], [-0.84, 1.42]];
      p.paint(body, d.color, -0.02, 1.5);
      p.rect(-0.84, 0.42, wb + 1.74, 0.12, shade(d.color, -0.35));
      p.arches(body, [0, wb], r);
      p.glass([[-0.62, 1.36], [0.42, 1.36], [0.42, 0.88], [-0.62, 0.88]]);
      p.glass([[0.62, 1.36], [1.7, 1.36], [1.7, 0.88], [0.62, 0.88]]);
      p.glass([[wb + 0.18, 1.38], [wb - 0.12, 1.38], [wb - 0.12, 0.86], [wb + 0.52, 0.86]]);
      p.seam(0.52, 0.1, 1.44); p.seam(1.8, 0.1, 1.44); p.seam(wb - 0.2, 0.1, 1.44);
      p.line([[0.55, 1.42], [1.78, 1.42]], 'rgba(18, 26, 34, 0.5)', 0.03);
      p.handle(1.55, 0.68); p.handle(wb - 0.05, 0.68);
      p.line([[-0.6, 1.56], [wb - 0.1, 1.56]], '#5b646c', 0.05);
      p.headlight(wb + 0.8, 0.56, 0.12, 0.14); p.taillight(-0.86, 0.6, 0.08, 0.3);
      p.bumper(-0.92, -0.03, 0.26, 0.16); p.bumper(wb + 0.72, -0.03, 0.27, 0.16);
      p.wheel(0, r, a[0]); p.wheel(wb, r, a[1]);
    },
    truck(p, d, wb, r, a) {
      p.rect(-1.05, -0.08, wb + 1.95, 0.2, '#2a3036', true);
      const box = [[-1.08, 0.12], [wb - 0.72, 0.12], [wb - 0.72, 2.08], [-1.08, 2.08]];
      p.fill(box, p.vgrad(0.12, 2.08, '#f4f0e4', '#cfc8b4'));
      for (let x = -0.88; x < wb - 0.8; x += 0.36) p.seam(x, 0.2, 2.0);
      p.rect(-1.08, 1.92, wb + 0.36, 0.16, '#bdb5a0');
      p.rect(-0.7, 0.85, 2.2, 0.42, d.color);
      const cab = [[wb - 0.64, -0.05], [wb + 1.02, -0.05], [wb + 1.06, 0.95], [wb + 0.8, 1.82], [wb - 0.64, 1.86]];
      p.paint(cab, d.color, -0.05, 1.86);
      p.arches(cab, [wb], r);
      p.glass([[wb + 0.7, 1.7], [wb - 0.06, 1.7], [wb - 0.06, 1.1], [wb + 0.94, 1.1]]);
      p.seam(wb - 0.12, 0.1, 1.8); p.handle(wb - 0.02, 0.92);
      for (let y = 0.3; y < 0.8; y += 0.12) p.line([[wb + 0.9, y], [wb + 1.03, y]], 'rgba(18, 26, 34, 0.55)', 0.03);
      p.rect(wb - 0.74, 1.3, 0.1, 1.0, p.vgrad(1.3, 2.3, '#c7ced4', '#7b858e'), true);
      p.headlight(wb + 0.92, 0.9, 0.13, 0.13); p.taillight(-1.1, 0.25, 0.08, 0.22);
      p.bumper(wb + 0.8, -0.06, 0.3, 0.18);
      p.wheel(0, r, a[0]); p.wheel(wb, r, a[1]);
    },
    bus(p, d, wb, r, a) {
      const body = [[-1.02, -0.02], [wb + 1.0, -0.02], [wb + 1.07, 1.76], [wb + 0.94, 1.97], [-0.94, 1.97], [-1.04, 1.82]];
      p.paint(body, d.color, -0.02, 1.97);
      p.rect(-1.03, 0.52, wb + 2.08, 0.16, '#f4f1e8');
      p.arches(body, [0, wb], r);
      p.rect(-0.88, 1.0, wb + 1.2, 0.78, '#1f2a33');
      for (let x = -0.82; x < wb + 0.2; x += 0.78) p.glass([[x, 1.72], [x + 0.66, 1.72], [x + 0.66, 1.06], [x, 1.06]]);
      p.glass([[wb + 0.98, 1.74], [wb + 0.42, 1.74], [wb + 0.42, 0.78], [wb + 1.03, 0.78]]);
      p.rect(wb - 0.3, 0.06, 0.62, 1.72, '#1f2a33');
      p.glass([[wb - 0.26, 1.7], [wb - 0.02, 1.7], [wb - 0.02, 0.12], [wb - 0.26, 0.12]]);
      p.glass([[wb + 0.04, 1.7], [wb + 0.28, 1.7], [wb + 0.28, 0.12], [wb + 0.04, 0.12]]);
      p.rect(wb + 0.36, 1.8, 0.62, 0.13, '#ffb43a');
      p.headlight(wb + 0.9, 0.3, 0.14, 0.14); p.taillight(-1.06, 0.3, 0.08, 0.3);
      p.bumper(-1.1, -0.04, 0.24, 0.16); p.bumper(wb + 0.86, -0.04, 0.26, 0.16);
      p.wheel(0, r, a[0]); p.wheel(wb, r, a[1]);
    },
    bike(p, d, wb, r, a) {
      p.wheel(0, r, a[0]); p.wheel(wb, r, a[1]);
      p.line([[-0.1, 0.32], [0.75, 0.22]], '#9aa3ab', 0.07);                       // exhaust
      p.line([[0, 0], [0.5, 0.55], [wb - 0.22, 0.7], [wb, 0]], '#38414a', 0.06);    // frame + fork
      p.rect(0.42, 0.14, 0.5, 0.36, p.vgrad(0.14, 0.5, '#8d969e', '#4f5860'), true); // engine
      p.paint([[0.5, 0.56], [1.05, 0.56], [1.16, 0.74], [0.95, 0.84], [0.62, 0.8]], d.color, 0.56, 0.84); // tank
      p.fill([[0.1, 0.62], [0.58, 0.62], [0.6, 0.72], [0.16, 0.74]], '#1f252b');  // seat
      p.paint([[wb - 0.12, 0.62], [wb + 0.14, 0.52], [wb + 0.1, 0.86], [wb - 0.1, 0.88]], d.color, 0.52, 0.88); // fairing
      p.headlight(wb + 0.08, 0.6, 0.07, 0.1);
      p.line([[0.4, 0.74], [0.84, 0.62], [0.76, 0.24]], '#2c3e58', 0.16);           // leg
      p.fill([[0.22, 0.68], [0.7, 0.64], [1.04, 1.16], [0.95, 1.33], [0.58, 1.38]], p.vgrad(0.64, 1.38, '#3d4c5a', '#222c35')); // jacket
      p.line([[0.88, 1.22], [wb - 0.2, 0.84]], '#2b3640', 0.12);                     // arm
      p.circle(0.9, 1.47, 0.2, p.vgrad(1.27, 1.67, '#ffd45e', '#e09a12'), true);    // helmet
      p.fill([[0.96, 1.42], [1.1, 1.44], [1.08, 1.55], [0.98, 1.56]], '#1f2a33', false); // visor
    },
    pickup(p, d, wb, r, a) {
      const body = [[-0.9, -0.02], [wb + 0.9, -0.02], [wb + 0.97, 0.48], [wb + 0.42, 0.64], [wb - 0.14, 1.26], [wb - 1.1, 1.26], [wb - 1.2, 0.68], [-0.9, 0.68]];
      p.paint(body, d.color, -0.02, 1.26);
      p.rect(-0.9, -0.02, wb + 1.8, 0.12, 'rgba(18, 26, 34, 0.28)');
      p.arches(body, [0, wb], r);
      p.line([[-0.9, 0.66], [wb - 1.2, 0.66]], shade(d.color, -0.45), 0.06);
      p.seam(-0.72, 0.1, 0.64); p.seam(wb - 1.2, 0.1, 1.2);
      p.glass([[wb - 0.22, 1.15], [wb - 1.02, 1.15], [wb - 1.08, 0.74], [wb + 0.18, 0.74]]);
      p.seam(wb - 0.5, 0.74, 1.15);
      p.handle(wb - 0.95, 0.52);
      p.headlight(wb + 0.84, 0.3, 0.13, 0.13); p.taillight(-0.92, 0.36, 0.08, 0.22);
      p.bumper(-0.98, -0.03, 0.26, 0.15); p.bumper(wb + 0.74, -0.03, 0.27, 0.15);
      p.wheel(0, r, a[0]); p.wheel(wb, r, a[1]);
    },
    monster(p, d, wb, r, a) {
      p.rect(-0.35, -0.12, wb + 0.7, 0.36, '#262c32', true);
      for (const x of [0, wb]) { // coil-over shocks
        const pts = []; for (let i = 0; i <= 8; i++) pts.push([x + 0.18 + (i % 2 ? 0.1 : -0.1), 0.1 + i * 0.07]);
        p.line(pts, '#ffcf3a', 0.04); p.line([[x, 0], [x + 0.18, 0.72]], '#9aa3ab', 0.05);
      }
      const body = [[-0.92, 0.42], [wb + 0.95, 0.42], [wb + 1.02, 0.88], [wb + 0.38, 0.98], [wb - 0.1, 1.55], [0.3, 1.55], [-0.2, 1.0], [-0.92, 0.95]];
      p.paint(body, d.color, 0.42, 1.55);
      // flame decal
      p.fill([[-0.85, 0.5], [0.4, 0.5], [0.15, 0.62], [0.7, 0.66], [0.35, 0.76], [1.05, 0.8], [0.4, 0.86], [-0.85, 0.86]], '#ffb43a', false);
      p.fill([[-0.85, 0.56], [0.1, 0.56], [-0.05, 0.64], [0.4, 0.68], [-0.85, 0.76]], '#ff6a3a', false);
      p.glass([[wb - 0.2, 1.44], [0.38, 1.44], [0.05, 1.04], [wb + 0.16, 1.04]]);
      p.seam(1.25, 0.5, 1.5); p.handle(1.0, 0.86);
      for (const x of [0.5, 0.9, 1.3]) p.circle(x, 1.63, 0.08, '#fff4c2', true);
      p.headlight(wb + 0.9, 0.62, 0.13, 0.12); p.taillight(-0.94, 0.62, 0.08, 0.16);
      p.wheel(0, r, a[0], true); p.wheel(wb, r, a[1], true);
    },
    tanker(p, d, wb, r, a) {
      p.rect(-1.1, -0.08, wb + 2.0, 0.22, '#2a3036', true);
      const tank = [[-1.12, 0.55], [-0.98, 0.32], [wb - 0.96, 0.32], [wb - 0.82, 0.55], [wb - 0.82, 1.78], [wb - 0.96, 2.02], [-0.98, 2.02], [-1.12, 1.78]];
      const g = ctx.createLinearGradient(0, 2.02, 0, 0.32);
      g.addColorStop(0, '#d9dee2'); g.addColorStop(0.35, '#ffffff'); g.addColorStop(0.7, '#b9c1c8'); g.addColorStop(1, '#7f8a93');
      p.fill(tank, g);
      for (let x = -0.5; x < wb - 1.0; x += 1.1) p.line([[x, 0.36], [x, 1.98]], 'rgba(60, 70, 80, 0.35)', 0.04);
      p.rect(-1.12, 1.05, wb + 0.3, 0.18, d.color);
      const cx = (wb - 1.9) / 2;
      p.fill([[cx, 1.38], [cx + 0.26, 1.64], [cx, 1.9], [cx - 0.26, 1.64]], '#ff9a2a');
      p.line([[cx - 0.12, 1.64], [cx + 0.12, 1.64]], '#1f2a33', 0.04);
      for (let y = 0.45; y < 2.0; y += 0.2) p.line([[-1.2, y], [-1.05, y]], '#7b858e', 0.03);
      p.line([[-1.2, 0.35], [-1.2, 2.0]], '#7b858e', 0.035);
      const cab = [[wb - 0.62, -0.05], [wb + 1.05, -0.05], [wb + 1.08, 1.0], [wb + 0.8, 1.82], [wb - 0.62, 1.86]];
      p.paint(cab, d.color, -0.05, 1.86);
      p.arches(cab, [wb], r);
      p.glass([[wb + 0.7, 1.7], [wb - 0.05, 1.7], [wb - 0.05, 1.1], [wb + 0.95, 1.1]]);
      p.seam(wb - 0.1, 0.1, 1.8); p.handle(wb, 0.92);
      for (let y = 0.3; y < 0.8; y += 0.12) p.line([[wb + 0.92, y], [wb + 1.05, y]], 'rgba(18, 26, 34, 0.55)', 0.03);
      p.rect(wb - 0.74, 1.3, 0.1, 1.05, p.vgrad(1.3, 2.35, '#c7ced4', '#7b858e'), true);
      p.headlight(wb + 0.94, 0.9, 0.13, 0.13); p.taillight(-1.14, 0.12, 0.1, 0.16);
      p.bumper(wb + 0.82, -0.06, 0.3, 0.18);
      p.wheel(0, r, a[0]); p.wheel(wb, r, a[1]);
    },
  };

  function drawVehicle(v) {
    const r0 = v.parts[0], r1 = v.parts[1];
    const [sx, sy] = toScreen(r0.x, r0.y);
    const ang = Math.atan2(r1.y - r0.y, r1.x - r0.x);
    const art = VEHICLE_ART[v.def.key] || VEHICLE_ART.car;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(cam.scale, -cam.scale); // metres, y up
    ctx.rotate(ang);
    art(vehiclePainter(), v.def, v.def.wheelbase, v.def.wheelR, v.wheelAngle);
    ctx.restore();
  }

  function drawFlag() {
    const lv = S.level;
    const x = lv.finish;
    // find ground height under the flag
    let gy = 0;
    for (const poly of lv.terrain) for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if (Math.abs(b[0] - a[0]) < 1e-9 || x < Math.min(a[0], b[0]) || x > Math.max(a[0], b[0])) continue;
      gy = Math.max(gy, a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]));
    }
    const [bx, by] = toScreen(x, gy), [tx, ty] = toScreen(x, gy + 3.2);
    ctx.strokeStyle = '#1c2730'; ctx.lineWidth = Math.max(2, cam.scale * 0.08);
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
    const fw = 1.3 * cam.scale, fh = 0.85 * cam.scale;
    const wave = Math.sin(S.time * 4) * fh * 0.08;
    const cols = 4, rows = 3;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      ctx.fillStyle = (i + j) % 2 ? '#1c2730' : '#f4f1e8';
      const x0 = tx + (fw / cols) * i, y0 = ty + (fh / rows) * j + wave * (i / cols);
      ctx.fillRect(x0, y0, fw / cols + 0.5, fh / rows + 0.5);
    }
  }

  function drawParticles() {
    for (const p of S.particles) {
      const [sx, sy] = toScreen(p.x, p.y);
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
      ctx.fillStyle = p.color;
      const s = Math.max(2, p.size * cam.scale);
      ctx.fillRect(sx - s / 2, sy - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
  }

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawBackground();
    drawWater(false);
    if (S.mode === 'build') drawGrid();
    drawTerrain();
    drawFlag();
    if (S.mode === 'build') {
      drawBuildDesign();
    } else if (S.world) {
      drawSimBridge('road');
      for (const v of S.world.vehicles) if (v.active || v.sunk) drawVehicle(v);
      drawSimBridge('structure');
    }
    drawParticles();
    drawWater(true);
  }

  /* ---------- main loop ---------- */
  let last = performance.now();
  let simAcc = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    S.time += dt;
    if (S.mode === 'sim' && S.world) {
      simAcc += dt * (S.slow ? 0.25 : 1);
      let steps = 0;
      while (simAcc >= STEP && steps < 6) { S.world.step(STEP); simAcc -= STEP; steps++; }
      if (steps >= 6) simAcc = 0;
      for (const ev of S.world.events) emit(ev);
      S.world.events.length = 0;
      updateParticles(dt * (S.slow ? 0.25 : 1));
      updateSimStatus();
      if (S.world.status !== 'running' && !S.resultShown) {
        S.resultShown = true;
        const w = S.world;
        setTimeout(() => { if (S.world === w && S.mode === 'sim') showResult(); }, w.status === 'won' ? 900 : 1700);
      }
    }
    render();
    requestAnimationFrame(frame);
  }

  /* ---------- boot ---------- */
  function boot(saved) {
    buildMaterialButtons();
    resize();
    window.addEventListener('resize', () => { resize(); });
    let start = Math.min(LEVELS.length - 1, Math.max(0, store.get('lastLevel', 0) | 0));
    let design = null;
    // shared design in the URL hash
    if (location.hash.length > 8) {
      try { const d = decodeDesign(location.hash.slice(1)); const i = LEVELS.findIndex((l) => l.id === d.l); if (i >= 0) { start = i; design = d; } } catch (e) { /* not a design */ }
    }
    if (saved && typeof saved.levelIndex === 'number' && LEVELS[saved.levelIndex]) { start = saved.levelIndex; design = saved.design || design; S.started = true; }
    loadLevel(start, design);
    if (design && !saved) toast('Loaded a shared design. Press Test to run it.');
    if (!saved && !design) { toggleMenu(true); hideToast(); }
    S.started = S.started || !!design;
    requestAnimationFrame(frame);
  }

  // keep the player's work across live updates of a hosted page
  try { window.claude && window.claude.hot && window.claude.hot.snapshot(() => ({ levelIndex: S.levelIndex, design: serialize() })); } catch (e) { /* not hosted */ }
  const hot = window.claude && window.claude.hot;
  if (hot && hot.ready) hot.ready(boot); else boot(hot && hot.data ? hot.data : null);

  // tiny debug/test handle
  window.Bridgewright = { state: S, loadLevel, startSim, stopSim, worldDesign, encodeDesign, decodeDesign, cam, drawVehicle };
})();
