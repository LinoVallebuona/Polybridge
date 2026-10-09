// Helpers that build reference bridges for the headless tests.
'use strict';

class Builder {
  constructor(level) {
    this.level = level;
    this.points = level.anchors.map((a) => [a[0], a[1]]);
    this.beams = [];
  }
  pt(x, y) {
    x = Math.round(x * 1000) / 1000; y = Math.round(y * 1000) / 1000;
    const i = this.points.findIndex((p) => Math.abs(p[0] - x) < 1e-3 && Math.abs(p[1] - y) < 1e-3);
    if (i >= 0) return i;
    this.points.push([x, y]);
    return this.points.length - 1;
  }
  beam(x0, y0, x1, y1, mat) {
    const a = this.pt(x0, y0), b = this.pt(x1, y1);
    if (a !== b && !this.beams.some((q) => (q[0] === a && q[1] === b) || (q[0] === b && q[1] === a))) this.beams.push([a, b, mat]);
    return this;
  }
  // split a straight run into n pieces
  line(x0, y0, x1, y1, n, mat) {
    for (let i = 0; i < n; i++) {
      this.beam(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, x0 + ((x1 - x0) * (i + 1)) / n, y0 + ((y1 - y0) * (i + 1)) / n, mat);
    }
    return this;
  }
  // Warren truss hanging below a straight deck (x0,y0)-(x1,y1); d = depth (negative = above)
  truss(x0, y0, x1, y1, n, d, mat) {
    const dx = (x1 - x0) / n, dy = (y1 - y0) / n;
    for (let i = 0; i < n; i++) {
      const xa = x0 + dx * i, ya = y0 + dy * i;
      const xm = xa + dx / 2, ym = ya + dy / 2 - d;
      this.beam(xa, ya, xm, ym, mat).beam(xm, ym, xa + dx, ya + dy, mat);
      if (i > 0) this.beam(xm - dx, ym - dy, xm, ym, mat);
    }
    return this;
  }
  trussBelow(x0, x1, y, n, d, mat) { return this.truss(x0, y, x1, y, n, d, mat); }
  trussAbove(x0, x1, y, n, d, mat) { return this.truss(x0, y, x1, y, n, -d, mat); }
  // parabolic main cable between two tower tops, with vertical hangers to deck nodes at y=deckY
  suspension(tl, tr, sagY, xs, deckY, mainMat, hangerMat) {
    const xm = (tl[0] + tr[0]) / 2, half = (tr[0] - tl[0]) / 2;
    const yAt = (x) => sagY + (tl[1] - sagY) * ((x - xm) / half) ** 2;
    let prev = tl;
    for (const x of xs) {
      const p = [x, yAt(x)];
      this.beam(prev[0], prev[1], p[0], p[1], mainMat).beam(p[0], p[1], x, deckY, hangerMat);
      prev = p;
    }
    this.beam(prev[0], prev[1], tr[0], tr[1], mainMat);
    return this;
  }
  design() { return { points: this.points, beams: this.beams }; }
}

module.exports = { Builder };
