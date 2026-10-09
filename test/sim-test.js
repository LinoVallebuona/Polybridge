// Headless physics checks: node test/sim-test.js
'use strict';
const { World, designCost } = require('../js/physics.js');
const { LEVELS } = require('../js/levels.js');
const { Builder } = require('./designs.js');

const L = Object.fromEntries(LEVELS.map((l) => [l.id, l]));

function run(level, design, maxT = 60) {
  const w = new World(level, design);
  let maxStress = 0;
  while (w.status === 'running' && w.time < maxT) {
    w.step(1 / 60);
    maxStress = Math.max(maxStress, w.maxStressRatio());
    for (const n of w.nodes) if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) throw new Error('NaN in simulation');
  }
  const broken = w.beams.filter((b) => b.broken).length;
  return { status: w.status, reason: w.failReason, time: +w.time.toFixed(1), maxStress: +maxStress.toFixed(2), broken, cost: designCost(design), budget: level.budget };
}

const cases = [];
const add = (name, level, build, expect) => cases.push({ name, level, build, expect });

// Level 1 — 6 m
add('L1 road only', L['first-steps'], (b) => b.line(0, 0, 6, 0, 3, 'road'), 'failed');
add('L1 kingposts', L['first-steps'], (b) => {
  b.line(0, 0, 6, 0, 3, 'road');
  b.beam(0, -2, 1, -1, 'wood').beam(1, -1, 2, 0, 'wood').beam(0, 0, 1, -1, 'wood');
  b.beam(6, -2, 5, -1, 'wood').beam(5, -1, 4, 0, 'wood').beam(6, 0, 5, -1, 'wood');
}, 'won');
add('L1 truss above', L['first-steps'], (b) => { b.line(0, 0, 6, 0, 3, 'road'); b.trussAbove(0, 6, 0, 3, 1.5, 'wood'); }, 'won');
// Level 2 — 10 m, two cars
add('L2 road only', L.triangles, (b) => b.line(0, 0, 10, 0, 5, 'road'), 'failed');
add('L2 truss above', L.triangles, (b) => { b.line(0, 0, 10, 0, 5, 'road'); b.trussAbove(0, 10, 0, 5, 1.5, 'wood'); }, 'won');
add('L2 truss below', L.triangles, (b) => { b.line(0, 0, 10, 0, 5, 'road'); b.trussBelow(0, 10, 0, 5, 1.5, 'wood'); }, 'won');
// Level 3 — 16 m with a rock in the middle
add('L3 two trusses', L['stepping-stone'], (b) => {
  b.line(0, 0, 16, 0, 8, 'road');
  b.trussAbove(0, 8, 0, 4, 1.5, 'wood').trussAbove(8, 16, 0, 4, 1.5, 'wood');
}, null);
add('L3 trusses + props', L['stepping-stone'], (b) => {
  b.line(0, 0, 16, 0, 8, 'road');
  b.trussBelow(0, 8, 0, 4, 1.5, 'wood').trussBelow(8, 16, 0, 4, 1.5, 'wood');
  b.beam(7.5, -2, 7, -1.5, 'wood').beam(8.5, -2, 9, -1.5, 'wood');
}, 'won');
// Level 4 — 12 m, truck
add('L4 wood truss (weak)', L['heavy-duty'], (b) => { b.line(0, 0, 12, 0, 6, 'road'); b.trussAbove(0, 12, 0, 6, 1.5, 'wood'); }, 'failed');
add('L4 steel truss', L['heavy-duty'], (b) => { b.line(0, 0, 12, 0, 6, 'road'); b.trussAbove(0, 12, 0, 3, 2, 'steel'); for (const x of [2, 6, 10]) b.beam(x, 2, x, 0, 'wood'); }, 'won');
add('L4 deep wood truss', L['heavy-duty'], (b) => { b.line(0, 0, 12, 0, 6, 'road'); b.trussAbove(0, 12, 0, 6, 1.5, 'wood'); b.trussBelow(0, 12, 0, 6, 1.5, 'wood'); }, null);
// Level 5 — 18 m, no supports below
add('L5 suspension', L['hang-loose'], (b) => {
  b.line(0, 0, 18, 0, 9, 'road');
  b.beam(-3, 0, -1.5, 3.5, 'steel').beam(0, 0, -1.5, 3.5, 'steel');
  b.beam(21, 0, 19.5, 3.5, 'steel').beam(18, 0, 19.5, 3.5, 'steel');
  b.suspension([-1.5, 3.5], [19.5, 3.5], 1, [2, 4, 6, 8, 10, 12, 14, 16], 0, 'cable', 'rope');
}, null);
add('L5 cable-stayed rope', L['hang-loose'], (b) => {
  b.line(0, 0, 18, 0, 9, 'road');
  b.beam(-3, 0, -1.5, 3.5, 'steel').beam(0, 0, -1.5, 3.5, 'steel');
  b.beam(21, 0, 19.5, 3.5, 'steel').beam(18, 0, 19.5, 3.5, 'steel');
  for (const x of [2, 4, 6, 8]) b.beam(-1.5, 3.5, x, 0, 'rope');
  for (const x of [10, 12, 14, 16]) b.beam(19.5, 3.5, x, 0, 'rope');
}, null);
add('L5 cable-stayed cable', L['hang-loose'], (b) => {
  b.line(0, 0, 18, 0, 9, 'road');
  b.beam(-3, 0, -1.5, 3.5, 'steel').beam(0, 0, -1.5, 3.5, 'steel');
  b.beam(21, 0, 19.5, 3.5, 'steel').beam(18, 0, 19.5, 3.5, 'steel');
  for (const x of [2, 4, 6, 8]) b.beam(-1.5, 3.5, x, 0, 'cable');
  for (const x of [10, 12, 14, 16]) b.beam(19.5, 3.5, x, 0, 'cable');
}, null);
// Level 6 — downhill 12 m
add('L6 road only', L.downhill, (b) => b.line(0, 2, 12, -1, 6, 'road'), 'failed');
add('L6 deep truss', L.downhill, (b) => {
  b.line(0, 2, 12, -1, 6, 'road');
  b.truss(0, 2, 12, -1, 6, 1.7, 'wood');
  b.beam(0, 0, 1, 0.05, 'wood').beam(12, -3, 11, -2.45, 'wood');
}, null);
add('L6 double truss', L.downhill, (b) => {
  b.line(0, 2, 12, -1, 6, 'road');
  b.truss(0, 2, 12, -1, 6, 1.5, 'wood').truss(0, 2, 12, -1, 6, -1.5, 'wood');
}, 'won');
// Level 7 — 24 m, two pillars, three vehicles
add('L7 wood trusses', L['twin-pillars'], (b) => {
  b.line(0, 0, 24, 0, 12, 'road');
  b.trussAbove(0, 8, 0, 4, 1.5, 'wood').trussAbove(8, 16, 0, 4, 1.5, 'wood').trussAbove(16, 24, 0, 4, 1.5, 'wood');
  b.beam(7.5, -3, 8, -1.5, 'wood').beam(8, -1.5, 8, 0, 'wood').beam(8.5, -3, 8, -1.5, 'wood');
  b.beam(15.5, -3, 16, -1.5, 'wood').beam(16, -1.5, 16, 0, 'wood').beam(16.5, -3, 16, -1.5, 'wood');
}, 'won');
add('L7 steel trusses', L['twin-pillars'], (b) => {
  b.line(0, 0, 24, 0, 12, 'road');
  b.trussAbove(0, 8, 0, 2, 2, 'steel').trussAbove(8, 16, 0, 2, 2, 'steel').trussAbove(16, 24, 0, 2, 2, 'steel');
  for (const x of [2, 6, 10, 14, 18, 22]) b.beam(x, 2, x, 0, 'wood');
  b.beam(7.5, -3, 8, -1.5, 'wood').beam(8, -1.5, 8, 0, 'wood').beam(8.5, -3, 8, -1.5, 'wood');
  b.beam(15.5, -3, 16, -1.5, 'wood').beam(16, -1.5, 16, 0, 'wood').beam(16.5, -3, 16, -1.5, 'wood');
}, null);
// Level 8 — 32 m, bus + truck
add('L8 steel trusses', L['long-haul'], (b) => {
  b.line(0, 0, 32, 0, 16, 'reinforced');
  b.trussAbove(0, 16, 0, 4, 3, 'steel').trussAbove(16, 32, 0, 4, 3, 'steel');
  for (let x = 2; x < 32; x += 4) b.beam(x, 3, x, 0, 'steel');
  b.beam(15.4, -4, 16, 0, 'steel').beam(16.6, -4, 16, 0, 'steel');
}, 'won');
add('L8 road + steel', L['long-haul'], (b) => {
  b.line(0, 0, 32, 0, 16, 'road');
  b.trussAbove(0, 16, 0, 4, 3, 'steel').trussAbove(16, 32, 0, 4, 3, 'steel');
  for (let x = 2; x < 32; x += 4) b.beam(x, 3, x, 0, 'wood');
  b.beam(15.4, -4, 16, 0, 'steel').beam(16.6, -4, 16, 0, 'steel');
}, 'won');
add('L8 wood double truss', L['long-haul'], (b) => {
  b.line(0, 0, 32, 0, 16, 'road');
  b.trussAbove(0, 32, 0, 16, 1.5, 'wood').trussBelow(0, 16, 0, 8, 1.5, 'wood').trussBelow(16, 32, 0, 8, 1.5, 'wood');
  b.beam(15.4, -4, 15, -1.5, 'wood').beam(16.6, -4, 17, -1.5, 'wood').beam(15.4, -4, 16.6, -4, 'wood');
}, null);
// Sandbox: every vehicle over a big steel truss
add('Sandbox steel', L.sandbox, (b) => {
  b.line(0, 0, 32, 0, 16, 'reinforced');
  b.trussAbove(0, 16, 0, 4, 3, 'steel').trussAbove(16, 32, 0, 4, 3, 'steel');
  for (let x = 2; x < 32; x += 4) b.beam(x, 3, x, 0, 'steel');
  b.beam(15.4, -4, 16, 0, 'steel').beam(16.6, -4, 16, 0, 'steel');
}, 'won');

module.exports = { cases, run, Builder };
if (require.main !== module) return;

let failures = 0;
const solvable = new Set();
const only = process.argv[2];
for (const c of cases) {
  if (only && !c.name.includes(only)) continue;
  const b = new Builder(c.level);
  c.build(b);
  const r = run(c.level, b.design());
  const ok = !c.expect || r.status === c.expect;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.name.padEnd(30)} ${JSON.stringify(r)}`);
  if (r.status === 'won' && r.cost <= c.level.budget) solvable.add(c.level.id);
}
// every level needs at least one reference bridge that passes within budget
if (!only) {
  for (const lv of LEVELS) {
    if (!solvable.has(lv.id)) { failures++; console.log(`FAIL level "${lv.name}" has no passing design within its budget`); }
  }
}
if (failures) { console.log(`${failures} case(s) did not match`); process.exit(1); }
