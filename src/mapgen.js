// Procedural stealth-arena generator. Produces a compact grid of rooms/alleys
// connected by corridors, wrapped in walls, with props, light pools, an
// extraction pad, and floor "zones" (street / roof / interior) for theming.

import { makeRng, randInt, pick } from './utils.js';

export const TILE = 56; // world pixels per grid cell

// Cell types
export const VOID = 0;   // outside the play area (blocking, dark)
export const FLOOR = 1;  // walkable
export const WALL = 2;   // blocking, blocks vision

export class GameMap {
  constructor(seed, level) {
    this.seed = seed;
    this.level = level;
    this.rng = makeRng(seed);

    // Grow the arena slightly with level, capped for readability.
    this.cols = Math.min(16 + Math.floor(level / 2), 24);
    this.rows = Math.min(20 + Math.floor(level / 2), 30);

    this.cells = [];
    this.zones = [];   // per-cell theme: 'street' | 'roof' | 'interior'
    this.props = [];   // { gx, gy, type } lamps, crates, poles, plants
    this.floorTiles = []; // list of {gx,gy} walkable cells
    this.rooms = [];
    this.lights = [];  // { x, y, r } world-space light pools
    this.extract = null; // { gx, gy }

    this._generate();
  }

  idx(gx, gy) { return gy * this.cols + gx; }
  inBounds(gx, gy) { return gx >= 0 && gy >= 0 && gx < this.cols && gy < this.rows; }
  cellAt(gx, gy) { return this.inBounds(gx, gy) ? this.cells[this.idx(gx, gy)] : WALL; }

  worldWidth() { return this.cols * TILE; }
  worldHeight() { return this.rows * TILE; }

  // Is a world-space point blocked (wall/void)?
  isBlockedWorld(x, y) {
    const gx = Math.floor(x / TILE), gy = Math.floor(y / TILE);
    return this.cellAt(gx, gy) !== FLOOR;
  }

  isWallCell(gx, gy) {
    return this.cellAt(gx, gy) === WALL;
  }

  _generate() {
    const N = this.cols * this.rows;
    this.cells = new Array(N).fill(VOID);
    this.zones = new Array(N).fill('street');

    // Carve 4..7 rectangular rooms.
    const roomCount = randInt(this.rng, 4, 7);
    let attempts = 0;
    while (this.rooms.length < roomCount && attempts < 60) {
      attempts++;
      const w = randInt(this.rng, 4, 7);
      const h = randInt(this.rng, 4, 7);
      const x = randInt(this.rng, 1, this.cols - w - 1);
      const y = randInt(this.rng, 1, this.rows - h - 1);
      const room = { x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1) };
      // Allow gentle overlap but avoid full duplicates.
      let ok = true;
      for (const r of this.rooms) {
        if (Math.abs(r.cx - room.cx) < 3 && Math.abs(r.cy - room.cy) < 3) { ok = false; break; }
      }
      if (!ok) continue;
      const zone = pick(this.rng, ['street', 'interior', 'roof', 'street']);
      this._carveRoom(room, zone);
      this.rooms.push(room);
    }

    // Connect rooms with L-shaped corridors (in order for a connected graph).
    for (let i = 1; i < this.rooms.length; i++) {
      const a = this.rooms[i - 1], b = this.rooms[i];
      this._carveCorridor(a.cx, a.cy, b.cx, b.cy);
    }
    // A couple of extra links for looping routes (better patrols).
    for (let k = 0; k < 2 && this.rooms.length > 2; k++) {
      const a = pick(this.rng, this.rooms), b = pick(this.rng, this.rooms);
      if (a !== b) this._carveCorridor(a.cx, a.cy, b.cx, b.cy);
    }

    // Wall pass: any VOID cell orthogonally/diagonally adjacent to FLOOR becomes WALL.
    for (let gy = 0; gy < this.rows; gy++) {
      for (let gx = 0; gx < this.cols; gx++) {
        if (this.cells[this.idx(gx, gy)] !== VOID) continue;
        let touchFloor = false;
        for (let dy = -1; dy <= 1 && !touchFloor; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (this.cellAt(gx + dx, gy + dy) === FLOOR) { touchFloor = true; break; }
          }
        if (touchFloor) this.cells[this.idx(gx, gy)] = WALL;
      }
    }

