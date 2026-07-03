// Lightweight grid A* over walkable FLOOR cells. Enemies use it to route to a
// waypoint or last-known player position through corridors.

import { FLOOR } from './mapgen.js';

export function findPath(map, sgx, sgy, tgx, tgy) {
  if (map.cellAt(sgx, sgy) !== FLOOR || map.cellAt(tgx, tgy) !== FLOOR) return null;
  if (sgx === tgx && sgy === tgy) return [{ gx: tgx, gy: tgy }];

  const cols = map.cols;
  const key = (x, y) => y * cols + x;
  const open = [];
  const came = new Map();
  const g = new Map();
  const startK = key(sgx, sgy);
  g.set(startK, 0);
  open.push({ x: sgx, y: sgy, f: heur(sgx, sgy, tgx, tgy) });

  const dirs = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
  ];

  let guard = 0;
  while (open.length && guard++ < 4000) {
    // Pop lowest f (linear scan; grids here are small).
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (cur.x === tgx && cur.y === tgy) {
      return reconstruct(came, key(cur.x, cur.y), cols);
    }
    const curK = key(cur.x, cur.y);
    const cg = g.get(curK);
    for (const [dx, dy] of dirs) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (map.cellAt(nx, ny) !== FLOOR) continue;
      const nk = key(nx, ny);
      const ng = cg + 1;
      if (!g.has(nk) || ng < g.get(nk)) {
        g.set(nk, ng);
        came.set(nk, curK);
        open.push({ x: nx, y: ny, f: ng + heur(nx, ny, tgx, tgy) });
      }
    }
  }
  return null;
}

function heur(x, y, tx, ty) {
  return Math.abs(x - tx) + Math.abs(y - ty);
}

function reconstruct(came, endK, cols) {
  const path = [];
  let k = endK;
  while (k !== undefined) {
    path.push({ gx: k % cols, gy: Math.floor(k / cols) });
    k = came.get(k);
  }
  return path.reverse();
}
