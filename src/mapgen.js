// Procedural stealth-compound generator. Rooms themed by zone, joined by
// narrow doorways/corridors for a "compound" feel, wrapped in walls, dressed
// with blocking props (crates, barrels, desks, lockers) and non-blocking
// decorations (rugs, puddles, grates, plants) plus lamp light pools and an
// extraction pad placed far from the player spawn.

import { makeRng, randInt, pick } from './utils.js';

export const TILE = 56;
export const VOID = 0;
export const FLOOR = 1;
export const WALL = 2;

const BLOCKING_PROPS = new Set(['crate', 'barrel', 'desk', 'locker']);

export class GameMap {
  constructor(seed, level) {
    this.seed = seed;
    this.level = level;
    this.rng = makeRng(seed);

    // Larger arenas so patrols spread out; capped for readability.
    this.cols = Math.min(20 + Math.floor(level / 2), 30);
    this.rows = Math.min(24 + Math.floor(level / 2), 36);

    this.cells = [];
    this.zones = [];
    this.props = [];
    this.decos = [];       // non-blocking floor decoration {gx,gy,type}
    this.floorTiles = [];
    this.rooms = [];
    this.lights = [];
    this.extract = null;

    this._generate();
  }

  idx(gx, gy) { return gy * this.cols + gx; }
  inBounds(gx, gy) { return gx >= 0 && gy >= 0 && gx < this.cols && gy < this.rows; }
  cellAt(gx, gy) { return this.inBounds(gx, gy) ? this.cells[this.idx(gx, gy)] : WALL; }
  worldWidth() { return this.cols * TILE; }
  worldHeight() { return this.rows * TILE; }

  isBlockedWorld(x, y) {
    const gx = Math.floor(x / TILE), gy = Math.floor(y / TILE);
    return this.cellAt(gx, gy) !== FLOOR;
  }
  isWallCell(gx, gy) { return this.cellAt(gx, gy) === WALL; }

  _generate() {
    const N = this.cols * this.rows;
    this.cells = new Array(N).fill(VOID);
    this.zones = new Array(N).fill('street');

    // Rooms.
    const roomCount = randInt(this.rng, 5, 9);
    let attempts = 0;
    while (this.rooms.length < roomCount && attempts < 90) {
      attempts++;
      const w = randInt(this.rng, 4, 8);
      const h = randInt(this.rng, 4, 8);
      const x = randInt(this.rng, 1, this.cols - w - 1);
      const y = randInt(this.rng, 1, this.rows - h - 1);
      const room = { x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1) };
      let ok = true;
      for (const r of this.rooms) if (Math.abs(r.cx - room.cx) < 3 && Math.abs(r.cy - room.cy) < 3) { ok = false; break; }
      if (!ok) continue;
      room.zone = pick(this.rng, ['interior', 'interior', 'street', 'roof']);
      this._carveRoom(room);
      this.rooms.push(room);
    }

    // Connect rooms with narrow (1-wide) corridors for a compound feel.
    for (let i = 1; i < this.rooms.length; i++) this._carveCorridor(this.rooms[i - 1], this.rooms[i]);
    for (let k = 0; k < 2 && this.rooms.length > 2; k++) {
      const a = pick(this.rng, this.rooms), b = pick(this.rng, this.rooms);
      if (a !== b) this._carveCorridor(a, b);
    }

    // Wall pass.
    for (let gy = 0; gy < this.rows; gy++)
      for (let gx = 0; gx < this.cols; gx++) {
        if (this.cells[this.idx(gx, gy)] !== VOID) continue;
        let touch = false;
        for (let dy = -1; dy <= 1 && !touch; dy++)
          for (let dx = -1; dx <= 1; dx++)
            if (this.cellAt(gx + dx, gy + dy) === FLOOR) { touch = true; break; }
        if (touch) this.cells[this.idx(gx, gy)] = WALL;
      }

    for (let gy = 0; gy < this.rows; gy++)
      for (let gx = 0; gx < this.cols; gx++)
        if (this.cells[this.idx(gx, gy)] === FLOOR) this.floorTiles.push({ gx, gy });

