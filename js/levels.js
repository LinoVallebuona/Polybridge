/*
 * Level definitions. Coordinates in metres, +y up.
 *  terrain  – closed polygons the vehicles drive on (and you cannot build inside)
 *  anchors  – fixed joints your bridge can attach to
 *  start    – x where vehicles appear; finish – x of the flag
 *  bounds   – the area joints may be placed in
 */
(function (root) {
  'use strict';

  const DEEP = -30;

  function leftCliff(edge, top) {
    return [[-80, top], [edge, top], [edge, top - 3], [edge - 1.2, top - 6], [edge - 2.5, DEEP], [-80, DEEP]];
  }
  function rightCliff(edge, top) {
    return [[edge, top], [140, top], [140, DEEP], [edge + 2.5, DEEP], [edge + 1.2, top - 6], [edge, top - 3]];
  }
  function pillar(x, top, w) {
    const h = w / 2;
    return [[x - h, top], [x + h, top], [x + h + 0.8, DEEP], [x - h - 0.8, DEEP]];
  }

  const LEVELS = [
    {
      id: 'first-steps', name: 'First Steps',
      hint: 'Drag from a red anchor to lay road. Add wood underneath to hold it up.',
      budget: 3500, waterY: -5,
      terrain: [leftCliff(0, 0), rightCliff(6, 0)],
      anchors: [[0, 0], [6, 0], [0, -2], [6, -2]],
      start: -9, finish: 11,
      bounds: { x0: -1, x1: 7, y0: -4.5, y1: 5 },
      vehicles: [{ type: 'car' }],
    },
    {
      id: 'triangles', name: 'Triangles',
      hint: 'Triangles do not bend. A truss of triangles spreads the load.',
      budget: 6500, waterY: -5,
      terrain: [leftCliff(0, 0), rightCliff(10, 0)],
      anchors: [[0, 0], [10, 0], [0, -2], [10, -2]],
      start: -9, finish: 15,
      bounds: { x0: -1, x1: 11, y0: -4.5, y1: 6 },
      vehicles: [{ type: 'car' }, { type: 'car', delay: 2.2 }],
    },
    {
      id: 'stepping-stone', name: 'Stepping Stone',
      hint: 'Use the rock in the middle. Two short spans beat one long one.',
      budget: 10500, waterY: -6,
      terrain: [leftCliff(0, 0), pillar(8, -2, 1.6), rightCliff(16, 0)],
      anchors: [[0, 0], [16, 0], [0, -2], [16, -2], [7.5, -2], [8.5, -2]],
      start: -9, finish: 21,
      bounds: { x0: -1, x1: 17, y0: -5.5, y1: 6 },
      vehicles: [{ type: 'car' }, { type: 'van', delay: 2.6 }],
    },
    {
      id: 'heavy-duty', name: 'Heavy Duty',
      hint: 'Trucks are heavy. Steel is strong and spans 4 m.',
      budget: 13000, waterY: -6,
      terrain: [leftCliff(0, 0), rightCliff(12, 0)],
      anchors: [[0, 0], [12, 0], [0, -2], [12, -2]],
      start: -10, finish: 18,
      bounds: { x0: -1, x1: 13, y0: -5.5, y1: 7 },
      vehicles: [{ type: 'truck' }],
    },
    {
      id: 'hang-loose', name: 'Hang Loose',
      hint: 'No supports below. Raise towers and hang the road with rope or cable (they only pull).',
      budget: 30000, waterY: -9,
      terrain: [leftCliff(0, 0), rightCliff(18, 0)],
      anchors: [[0, 0], [18, 0], [-3, 0], [21, 0]],
      start: -10, finish: 24,
      bounds: { x0: -4, x1: 22, y0: -8.5, y1: 10 },
      vehicles: [{ type: 'car' }, { type: 'van', delay: 2.6 }],
    },
    {
      id: 'downhill', name: 'Downhill',
      hint: 'The far side is lower. Keep the slope gentle.',
      budget: 13000, waterY: -7,
      terrain: [leftCliff(0, 2), rightCliff(12, -1)],
      anchors: [[0, 2], [12, -1], [0, 0], [12, -3]],
      start: -9, finish: 18,
      bounds: { x0: -1, x1: 13, y0: -6.5, y1: 7 },
      vehicles: [{ type: 'van' }, { type: 'car', delay: 2.4 }],
    },
    {
      id: 'twin-pillars', name: 'Twin Pillars',
      hint: 'A long crossing with three vehicles. Spend where the stress is.',
      budget: 17000, waterY: -7,
      terrain: [leftCliff(0, 0), pillar(8, -3, 1.6), pillar(16, -3, 1.6), rightCliff(24, 0)],
      anchors: [[0, 0], [24, 0], [0, -2], [24, -2], [7.5, -3], [8.5, -3], [15.5, -3], [16.5, -3]],
      start: -10, finish: 30,
      bounds: { x0: -1, x1: 25, y0: -6.5, y1: 7 },
      vehicles: [{ type: 'car' }, { type: 'van', delay: 2.2 }, { type: 'truck', delay: 4.6 }],
    },
    {
      id: 'long-haul', name: 'The Long Haul',
      hint: 'Thirty-two metres, a bus and a truck. Think big.',
      budget: 52000, waterY: -8,
      terrain: [leftCliff(0, 0), rightCliff(32, 0), pillar(16, -4, 2)],
      anchors: [[0, 0], [32, 0], [0, -2], [32, -2], [15.4, -4], [16.6, -4]],
      start: -12, finish: 39,
      bounds: { x0: -1, x1: 33, y0: -7.5, y1: 10 },
      vehicles: [{ type: 'bus' }, { type: 'truck', delay: 3.6 }],
    },
    {
      id: 'sandbox', name: 'Sandbox',
      hint: 'No budget. Build anything and send every vehicle across.',
      budget: Infinity, waterY: -8, sandbox: true,
      terrain: [leftCliff(0, 0), rightCliff(32, 0), pillar(16, -4, 2)],
      anchors: [[0, 0], [32, 0], [0, -2], [32, -2], [15.4, -4], [16.6, -4], [-2.5, 0], [34.5, 0]],
      start: -12, finish: 39,
      bounds: { x0: -3.5, x1: 35.5, y0: -7.5, y1: 12 },
      vehicles: [{ type: 'car' }, { type: 'van', delay: 2.2 }, { type: 'truck', delay: 4.6 }, { type: 'bus', delay: 7.4 }],
    },
  ];

  const api = { LEVELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BW = Object.assign(root.BW || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
