// Isometric (2.5D) renderer — tilted "sort of 3D" POV like the reference.
// Gameplay is top-down world space; everything here projects to a 2:1 dimetric
// view: iso ground diamonds, extruded 3D walls/props, depth-sorted billboard
// characters, and vision cones projected onto the floor.

import { TILE, FLOOR, WALL } from './mapgen.js';
import { STATE } from './entities/enemy.js';
import { getSprite, SPRITE_W, SPRITE_H } from './sprites.js';
import { ISO, toIso } from './iso.js';
import { TAU, clamp } from './utils.js';

const A = ISO.a, B = ISO.b, WH = ISO.wallH;
const SPRITE_SCALE = 0.52;

// Bright, clean palette inspired by the reference.
const FLOOR_COL = { interior: '#d98f8c', street: '#c58a5f', roof: '#bd83a6' };
const FLOOR_COL2 = { interior: '#cf847f', street: '#bb7f54', roof: '#b0789a' }; // checker
const WALL_TOP = '#8a5079', WALL_L = '#542f4c', WALL_R = '#673a5c';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = { x: 0, y: 0 };
    this.offx = 0; this.offy = 0;
    this.rain = [];
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this._initRain();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(window.innerWidth * this.dpr);
    this.canvas.height = Math.floor(window.innerHeight * this.dpr);
    this.canvas.style.width = window.innerWidth + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
  }
  get vw() { return this.canvas.width / this.dpr; }
  get vh() { return this.canvas.height / this.dpr; }

  _initRain() {
    this.rain = [];
    for (let i = 0; i < 120; i++)
      this.rain.push({ x: Math.random(), y: Math.random(), len: 7 + Math.random() * 10, spd: 0.6 + Math.random() * 0.9 });
  }

  updateCamera(game, dt) {
    const p = toIso(game.player.x, game.player.y);
    this.cam.x += (p.x - this.cam.x) * Math.min(1, dt * 6);
    this.cam.y += (p.y - this.cam.y) * Math.min(1, dt * 6);
  }

  // Absolute screen position of a projected iso point.
  _s(wx, wy, wz = 0) { const p = toIso(wx, wy, wz); return { x: p.x + this.offx, y: p.y + this.offy }; }
  _vis(sx, sy, m = 90) { return sx > -m && sx < this.vw + m && sy > -m && sy < this.vh + m; }

  render(game, time) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    // Background gradient (deep purple night, but bright — not black).
    const bg = ctx.createLinearGradient(0, 0, 0, this.vh);
    bg.addColorStop(0, '#3a2440'); bg.addColorStop(1, '#241531');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, this.vw, this.vh);

    this.offx = Math.round(this.vw / 2 - this.cam.x);
    this.offy = Math.round(this.vh / 2 - this.cam.y);

    this._drawGround(game, time);
    this._drawGroundDecals(game, time);
    this._drawVisionCones(game);
    this._drawSortedObjects(game, time);
    this._drawOverlays(game, time);

    this._drawRain(ctx, time);
    this._drawVignette(ctx);
    this._drawJoystick(ctx, game.input);
  }

  _cellBounds(map) {
    // Iterate all cells but the visible test culls; maps are small enough.
    return { c0: 0, r0: 0, c1: map.cols, r1: map.rows };
  }

  _diamond(ctx, cx, cy, a = A, b = B) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - b); ctx.lineTo(cx + a, cy); ctx.lineTo(cx, cy + b); ctx.lineTo(cx - a, cy); ctx.closePath();
  }

  _drawGround(game, time) {
    const ctx = this.ctx, map = game.map;
    const { c0, r0, c1, r1 } = this._cellBounds(map);
    for (let gy = r0; gy < r1; gy++)
      for (let gx = c0; gx < c1; gx++) {
        const cell = map.cells[map.idx(gx, gy)];
        const zone = map.zones[map.idx(gx, gy)];
        const isProp = cell === WALL && zone.startsWith('prop_');
        if (cell !== FLOOR && !isProp) continue;
        const s = this._s((gx + 0.5) * TILE, (gy + 0.5) * TILE);
        if (!this._vis(s.x, s.y, 60)) continue;
        const z = isProp ? 'interior' : zone;
        const checker = (gx + gy) & 1;
        ctx.fillStyle = (checker ? FLOOR_COL2 : FLOOR_COL)[z] || FLOOR_COL.street;
        this._diamond(ctx, s.x, s.y); ctx.fill();
        // Soft edge line for tile definition.
        ctx.strokeStyle = 'rgba(60,30,55,0.14)'; ctx.lineWidth = 1; ctx.stroke();
      }
  }

  _drawGroundDecals(game, time) {
    const ctx = this.ctx, map = game.map;
    for (const d of map.decos) {
      const s = this._s((d.gx + 0.5) * TILE, (d.gy + 0.5) * TILE);
      if (!this._vis(s.x, s.y, 40)) continue;
      if (d.type === 'rug') {
        ctx.fillStyle = 'rgba(90,40,80,0.28)'; this._diamond(ctx, s.x, s.y, A * 0.8, B * 0.8); ctx.fill();
      } else if (d.type === 'puddle') {
        ctx.fillStyle = 'rgba(150,200,235,0.18)'; ctx.beginPath(); ctx.ellipse(s.x, s.y, A * 0.5, B * 0.5, 0, 0, TAU); ctx.fill();
      } else if (d.type === 'grate') {
        ctx.strokeStyle = 'rgba(40,20,40,0.4)'; ctx.lineWidth = 1.5;
        this._diamond(ctx, s.x, s.y, A * 0.55, B * 0.55); ctx.stroke();
      } else if (d.type === 'crack') {
        ctx.strokeStyle = 'rgba(40,20,35,0.3)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(s.x - 10, s.y - 3); ctx.lineTo(s.x + 4, s.y + 4); ctx.lineTo(s.x + 12, s.y - 2); ctx.stroke();
      }
    }
    // Light pools (additive, on floor).
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const L of map.lights) {
      const s = this._s(L.x, L.y);
      if (!this._vis(s.x, s.y, L.r)) continue;
      const fl = 0.85 + Math.sin(time * 9 + L.x) * 0.05;
      const g = ctx.createRadialGradient(s.x, s.y, 4, s.x, s.y, L.r);
      g.addColorStop(0, `rgba(255,235,180,${0.28 * fl})`); g.addColorStop(1, 'rgba(255,220,160,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(s.x, s.y, L.r, L.r * (B / A), 0, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  _drawVisionCones(game) {
    const ctx = this.ctx;
    for (const e of game.enemies) {
      if (e.downed || e.stun > 0) continue;
      const es = this._s(e.x, e.y);
      if (!this._vis(es.x, es.y, e.visionRange)) continue;
      let color;
      switch (e.state) {
        case STATE.COMBAT: case STATE.ALERTED: color = 'rgba(255,70,70,'; break;
        case STATE.SUSPICIOUS: color = 'rgba(255,180,50,'; break;
        case STATE.SEARCHING: color = 'rgba(255,130,50,'; break;
        default: color = 'rgba(255,250,150,';
      }
      const half = e.state === STATE.COMBAT ? e.visionHalf + 0.3 : e.visionHalf;
      const steps = 14;
      ctx.beginPath();
      const o = this._s(e.x, e.y); ctx.moveTo(o.x, o.y);
      for (let i = 0; i <= steps; i++) {
        const a = e.angle - half + (2 * half) * (i / steps);
        const r = this._rayLen(game, e.x, e.y, a, e.visionRange);
        const p = this._s(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r);
        ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.fillStyle = color + '0.20)'; ctx.fill();
      ctx.strokeStyle = color + '0.35)'; ctx.lineWidth = 1; ctx.stroke();
    }
    // Extract/elevator ground ring.
    this._drawElevatorPad(game);
    // Web traps + alert pings (ground).
    for (const w of game.webTraps) {
      const s = this._s(w.x, w.y);
      ctx.save(); ctx.translate(s.x, s.y); ctx.scale(1, B / A);
      ctx.strokeStyle = `rgba(235,240,255,${0.6 * clamp(w.life / w.duration, 0, 1)})`; ctx.lineWidth = 1.5;
      for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * w.radius, Math.sin(a) * w.radius); ctx.stroke(); }
      for (let r = 1; r <= 3; r++) { ctx.beginPath(); ctx.arc(0, 0, w.radius * r / 3, 0, TAU); ctx.stroke(); }
      ctx.restore();
    }
    for (const a of game.alertPings) {
      const s = this._s(a.x, a.y); const t = 1 - a.life / a.max;
      ctx.strokeStyle = `rgba(255,80,80,${a.life / a.max})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(s.x, s.y, (10 + t * 60), (10 + t * 60) * (B / A), 0, 0, TAU); ctx.stroke();
    }
  }

  _drawElevatorPad(game) {
    if (!game.map.extract) return;
    const ctx = this.ctx;
    const wx = (game.map.extract.gx + 0.5) * TILE, wy = (game.map.extract.gy + 0.5) * TILE;
    const s = this._s(wx, wy);
    const active = game.enemiesRemaining() === 0;
    ctx.save(); ctx.translate(s.x, s.y); ctx.scale(1, B / A);
    const col = active ? 'rgba(90,255,170,' : 'rgba(150,170,200,';
    const pulse = active ? 0.5 + Math.sin(game.time * 4) * 0.5 : 0;
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = col + (active ? 0.6 - i * 0.15 : 0.25) + ')'; ctx.lineWidth = active ? 3 : 2;
      ctx.beginPath(); ctx.arc(0, 0, 16 + i * 9 + pulse * 6, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }

  _rayLen(game, x, y, a, maxR) {
    const step = TILE * 0.35, dx = Math.cos(a), dy = Math.sin(a);
    let r = step;
    while (r < maxR) { if (game.map.isBlockedWorld(x + dx * r, y + dy * r)) return r; r += step; }
    return maxR;
  }

  // 3D iso box: ground center (cx,cy), screen half-footprint (hw,hh), height h.
  _isoBox(cx, cy, hw, hh, h, top, lf, rf) {
    const ctx = this.ctx;
    const T = [cx, cy - hh], R = [cx + hw, cy], Bt = [cx, cy + hh], L = [cx - hw, cy];
    // Left face (L-B).
    ctx.fillStyle = lf; ctx.beginPath();
    ctx.moveTo(L[0], L[1]); ctx.lineTo(Bt[0], Bt[1]); ctx.lineTo(Bt[0], Bt[1] - h); ctx.lineTo(L[0], L[1] - h); ctx.closePath(); ctx.fill();
    // Right face (B-R).
    ctx.fillStyle = rf; ctx.beginPath();
    ctx.moveTo(Bt[0], Bt[1]); ctx.lineTo(R[0], R[1]); ctx.lineTo(R[0], R[1] - h); ctx.lineTo(Bt[0], Bt[1] - h); ctx.closePath(); ctx.fill();
    // Top face.
    ctx.fillStyle = top; ctx.beginPath();
    ctx.moveTo(T[0], T[1] - h); ctx.lineTo(R[0], R[1] - h); ctx.lineTo(Bt[0], Bt[1] - h); ctx.lineTo(L[0], L[1] - h); ctx.closePath(); ctx.fill();
  }

  _drawSortedObjects(game, time) {
    const map = game.map;
    const objs = [];

    // Walls (non-prop).
    const { c0, r0, c1, r1 } = this._cellBounds(map);
    for (let gy = r0; gy < r1; gy++)
      for (let gx = c0; gx < c1; gx++) {
        if (map.cells[map.idx(gx, gy)] !== WALL) continue;
        if (map.zones[map.idx(gx, gy)].startsWith('prop_')) continue;
        const s = this._s((gx + 0.5) * TILE, (gy + 0.5) * TILE);
        if (!this._vis(s.x, s.y, 60)) continue;
        objs.push({ d: gx + gy + 1, f: () => this._isoBox(s.x, s.y, A, B, WH, WALL_TOP, WALL_L, WALL_R) });
      }

    // Props.
    for (const pr of map.props) {
      const s = this._s((pr.gx + 0.5) * TILE, (pr.gy + 0.5) * TILE);
      if (!this._vis(s.x, s.y, 60)) continue;
      objs.push({ d: pr.gx + pr.gy + 1, f: () => this._drawProp(pr, s.x, s.y, time) });
    }

    // Elevator structure.
    if (map.extract) {
      const s = this._s((map.extract.gx + 0.5) * TILE, (map.extract.gy + 0.5) * TILE);
      objs.push({ d: map.extract.gx + map.extract.gy + 1, f: () => this._drawElevator(game, s.x, s.y, time) });
    }

    // Enemies + player (billboards).
    for (const e of game.enemies) {
      const s = this._s(e.x, e.y);
      if (!this._vis(s.x, s.y, 50)) continue;
      objs.push({ d: e.x / TILE + e.y / TILE, f: () => this._drawEnemy(e, s.x, s.y, time) });
    }
    const ps = this._s(game.player.x, game.player.y);
    objs.push({ d: game.player.x / TILE + game.player.y / TILE + 0.01, f: () => this._drawPlayer(game, ps.x, ps.y, time) });

    objs.sort((p, q) => p.d - q.d);
    for (const o of objs) o.f();
  }

  _drawProp(pr, cx, cy, time) {
    const ctx = this.ctx;
    switch (pr.type) {
      case 'crate': this._isoBox(cx, cy, A * 0.62, B * 0.62, 24, '#7a5a30', '#4a3418', '#5c4322');
        ctx.strokeStyle = '#3a2a14'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx, cy - 24); ctx.lineTo(cx, cy - 24 + 8); ctx.stroke(); break;
      case 'barrel': this._isoBox(cx, cy, A * 0.42, B * 0.42, 30, '#5c7488', '#324150', '#425666'); break;
      case 'desk': this._isoBox(cx, cy, A * 0.7, B * 0.7, 16, '#3a3350', '#221d33', '#2b2440');
        ctx.fillStyle = 'rgba(120,180,255,0.55)'; ctx.fillRect(cx - 7, cy - 20, 14, 7); break;
      case 'locker': this._isoBox(cx, cy, A * 0.5, B * 0.5, 40, '#5a6572', '#333c46', '#454f5b'); break;
      case 'lamp':
        ctx.fillStyle = '#2a3040'; ctx.fillRect(cx - 2, cy - 30, 4, 30);
        ctx.fillStyle = `rgba(255,235,170,${0.85 + Math.sin(time * 9 + cx) * 0.12})`; ctx.beginPath(); ctx.arc(cx, cy - 32, 6, 0, TAU); ctx.fill(); break;
      case 'plant':
        ctx.fillStyle = '#5a3a24'; ctx.beginPath(); ctx.ellipse(cx, cy, 12, 6, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#2fa38c';
        ctx.beginPath(); ctx.ellipse(cx - 6, cy - 12, 7, 12, -0.4, 0, TAU); ctx.ellipse(cx + 6, cy - 12, 7, 12, 0.4, 0, TAU); ctx.ellipse(cx, cy - 20, 7, 13, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(150,230,190,0.3)'; ctx.beginPath(); ctx.ellipse(cx, cy - 20, 3, 6, 0, 0, TAU); ctx.fill(); break;
      case 'pole':
        ctx.fillStyle = '#20252f'; ctx.fillRect(cx - 2, cy - 34, 4, 34); ctx.fillStyle = '#2c333f'; ctx.fillRect(cx - 10, cy - 34, 20, 4); break;
    }
  }

  _drawElevator(game, cx, cy, time) {
    const active = game.enemiesRemaining() === 0;
    // Shaft box.
    this._isoBox(cx, cy, A * 0.92, B * 0.92, WH + 6, '#3d4658', '#232a36', '#2f3846');
    const ctx = this.ctx;
    // Door on the front-right face.
    const doorTop = cy - WH - 2, doorH = WH + 2;
    ctx.fillStyle = active ? '#123' : '#181d26';
    ctx.beginPath(); ctx.moveTo(cx, cy + B * 0.92); ctx.lineTo(cx + A * 0.5, cy + B * 0.46); ctx.lineTo(cx + A * 0.5, cy + B * 0.46 - doorH); ctx.lineTo(cx, cy + B * 0.92 - doorH); ctx.closePath(); ctx.fill();
    // Glow strip + label when active.
    if (active) {
      const pulse = 0.6 + Math.sin(time * 5) * 0.4;
      ctx.strokeStyle = `rgba(90,255,170,${pulse})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cx + 2, cy + B * 0.9 - 4); ctx.lineTo(cx + A * 0.48, cy + B * 0.46 - 4); ctx.stroke();
    }
    ctx.fillStyle = active ? `rgba(140,255,200,${0.7 + Math.sin(time * 5) * 0.25})` : 'rgba(170,185,205,0.7)';
    ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center';
    ctx.fillText(active ? '▲ UP' : 'LIFT', cx, cy - WH - 12);
  }

  _shadow(cx, cy, r = A * 0.5) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(30,10,30,0.35)';
    ctx.beginPath(); ctx.ellipse(cx, cy, r, r * (B / A), 0, 0, TAU); ctx.fill();
  }

  _drawSprite(kind, cx, cy, angle, frame, bob) {
    const ctx = this.ctx;
    const cv = getSprite(kind, frame);
    const w = SPRITE_W * SPRITE_SCALE, h = SPRITE_H * SPRITE_SCALE;
    const facingLeft = (Math.cos(angle) - Math.sin(angle)) < 0; // screen-space facing
    ctx.save();
    ctx.translate(Math.round(cx), Math.round(cy - h + 6 + (bob || 0)));
    if (facingLeft) { ctx.translate(Math.round(w), 0); ctx.scale(-1, 1); }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cv, Math.round(-w / 2), 0, Math.round(w), Math.round(h));
    ctx.restore();
  }

  _drawEnemy(e, cx, cy, time) {
    const ctx = this.ctx;
    if (e.downed) {
      this._shadow(cx, cy);
      ctx.strokeStyle = 'rgba(120,40,40,0.8)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cx - 8, cy - 4); ctx.lineTo(cx + 8, cy + 4); ctx.moveTo(cx + 8, cy - 4); ctx.lineTo(cx - 8, cy + 4); ctx.stroke();
      return;
    }
    this._shadow(cx, cy);
    const hostile = e.state === STATE.COMBAT || e.state === STATE.ALERTED;
    const moving = e.state !== STATE.IDLE && e.rooted <= 0 && e.stun <= 0;
    const frame = moving ? Math.floor(time * 6 + e.x * 0.05) % 2 : 0;
    const bob = moving ? Math.abs(Math.sin(time * 8 + e.x)) * -2 : 0;
    ctx.save(); if (e.stun > 0) ctx.globalAlpha = 0.7;
    this._drawSprite(hostile ? 'enemyHot' : 'enemy', cx, cy, e.angle, frame, bob);
    ctx.restore();
    const glyph = e.stun > 0 ? '★' : e.rooted > 0 ? '🕸'
      : e.state === STATE.SUSPICIOUS || e.state === STATE.SEARCHING ? '?'
      : (e.state === STATE.ALERTED || e.state === STATE.COMBAT) ? '!' : '';
    if (glyph) {
      ctx.fillStyle = (e.state === STATE.ALERTED || e.state === STATE.COMBAT) ? '#ff5252' : '#ffce4a';
      ctx.font = 'bold 16px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(glyph, cx, cy - 44 + Math.sin(time * 6) * 1.5);
    }
  }

  _drawPlayer(game, cx, cy, time) {
    const ctx = this.ctx, p = game.player;
    this._shadow(cx, cy, A * 0.55);
    // Ground ring (iso ellipse) in hero accent.
    ctx.save(); ctx.translate(cx, cy); ctx.scale(1, B / A);
    ctx.strokeStyle = this._hexA(p.hero.accent, p.hidden ? 0.35 : 0.9); ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(0, 0, A * 0.5, 0, TAU); ctx.stroke();
    ctx.restore();

    let ox = 0, oy = 0;
    if (p.takedownAnim > 0) { const k = Math.sin((1 - p.takedownAnim / 0.22) * Math.PI) * 8; const d = toIso(Math.cos(p.angle), Math.sin(p.angle)); ox = d.x * k * 0.14; oy = d.y * k * 0.14; }
    const bob = (p.moving && !p.dashing) ? Math.abs(Math.sin(time * 9)) * -2 : 0;
    ctx.save(); if (p.hidden) ctx.globalAlpha = 0.55;
    this._drawSprite(p.hero.spriteKind, cx + ox, cy + oy, p.angle, p.frame, bob);
    ctx.restore();
    if (p.hidden) { ctx.fillStyle = 'rgba(220,235,255,0.6)'; ctx.font = '11px system-ui'; ctx.textAlign = 'center'; ctx.fillText('hidden', cx, cy - 46); }
  }

  _drawOverlays(game, time) {
    const ctx = this.ctx;
    // Grapple rope.
    const p = game.player;
    if (p.rope) {
      const a = this._s(p.x, p.y, 20), b = this._s(p.rope.ax, p.rope.ay, 6);
      ctx.strokeStyle = `rgba(230,230,240,${clamp(p.rope.t / 0.35, 0, 1) * 0.85})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.fillStyle = '#d0d3dc'; ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, TAU); ctx.fill();
    }
    // Zip trails.
    for (const t of game.zipTrails) { const s = this._s(t.x, t.y, 14); ctx.strokeStyle = `rgba(230,180,255,${t.life * 0.8})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(s.x, s.y, 4, 0, TAU); ctx.stroke(); }
    // Projectiles.
    for (const pr of game.projectiles) {
      const s = this._s(pr.x, pr.y, 16);
      if (pr.type === 'billyclub') {
        ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(pr.spin);
        ctx.fillStyle = '#111'; ctx.fillRect(-10, -3, 20, 5); ctx.fillStyle = '#e23b3b'; ctx.fillRect(0, -3, 10, 5); ctx.restore();
      } else if (pr.type === 'batarang') {
        ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(pr.spin);
        ctx.fillStyle = '#1a2036'; ctx.beginPath();
        ctx.moveTo(-11, 0); ctx.lineTo(-3, -3); ctx.lineTo(0, -9); ctx.lineTo(3, -3); ctx.lineTo(11, 0); ctx.lineTo(3, 3); ctx.lineTo(0, 9); ctx.lineTo(-3, 3); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(120,150,255,0.6)'; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
      } else if (pr.type === 'web') {
        ctx.strokeStyle = 'rgba(240,245,255,0.9)'; ctx.lineWidth = 2; const b = this._s(pr.x - pr.vx * 0.03, pr.y - pr.vy * 0.03, 16);
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.fillStyle = '#eef2ff'; ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, TAU); ctx.fill();
      } else if (pr.type === 'bullet') {
        ctx.strokeStyle = 'rgba(255,120,90,0.95)'; ctx.lineWidth = 3; const b = this._s(pr.x - pr.vx * 0.02, pr.y - pr.vy * 0.02, 16);
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    }
    // Smoke.
    for (const sm of game.smokes) {
      const a = clamp(sm.life / sm.duration, 0, 1);
      ctx.save(); ctx.globalAlpha = 0.7 * Math.min(1, a * 2);
      for (let i = 0; i < 6; i++) {
        const ang = i / 6 * TAU + time * 0.3;
        // Keep the puff radius strictly positive — a negative radius throws.
        const rr = Math.max(6, sm.radius * (0.5 + 0.4 * Math.sin(time + i)));
        const c = this._s(sm.x + Math.cos(ang) * sm.radius * 0.4, sm.y + Math.sin(ang) * sm.radius * 0.4, 18);
        const g = ctx.createRadialGradient(c.x, c.y, 2, c.x, c.y, rr);
        g.addColorStop(0, 'rgba(210,215,225,0.5)'); g.addColorStop(1, 'rgba(170,175,190,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.x, c.y, rr, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
    // Radar reveal.
    if (game.player.radarTimer > 0) {
      const al = clamp(game.player.radarTimer / 1, 0, 1);
      for (const e of game.enemies) {
        if (e.downed) continue; const s = this._s(e.x, e.y, 26);
        ctx.strokeStyle = `rgba(255,80,80,${0.5 * al})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(s.x, s.y, 12, 0, TAU); ctx.stroke();
      }
    }
    // Floaters.
    ctx.save(); ctx.textAlign = 'center'; ctx.font = 'bold 13px system-ui';
    for (const f of game.floaters) { const s = this._s(f.x, f.y, 30); ctx.globalAlpha = clamp(f.life, 0, 1); ctx.fillStyle = f.color || '#fff'; ctx.fillText(f.text, s.x, s.y - (1 - f.life) * 10); }
    ctx.restore();
  }

  _drawRain(ctx, time) {
    ctx.save(); ctx.strokeStyle = 'rgba(200,210,240,0.14)'; ctx.lineWidth = 1;
    const w = this.vw, h = this.vh;
    for (const d of this.rain) {
      const x = d.x * w, y = ((d.y + (time * d.spd) % 1) % 1) * h;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 2, y + d.len); ctx.stroke();
    }
    ctx.restore();
  }

  _drawVignette(ctx) {
    const g = ctx.createRadialGradient(this.vw / 2, this.vh / 2, this.vh * 0.42, this.vw / 2, this.vh / 2, this.vh * 0.85);
    g.addColorStop(0, 'rgba(20,10,25,0)'); g.addColorStop(1, 'rgba(18,8,24,0.42)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, this.vw, this.vh);
  }

  _drawJoystick(ctx, input) {
    if (!input || !input.joy.active) return;
    const j = input.joy;
    ctx.save(); ctx.strokeStyle = 'rgba(230,230,255,0.4)'; ctx.fillStyle = 'rgba(160,150,220,0.14)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(j.ox, j.oy, 60, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(230,230,255,0.5)'; ctx.beginPath(); ctx.arc(j.cx, j.cy, 26, 0, TAU); ctx.fill();
    ctx.restore();
  }

  _hexA(hex, a) {
    const h = hex.replace('#', '');
    return `rgba(${parseInt(h.substring(0, 2), 16)},${parseInt(h.substring(2, 4), 16)},${parseInt(h.substring(4, 6), 16)},${a})`;
  }
}