    // Collect floor tiles.
    for (let gy = 0; gy < this.rows; gy++)
      for (let gx = 0; gx < this.cols; gx++)
        if (this.cells[this.idx(gx, gy)] === FLOOR) this.floorTiles.push({ gx, gy });

    this._placeProps();
    this._placeExtract();
  }

  _carveRoom(room, zone) {
    for (let y = room.y; y < room.y + room.h; y++)
      for (let x = room.x; x < room.x + room.w; x++) {
        if (!this.inBounds(x, y)) continue;
        this.cells[this.idx(x, y)] = FLOOR;
        this.zones[this.idx(x, y)] = zone;
      }
  }

  _carveCorridor(x0, y0, x1, y1) {
    const horizFirst = this.rng() < 0.5;
    const carve = (x, y) => {
      if (!this.inBounds(x, y)) return;
      if (this.cells[this.idx(x, y)] === VOID) {
        this.cells[this.idx(x, y)] = FLOOR;
        this.zones[this.idx(x, y)] = 'street';
      }
    };
    if (horizFirst) {
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) { carve(x, y0); carve(x, y0 + 1); }
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) { carve(x1, y); carve(x1 + 1, y); }
    } else {
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) { carve(x0, y); carve(x0 + 1, y); }
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) { carve(x, y1); carve(x, y1 + 1); }
    }
  }

  _placeProps() {
    const used = new Set();
    const claim = (gx, gy) => { used.add(gx + ',' + gy); };
    const isUsed = (gx, gy) => used.has(gx + ',' + gy);

    // Street lamps -> light pools. One per room-ish plus some scattered.
    const lampCount = 3 + Math.floor(this.rng() * 3);
    for (let i = 0; i < lampCount; i++) {
      const r = pick(this.rng, this.rooms);
      if (!r) break;
      const gx = r.cx + randInt(this.rng, -1, 1);
      const gy = r.cy + randInt(this.rng, -1, 1);
      if (this.cellAt(gx, gy) !== FLOOR || isUsed(gx, gy)) continue;
      claim(gx, gy);
      this.props.push({ gx, gy, type: 'lamp' });
      this.lights.push({ x: (gx + 0.5) * TILE, y: (gy + 0.5) * TILE, r: TILE * 2.4 });
    }

    // Crates (blockers) and plants / poles (cover, non-blocking visuals).
    const clutter = 4 + Math.floor(this.rng() * 5) + this.level;
    for (let i = 0; i < clutter; i++) {
      const t = pick(this.rng, this.floorTiles);
      if (!t || isUsed(t.gx, t.gy)) continue;
      const type = pick(this.rng, ['crate', 'crate', 'pole', 'plant']);
      claim(t.gx, t.gy);
      this.props.push({ gx: t.gx, gy: t.gy, type });
      if (type === 'crate') {
        // Crates block movement + vision like low walls.
        this.cells[this.idx(t.gx, t.gy)] = WALL;
        this.zones[this.idx(t.gx, t.gy)] = 'crate';
      }
    }
    // Refresh floor list (crates removed some).
    this.floorTiles = this.floorTiles.filter((t) => this.cells[this.idx(t.gx, t.gy)] === FLOOR);
  }

  _placeExtract() {
    // Extraction pad far from map center for a bit of routing.
    let best = null, bestD = -1;
    const cx = this.cols / 2, cy = this.rows / 2;
    for (const t of this.floorTiles) {
      const d = Math.hypot(t.gx - cx, t.gy - cy);
      if (d > bestD) { bestD = d; best = t; }
    }
    this.extract = best ? { gx: best.gx, gy: best.gy } : this.floorTiles[0];
  }

  // A random walkable world position, optionally far from (x,y).
  randomFloorPos(minDistFrom = null, minDist = 0) {
    for (let tries = 0; tries < 40; tries++) {
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
    return this.zones[this.idx(gx, gy)] || 'street';
  }
}
