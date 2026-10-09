/*
 * Bridgewright physics.
 *
 * A position-based (XPBD, "small steps") solver: every beam is a distance
 * constraint between two pin joints, vehicles are tiny rigid particle frames
 * whose wheels collide with road beams and terrain, and beams break once the
 * axial force they carry exceeds their material's strength.
 *
 * World units: metres, kilograms, seconds. +y is up.
 * Works in the browser (window.BW) and in Node (module.exports) for tests.
 */
(function (root) {
  'use strict';

  const G = -9.81;

  const MATERIALS = {
    road:       { key: 'road',       name: 'Road',            cost: 200, maxLen: 2,  density: 60, ea: 4.0e7, strength: 40000, drivable: true,  tensionOnly: false, color: '#4b5058', width: 0.34 },
    reinforced: { key: 'reinforced', name: 'Reinforced Road', short: 'Reinforced', cost: 380, maxLen: 2,  density: 90, ea: 8.0e7, strength: 80000, drivable: true,  tensionOnly: false, color: '#2f3640', width: 0.40 },
    wood:       { key: 'wood',       name: 'Wood',            cost: 150, maxLen: 2,  density: 20,  ea: 2.5e7, strength: 38000, drivable: false, tensionOnly: false, color: '#c08a4e', width: 0.22 },
    steel:      { key: 'steel',      name: 'Steel',           cost: 420, maxLen: 4,  density: 40,  ea: 1.6e8, strength: 95000, drivable: false, tensionOnly: false, color: '#c9483b', width: 0.24 },
    rope:       { key: 'rope',       name: 'Rope',            cost: 120, maxLen: 10, density: 4,   ea: 4.0e7, strength: 32000, drivable: false, tensionOnly: true,  color: '#b9a074', width: 0.09 },
    cable:      { key: 'cable',      name: 'Steel Cable', short: 'Cable',     cost: 300, maxLen: 10, density: 8,  ea: 1.6e8, strength: 90000, drivable: false, tensionOnly: true,  color: '#30343a', width: 0.11 },
  };
  const MATERIAL_ORDER = ['road', 'reinforced', 'wood', 'steel', 'rope', 'cable'];

  const VEHICLES = {
    car:   { key: 'car',   name: 'Car',   mass: 1000, wheelbase: 2.2, wheelR: 0.38, bodyH: 0.75, speed: 6.0, color: '#3a8fd9' },
    van:   { key: 'van',   name: 'Van',   mass: 1800, wheelbase: 2.6, wheelR: 0.42, bodyH: 1.15, speed: 5.0, color: '#f2b631' },
    truck: { key: 'truck', name: 'Truck', mass: 3200, wheelbase: 3.4, wheelR: 0.5,  bodyH: 1.4,  speed: 4.2, color: '#e0603a' },
    bus:   { key: 'bus',   name: 'Bus',   mass: 4200, wheelbase: 5.0, wheelR: 0.5,  bodyH: 1.6,  speed: 4.0, color: '#7a5bd6' },
  };

  const SUBSTEPS = 24;
  const FRICTION = 0.9;
  const NODE_DAMPING = 0.6;   // per second, linear velocity damping on joints
  const ROAD_SKIN = 0;   // collision thickness above a road beam's line (the slab is drawn below it)
  const BEAM_DAMPING = 0.6;  // damping ratio of each beam's axial vibration
  const RESTITUTION = 0.05;
  const SETTLE_TIME = 0.8;  // seconds before gravity is at full strength
  const FORCE_SMOOTH = 0.12;  // EMA factor per substep for the force used to break beams

  /* ---------- small geometry helpers ---------- */

  function closestT(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    if (l2 < 1e-12) return 0;
    let t = ((px - ax) * dx + (py - ay) * dy) / l2;
    return t < 0 ? 0 : t > 1 ? 1 : t;
  }

  function pointInPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function terrainSegments(level) {
    const segs = [];
    for (const poly of level.terrain) {
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        segs.push({ ax: a[0], ay: a[1], bx: b[0], by: b[1],
          minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]),
          minY: Math.min(a[1], b[1]), maxY: Math.max(a[1], b[1]) });
      }
    }
    return segs;
  }

  /* Height of the terrain's top surface at x (used to place vehicles). */
  function surfaceY(level, x) {
    let best = -Infinity;
    for (const poly of level.terrain) {
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        if (Math.abs(b[0] - a[0]) < 1e-9) continue;
        if (x < Math.min(a[0], b[0]) || x > Math.max(a[0], b[0])) continue;
        const y = a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
        if (y > best) best = y;
      }
    }
    return best === -Infinity ? 0 : best;
  }

  function designCost(design) {
    let c = 0;
    for (const b of design.beams) {
      const p = design.points[b[0]], q = design.points[b[1]];
      c += Math.hypot(q[0] - p[0], q[1] - p[1]) * MATERIALS[b[2]].cost;
    }
    return Math.round(c);
  }

  /* ---------- the world ---------- */

  class World {
    /**
     * level: level definition (see levels.js)
     * design: { points: [[x,y],...] (anchors first, in level order), beams: [[i,j,mat],...] }
     */
    constructor(level, design) {
      this.level = level;
      this.time = 0;
      this.nodes = [];
      this.beams = [];
      this.vehicles = [];
      this.events = [];       // {type:'break'|'splash'|'finish', x, y}
      this.terrain = terrainSegments(level);
      this.waterY = level.waterY;
      this.finishX = level.finish;
      this.status = 'running'; // running | won | failed
      this.failReason = '';

      const nAnchors = level.anchors.length;
      for (let i = 0; i < design.points.length; i++) {
        const p = design.points[i];
        this.nodes.push({ x: p[0], y: p[1], px: p[0], py: p[1], mass: 0, w: 0, fixed: i < nAnchors, frozen: false });
      }
      for (const [a, b, mk] of design.beams) {
        const m = MATERIALS[mk];
        const na = this.nodes[a], nb = this.nodes[b];
        const len = Math.hypot(nb.x - na.x, nb.y - na.y);
        if (len < 1e-4) continue;
        this._addBeam(a, b, m, len, false);
        const half = (m.density * len) / 2;
        na.mass += half; nb.mass += half;
      }
      for (const n of this.nodes) n.w = n.fixed || n.mass <= 0 ? 0 : 1 / n.mass;
      for (const b of this.beams) this._setDamping(b);

      this.spawnQueue = level.vehicles.map((v, i) => ({ type: v.type, at: v.delay != null ? v.delay : i * 2.5 }));
      this.vehiclesTotal = this.spawnQueue.length;
      this.vehiclesDone = 0;
      this.timeLimit = level.timeLimit || (25 + this.spawnQueue.reduce((m, s) => Math.max(m, s.at), 0));
    }

    _addBeam(a, b, m, len, stub) {
      const beam = { a, b, mat: m, len, alpha: len / m.ea, damp: 0, force: 0, smooth: 0, broken: false, stub };
      this.beams.push(beam);
      return beam;
    }

    /* damping coefficient c = 2·ζ·sqrt(k·m) for the beam's axial vibration mode */
    _setDamping(b) {
      const A = this.nodes[b.a], B = this.nodes[b.b];
      const w = A.w + B.w;
      if (w <= 0) { b.damp = 0; return; }
      const k = b.mat.ea / b.len;
      b.damp = 2 * BEAM_DAMPING * Math.sqrt(k / w);
    }

    _spawn(type) {
      const def = VEHICLES[type];
      const x0 = this.level.start;
      const y0 = surfaceY(this.level, x0);
      const r = def.wheelR, wb = def.wheelbase, h = def.bodyH;
      const mk = (x, y, mass, rad, wheel) => ({ x, y, px: x, py: y, w: 1 / mass, r: rad, wheel });
      const yw = y0 + r + 0.02;
      const parts = [
        mk(x0 - wb, yw, def.mass * 0.32, r, true),        // rear wheel
        mk(x0, yw, def.mass * 0.32, r, true),             // front wheel
        mk(x0 - wb - 0.2, yw + h, def.mass * 0.18, 0.18, false),
        mk(x0 + 0.2, yw + h, def.mass * 0.18, 0.18, false),
      ];
      const links = [];
      const link = (i, j) => links.push({ i, j, len: Math.hypot(parts[i].x - parts[j].x, parts[i].y - parts[j].y) });
      link(0, 1); link(2, 3); link(0, 2); link(1, 3); link(0, 3); link(1, 2);
      // give the vehicle its cruising speed so traffic flows
      for (const p of parts) p.px = p.x - def.speed * 0.5 / (60 * SUBSTEPS);
      const v = { def, parts, links, active: true, finished: false, sunk: false, wheelAngle: [0, 0], id: this.vehicles.length };
      this.vehicles.push(v);
    }

    /* Advance the simulation by dt seconds. */
    step(dt) {
      const n = SUBSTEPS;
      const h = dt / n;
      const before = this.vehicles.map((v) => [v.parts[0].x, v.parts[0].y, v.parts[1].x, v.parts[1].y]);
      for (let s = 0; s < n; s++) { this._substep(h); this.time += h; }
      for (let vi = 0; vi < this.vehicles.length; vi++) {
        const v = this.vehicles[vi];
        if (!v.active) continue;
        const front = v.parts[1];
        const prev = before[vi];
        if (prev) {
          for (let k = 0; k < 2; k++) {
            const p = v.parts[k];
            const dx = p.x - prev[k * 2], dy = p.y - prev[k * 2 + 1];
            const dir = dx >= 0 ? 1 : -1;
            v.wheelAngle[k] -= (dir * Math.hypot(dx, dy)) / p.r;
          }
        }
        if (!v.finished && front.x > this.finishX) {
          v.finished = true;
          this.vehiclesDone++;
          this.events.push({ type: 'finish', x: front.x, y: front.y });
        }
        if (front.x > this.finishX + 18) v.active = false; // drove off into the distance
        if (!v.sunk && v.parts.some((p) => p.y < this.waterY - 0.3)) {
          v.sunk = true;
          const c = v.parts[0];
          this.events.push({ type: 'splash', x: c.x, y: this.waterY, big: true });
          if (!v.finished && this.status === 'running') { this.status = 'failed'; this.failReason = `The ${v.def.name.toLowerCase()} fell into the water.`; }
        }
        if (v.parts.some((p) => p.y < this.waterY - 25)) v.active = false;
      }
      if (this.status === 'running') {
        if (this.vehiclesDone === this.vehiclesTotal) this.status = 'won';
        else if (this.time > this.timeLimit) { this.status = 'failed'; this.failReason = 'Not every vehicle reached the flag in time.'; }
      }
    }

    _substep(h) {
      const h2 = h * h;
      // spawn
      while (this.spawnQueue.length && this.spawnQueue[0].at <= this.time) this._spawn(this.spawnQueue.shift().type);

      // integrate joints; gravity eases in over the settle period so the
      // bridge takes its own weight without a dynamic shock
      const settle = Math.min(1, this.time / SETTLE_TIME);
      const gs = settle * settle * (3 - 2 * settle);
      const damp = 1 - (NODE_DAMPING + (1 - settle) * 12) * h;
      for (const p of this.nodes) {
        if (p.w === 0 || p.frozen) continue;
        const vx = (p.x - p.px) * damp, vy = (p.y - p.py) * damp;
        p.px = p.x; p.py = p.y;
        p.x += vx; p.y += vy + G * gs * h2;
        if (p.y < this.waterY - 40) { p.frozen = true; }
      }
      // integrate vehicles
      for (const v of this.vehicles) {
        if (!v.active) continue;
        for (const p of v.parts) {
          const vx = (p.x - p.px), vy = (p.y - p.py);
          p.px = p.x; p.py = p.y;
          const drag = p.y < this.waterY ? 0.97 : 1; // water slows sinking cars
          p.x += vx * drag; p.y += vy * drag + G * h2 * (p.y < this.waterY ? 0.35 : 1);
        }
      }

      // beams (XPBD distance constraints, one iteration per substep)
      const nodes = this.nodes;
      for (const b of this.beams) {
        if (b.broken) continue;
        const A = nodes[b.a], B = nodes[b.b];
        const wa = A.frozen ? 0 : A.w, wb = B.frozen ? 0 : B.w;
        const dx = A.x - B.x, dy = A.y - B.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 1e-9) continue;
        const C = d - b.len;
        if (b.mat.tensionOnly && C < 0) { b.force = 0; b.smooth *= 1 - FORCE_SMOOTH; continue; }
        const nx = dx / d, ny = dy / d;
        // XPBD with Rayleigh-style damping along the beam
        const alphaT = b.alpha / h2;
        const gamma = (b.damp * b.alpha) / h;
        const vrel = (A.x - A.px - (B.x - B.px)) * nx + (A.y - A.py - (B.y - B.py)) * ny;
        const dl = (-C - gamma * vrel) / ((1 + gamma) * (wa + wb) + alphaT);
        A.x += wa * dl * nx; A.y += wa * dl * ny;
        B.x -= wb * dl * nx; B.y -= wb * dl * ny;
        b.force = -dl / h2; // tension positive
        b.smooth += (b.force - b.smooth) * FORCE_SMOOTH;
      }

      // vehicle frames (rigid)
      for (const v of this.vehicles) {
        if (!v.active) continue;
        for (const l of v.links) {
          const P = v.parts[l.i], Q = v.parts[l.j];
          const dx = P.x - Q.x, dy = P.y - Q.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < 1e-9) continue;
          const dl = -(d - l.len) / (P.w + Q.w);
          const nx = dx / d, ny = dy / d;
          P.x += P.w * dl * nx; P.y += P.w * dl * ny;
          Q.x -= Q.w * dl * nx; Q.y -= Q.w * dl * ny;
        }
      }

      // contacts
      for (const v of this.vehicles) {
        if (!v.active) continue;
        const up = this._vehicleUp(v);
        const drive = v.def.speed * h;
        for (const p of v.parts) {
          for (const s of this.terrain) {
            if (p.x + p.r < s.minX || p.x - p.r > s.maxX || p.y + p.r < s.minY || p.y - p.r > s.maxY) continue;
            this._contact(p, s.ax, s.ay, s.bx, s.by, null, null, 0, p.wheel ? drive : 0, up, p.wheel);
          }
          if (!p.wheel) continue;
          for (const b of this.beams) {
            if (b.broken || !b.mat.drivable) continue;
            const A = nodes[b.a], B = nodes[b.b];
            const r = p.r + ROAD_SKIN;
            if (p.x + r < Math.min(A.x, B.x) || p.x - r > Math.max(A.x, B.x) || p.y + r < Math.min(A.y, B.y) || p.y - r > Math.max(A.y, B.y)) continue;
            this._contact(p, A.x, A.y, B.x, B.y, A, B, ROAD_SKIN, drive, up, true);
          }
        }
      }
      this._vehicleVehicle();

      // breaking
      for (let i = 0, n = this.beams.length; i < n; i++) {
        const b = this.beams[i];
        if (b.broken || b.stub) continue;
        if (Math.abs(b.smooth) > b.mat.strength) this._break(b);
      }
    }

    _vehicleUp(v) {
      const a = v.parts[0], b = v.parts[1];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
      return { x: -dy / d, y: dx / d };
    }

    /*
     * Circle (particle p, radius p.r) against a segment AB with thickness `half`.
     * A/B are bridge joints (or null for static terrain). Applies the
     * non-penetration correction and, for wheels, friction that drives the
     * vehicle along the surface at `drive` metres per substep.
     */
    _contact(p, ax, ay, bx, by, A, B, half, drive, up, isWheel) {
      const t = closestT(p.x, p.y, ax, ay, bx, by);
      const qx = ax + (bx - ax) * t, qy = ay + (by - ay) * t;
      let nx = p.x - qx, ny = p.y - qy;
      const d = Math.sqrt(nx * nx + ny * ny);
      const rr = p.r + half;
      if (d >= rr) return;
      if (d > 1e-9) { nx /= d; ny /= d; } else { nx = -(by - ay); ny = bx - ax; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l; if (ny < 0) { nx = -nx; ny = -ny; } }
      const pen = rr - d;
      const wa = A && !A.fixed && !A.frozen ? A.w : 0;
      const wb = B && !B.fixed && !B.frozen ? B.w : 0;
      const ta = 1 - t, tb = t;
      const wsum = p.w + wa * ta * ta + wb * tb * tb;
      const surfDisp = () => A
        ? [(A.x - A.px) * ta + (B.x - B.px) * tb, (A.y - A.py) * ta + (B.y - B.py) * tb]
        : [0, 0];
      let sd = surfDisp();
      const vn0 = (p.x - p.px - sd[0]) * nx + (p.y - p.py - sd[1]) * ny;
      const dl = pen / wsum;
      p.x += nx * dl * p.w; p.y += ny * dl * p.w;
      if (wa) { A.x -= nx * dl * ta * wa; A.y -= ny * dl * ta * wa; }
      if (wb) { B.x -= nx * dl * tb * wb; B.y -= ny * dl * tb * wb; }
      // inelastic contact: the position fix must not fling the particle away
      sd = surfDisp();
      const vn1 = (p.x - p.px - sd[0]) * nx + (p.y - p.py - sd[1]) * ny;
      const vmax = vn0 < 0 ? -RESTITUTION * vn0 : vn0;
      if (vn1 > vmax) { p.px += nx * (vn1 - vmax); p.py += ny * (vn1 - vmax); }

      // friction / traction along the tangent (pointing "forward" for the vehicle)
      let tx = ny, ty = -nx;
      if (tx < 0) { tx = -tx; ty = -ty; }
      const sdx = sd[0], sdy = sd[1];
      const rel = (p.x - p.px - sdx) * tx + (p.y - p.py - sdy) * ty;
      // only drive when the wheels are on the ground right way up
      const upright = up.y > 0.3 && nx * up.x + ny * up.y > 0.3;
      const target = isWheel && upright ? drive * tx : 0; // project so bumps and corners don't launch the wheel
      let corr = target - rel;
      const lim = FRICTION * pen * (isWheel ? 1 : 0.6);
      if (corr > lim) corr = lim; else if (corr < -lim) corr = -lim;
      const dt = corr / wsum;
      p.x += tx * dt * p.w; p.y += ty * dt * p.w;
      if (wa) { A.x -= tx * dt * ta * wa; A.y -= ty * dt * ta * wa; }
      if (wb) { B.x -= tx * dt * tb * wb; B.y -= ty * dt * tb * wb; }
    }

    _vehicleVehicle() {
      const vs = this.vehicles;
      for (let i = 0; i < vs.length; i++) {
        const a = vs[i];
        if (!a.active) continue;
        for (let j = i + 1; j < vs.length; j++) {
          const b = vs[j];
          if (!b.active) continue;
          if (Math.abs(a.parts[0].x - b.parts[0].x) > 12) continue;
          for (const p of a.parts) for (const q of b.parts) {
            const dx = p.x - q.x, dy = p.y - q.y, d = Math.hypot(dx, dy), rr = p.r + q.r + 0.15;
            if (d >= rr || d < 1e-9) continue;
            const dl = (rr - d) / (p.w + q.w);
            p.x += (dx / d) * dl * p.w; p.y += (dy / d) * dl * p.w;
            q.x -= (dx / d) * dl * q.w; q.y -= (dy / d) * dl * q.w;
          }
        }
      }
    }

    /* Snap a beam in two: each end keeps a swinging half-length stub. */
    _break(b) {
      b.broken = true;
      const A = this.nodes[b.a], B = this.nodes[b.b];
      const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
      const vx = ((A.x - A.px) + (B.x - B.px)) / 2, vy = ((A.y - A.py) + (B.y - B.py)) / 2;
      const quarter = (b.mat.density * b.len) / 4;
      const mkNode = (x, y) => {
        this.nodes.push({ x, y, px: x - vx, py: y - vy, mass: quarter, w: 1 / Math.max(quarter, 1), fixed: false, frozen: false });
        return this.nodes.length - 1;
      };
      const ux = (B.x - A.x), uy = (B.y - A.y), ul = Math.hypot(ux, uy) || 1;
      const gap = Math.min(0.08, ul * 0.05);
      const m1 = mkNode(mx - (ux / ul) * gap, my - (uy / ul) * gap);
      const m2 = mkNode(mx + (ux / ul) * gap, my + (uy / ul) * gap);
      const l1 = Math.hypot(this.nodes[m1].x - A.x, this.nodes[m1].y - A.y);
      const l2 = Math.hypot(this.nodes[m2].x - B.x, this.nodes[m2].y - B.y);
      if (l1 > 1e-3) this._setDamping(this._addBeam(b.a, m1, b.mat, l1, true));
      if (l2 > 1e-3) this._setDamping(this._addBeam(m2, b.b, b.mat, l2, true));
      this.events.push({ type: 'break', x: mx, y: my, mat: b.mat.key });
    }

    maxStressRatio() {
      let m = 0;
      for (const b of this.beams) if (!b.broken && !b.stub) m = Math.max(m, Math.abs(b.smooth) / b.mat.strength);
      return m;
    }
  }

  const api = { ROAD_SKIN, World, MATERIALS, MATERIAL_ORDER, VEHICLES, SUBSTEPS, pointInPoly, closestT, surfaceY, designCost };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BW = Object.assign(root.BW || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