    this._placeDecos();
    this._placeProps();
    this._placeExtract();
  }

  _carveRoom(room) {
    for (let y = room.y; y < room.y + room.h; y++)
      for (let x = room.x; x < room.x + room.w; x++) {
        if (!this.inBounds(x, y)) continue;
        this.cells[this.idx(x, y)] = FLOOR;
        this.zones[this.idx(x, y)] = room.zone;
      }
  }

  _carveCorridor(a, b) {
    const carve = (x, y) => {
      if (!this.inBounds(x, y)) return;
      if (this.cells[this.idx(x, y)] === VOID) { this.cells[this.idx(x, y)] = FLOOR; this.zones[this.idx(x, y)] = 'street'; }
    };
    let x = a.cx, y = a.cy;
    if (this.rng() < 0.5) {
      for (; x !== b.cx; x += Math.sign(b.cx - x)) carve(x, y);
      for (; y !== b.cy; y += Math.sign(b.cy - y)) carve(x, y);
    } else {
      for (; y !== b.cy; y += Math.sign(b.cy - y)) carve(x, y);
      for (; x !== b.cx; x += Math.sign(b.cx - x)) carve(x, y);
    }
  }

  _placeDecos() {
    // Rugs in interior rooms.
    for (const r of this.rooms) {
      if (r.zone === 'interior' && r.w >= 5 && r.h >= 5 && this.rng() < 0.7) {
        for (let y = r.y + 1; y < r.y + r.h - 1; y++)
          for (let x = r.x + 1; x < r.x + r.w - 1; x++)
            this.decos.push({ gx: x, gy: y, type: 'rug' });
      }
    }
    // Puddles + grates + cracks scattered on floor for texture.
    const n = 10 + Math.floor(this.rng() * 14);
    for (let i = 0; i < n; i++) {
      const t = this.floorTiles[Math.floor(this.rng() * this.floorTiles.length)];
      if (!t) break;
      const type = pick(this.rng, ['puddle', 'puddle', 'grate', 'crack']);
      this.decos.push({ gx: t.gx, gy: t.gy, type });
    }
  }

  _placeProps() {
    const used = new Set();
    const claim = (gx, gy) => used.add(gx + ',' + gy);
    const isUsed = (gx, gy) => used.has(gx + ',' + gy);

    // Lamps -> light pools.
    const lampCount = 4 + Math.floor(this.rng() * 4);
    for (let i = 0; i < lampCount; i++) {
      const r = pick(this.rng, this.rooms);
      if (!r) break;
      const gx = r.cx + randInt(this.rng, -1, 1), gy = r.cy + randInt(this.rng, -1, 1);
      if (this.cellAt(gx, gy) !== FLOOR || isUsed(gx, gy)) continue;
      claim(gx, gy);
      this.props.push({ gx, gy, type: 'lamp' });
      this.lights.push({ x: (gx + 0.5) * TILE, y: (gy + 0.5) * TILE, r: TILE * 2.4 });
    }

    // Blocking + decorative clutter.
    const clutter = 8 + Math.floor(this.rng() * 6) + this.level;
    for (let i = 0; i < clutter; i++) {
      const t = pick(this.rng, this.floorTiles);
      if (!t || isUsed(t.gx, t.gy)) continue;
      const zone = this.zones[this.idx(t.gx, t.gy)];
      const pool = zone === 'interior'
        ? ['desk', 'locker', 'crate', 'plant', 'barrel']
        : ['crate', 'barrel', 'barrel', 'pole', 'plant'];
      const type = pick(this.rng, pool);
      claim(t.gx, t.gy);
      this.props.push({ gx: t.gx, gy: t.gy, type });
      if (BLOCKING_PROPS.has(type)) { this.cells[this.idx(t.gx, t.gy)] = WALL; this.zones[this.idx(t.gx, t.gy)] = 'prop_' + type; }
    }
    this.floorTiles = this.floorTiles.filter((t) => this.cells[this.idx(t.gx, t.gy)] === FLOOR);
  }

  _placeExtract() {
    let best = null, bestD = -1;
    const cx = this.cols / 2, cy = this.rows / 2;
    for (const t of this.floorTiles) {
      const d = Math.hypot(t.gx - cx, t.gy - cy);
      if (d > bestD) { bestD = d; best = t; }
    }
    this.extract = best ? { gx: best.gx, gy: best.gy } : this.floorTiles[0];
  }

  randomFloorPos(minDistFrom = null, minDist = 0) {
    for (let tries = 0; tries < 60; tries++) {
      const t = this.floorTiles[Math.floor(this.rng() * this.floorTiles.length)];
      const wx = (t.gx + 0.5) * TILE, wy = (t.gy + 0.5) * TILE;
      if (!minDistFrom || Math.hypot(wx - minDistFrom.x, wy - minDistFrom.y) >= minDist)
        return { x: wx, y: wy, gx: t.gx, gy: t.gy };
    }
    const t = this.floorTiles[0];
    return { x: (t.gx + 0.5) * TILE, y: (t.gy + 0.5) * TILE, gx: t.gx, gy: t.gy };
  }

  zoneAtWorld(x, y) {
    const gx = Math.floor(x / TILE), gy = Math.floor(y / TILE);
    if (!this.inBounds(gx, gy)) return 'street';
    const z = this.zones[this.idx(gx, gy)] || 'street';
    return z.startsWith('prop_') ? 'interior' : z;
  }
}
