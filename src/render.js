// All canvas drawing: rainy-compound atmosphere, detailed map + props, pixel-art
// characters, vision cones, signature projectiles and gadget effects.

import { TILE, FLOOR, WALL } from './mapgen.js';
import { STATE } from './entities/enemy.js';
import { getSprite, SPRITE_W, SPRITE_H } from './sprites.js';
import { TAU, clamp } from './utils.js';

const SPRITE_SCALE = 0.5; // on-screen sprite height ~ SPRITE_H * scale

const ZONE_FLOOR = {
  street: '#232a3b',
  interior: '#332b42',
  roof: '#213041',
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = { x: 0, y: 0 };
    this.rain = [];
    this.splashes = [];
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
    for (let i = 0; i < 240; i++)
      this.rain.push({ x: Math.random(), y: Math.random(), len: 8 + Math.random() * 14, spd: 0.5 + Math.random() * 0.9 });
  }

  updateCamera(game, dt) {
    const p = game.player;
    const tx = p.x - this.vw / 2, ty = p.y - this.vh / 2;
    this.cam.x += (tx - this.cam.x) * Math.min(1, dt * 6);
    this.cam.y += (ty - this.cam.y) * Math.min(1, dt * 6);
    const margin = 100;
    const maxX = game.map.worldWidth() - this.vw + margin;
    const maxY = game.map.worldHeight() - this.vh + margin;
    this.cam.x = clamp(this.cam.x, -margin, Math.max(-margin, maxX));
    this.cam.y = clamp(this.cam.y, -margin, Math.max(-margin, maxY));
  }

  render(game, time) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#06080f';
    ctx.fillRect(0, 0, this.vw, this.vh);

    ctx.save();
    ctx.translate(-Math.round(this.cam.x), -Math.round(this.cam.y));

    this._drawFloorsAndDecos(game);
    this._drawWalls(game);
    this._drawProps(game, time);
    this._drawLights(game, time);
    this._drawExtract(game, time);
    this._drawWebTraps(game, time);
    this._drawSmoke(game, time);
    this._drawVisionCones(game);
    this._drawGrapple(game);
    this._drawEnemies(game, time);
    this._drawProjectiles(game, time);
    this._drawZipTrails(game);
    this._drawPlayer(game, time);
    this._drawRadar(game);
    this._drawAlerts(game, time);
    this._drawFloaters(game);

    ctx.restore();

    this._drawRain(ctx, time);
    this._drawFog(ctx);
    this._drawJoystick(ctx, game.input);
  }

  _visible(x, y, pad = TILE) {
    return x + pad > this.cam.x && x - pad < this.cam.x + this.vw &&
           y + pad > this.cam.y && y - pad < this.cam.y + this.vh;
  }

  _bounds(map) {
    return {
      c0: Math.max(0, Math.floor(this.cam.x / TILE)),
      r0: Math.max(0, Math.floor(this.cam.y / TILE)),
      c1: Math.min(map.cols, Math.ceil((this.cam.x + this.vw) / TILE) + 1),
      r1: Math.min(map.rows, Math.ceil((this.cam.y + this.vh) / TILE) + 1),
    };
  }

  _drawFloorsAndDecos(game) {
    const ctx = this.ctx, map = game.map;
    const { c0, r0, c1, r1 } = this._bounds(map);
    for (let gy = r0; gy < r1; gy++)
      for (let gx = c0; gx < c1; gx++) {
        const cell = map.cells[map.idx(gx, gy)];
        const zone = map.zones[map.idx(gx, gy)];
        const isProp = cell === WALL && zone.startsWith('prop_');
        if (cell !== FLOOR && !isProp) continue;
        const x = gx * TILE, y = gy * TILE;
        const baseZone = isProp ? 'interior' : zone;
        ctx.fillStyle = ZONE_FLOOR[baseZone] || ZONE_FLOOR.street;
        ctx.fillRect(x, y, TILE, TILE);
        // Subtle checker + grout for texture.
        if ((gx + gy) & 1) { ctx.fillStyle = 'rgba(255,255,255,0.018)'; ctx.fillRect(x, y, TILE, TILE); }
        ctx.strokeStyle = 'rgba(130,160,210,0.05)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
      }

    // Decorations.
    for (const d of map.decos) {
      const x = d.gx * TILE, y = d.gy * TILE;
      if (!this._visible(x + TILE / 2, y + TILE / 2)) continue;
      if (d.type === 'rug') {
        ctx.fillStyle = 'rgba(150,70,90,0.16)';
        ctx.fillRect(x + 3, y + 3, TILE - 6, TILE - 6);
        ctx.strokeStyle = 'rgba(220,160,120,0.14)';
        ctx.strokeRect(x + 6, y + 6, TILE - 12, TILE - 12);
      } else if (d.type === 'puddle') {
        ctx.fillStyle = 'rgba(120,170,220,0.10)';
        ctx.beginPath(); ctx.ellipse(x + TILE / 2, y + TILE / 2, TILE * 0.32, TILE * 0.2, 0, 0, TAU); ctx.fill();
      } else if (d.type === 'grate') {
        ctx.strokeStyle = 'rgba(20,26,40,0.6)'; ctx.lineWidth = 2;
        for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x + 10, y + i * TILE / 4); ctx.lineTo(x + TILE - 10, y + i * TILE / 4); ctx.stroke(); }
      } else if (d.type === 'crack') {
        ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x + 12, y + 14); ctx.lineTo(x + 26, y + 30); ctx.lineTo(x + 40, y + 22); ctx.stroke();
      }
    }
  }

  _drawWalls(game) {
    const ctx = this.ctx, map = game.map;
    const { c0, r0, c1, r1 } = this._bounds(map);
    for (let gy = r0; gy < r1; gy++)
      for (let gx = c0; gx < c1; gx++) {
        if (map.cells[map.idx(gx, gy)] !== WALL) continue;
        if (map.zones[map.idx(gx, gy)].startsWith('prop_')) continue; // drawn as prop
        const x = gx * TILE, y = gy * TILE;
        const openBelow = map.cellAt(gx, gy + 1) === FLOOR;
        // Body.
        ctx.fillStyle = '#0e111b';
        ctx.fillRect(x, y, TILE, TILE);
        // Top face.
        ctx.fillStyle = '#1b2233';
        ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 6);
        // Rim light on top.
        ctx.fillStyle = 'rgba(120,160,220,0.12)';
        ctx.fillRect(x + 2, y + 2, TILE - 4, 3);
        // Cast a soft face/shadow where a wall meets open floor below.
        if (openBelow) { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x, y + TILE - 2, TILE, 8); }
      }
  }

  _drawProps(game, time) {
    const ctx = this.ctx;
    for (const pr of game.map.props) {
      const cx = (pr.gx + 0.5) * TILE, cy = (pr.gy + 0.5) * TILE;
      if (!this._visible(cx, cy)) continue;
      // Shadow.
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.ellipse(cx, cy + 14, 18, 8, 0, 0, TAU); ctx.fill();
      switch (pr.type) {
        case 'crate': this._crate(ctx, cx, cy); break;
        case 'barrel': this._barrel(ctx, cx, cy); break;
        case 'desk': this._desk(ctx, cx, cy); break;
        case 'locker': this._locker(ctx, cx, cy); break;
        case 'lamp': this._lamp(ctx, cx, cy, time); break;
        case 'plant': this._plant(ctx, cx, cy); break;
        case 'pole': this._pole(ctx, cx, cy); break;
      }
    }
  }

  _crate(ctx, x, y) {
    const s = 20;
    ctx.fillStyle = '#5a4123'; ctx.fillRect(x - s, y - s + 6, s * 2, s * 2 - 4);
    ctx.fillStyle = '#6e5230'; ctx.fillRect(x - s + 2, y - s + 8, s * 2 - 4, s * 2 - 10);
    ctx.strokeStyle = '#3a2a16'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - s + 2, y - s + 8); ctx.lineTo(x + s - 2, y + s - 4); ctx.moveTo(x + s - 2, y - s + 8); ctx.lineTo(x - s + 2, y + s - 4); ctx.stroke();
    ctx.fillStyle = 'rgba(255,220,150,0.12)'; ctx.fillRect(x - s + 2, y - s + 8, s * 2 - 4, 3);
  }
  _barrel(ctx, x, y) {
    ctx.fillStyle = '#3a4b5a'; ctx.fillRect(x - 14, y - 16, 28, 34);
    ctx.fillStyle = '#4c6274'; ctx.fillRect(x - 12, y - 16, 24, 34);
    ctx.strokeStyle = '#2a3540'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - 12, y - 4); ctx.lineTo(x + 12, y - 4); ctx.moveTo(x - 12, y + 8); ctx.lineTo(x + 12, y + 8); ctx.stroke();
    ctx.fillStyle = '#63809a'; ctx.beginPath(); ctx.ellipse(x, y - 16, 12, 5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.beginPath(); ctx.ellipse(x - 3, y - 17, 6, 2.5, 0, 0, TAU); ctx.fill();
  }
  _desk(ctx, x, y) {
    ctx.fillStyle = '#2b2436'; ctx.fillRect(x - 22, y - 12, 44, 26);
    ctx.fillStyle = '#3a3350'; ctx.fillRect(x - 22, y - 14, 44, 6);
    // Monitor glow.
    ctx.fillStyle = '#1a2a44'; ctx.fillRect(x - 8, y - 10, 16, 10);
    ctx.fillStyle = 'rgba(110,180,255,0.5)'; ctx.fillRect(x - 6, y - 8, 12, 6);
  }
  _locker(ctx, x, y) {
    ctx.fillStyle = '#39414f'; ctx.fillRect(x - 16, y - 22, 32, 40);
    ctx.fillStyle = '#4a5566'; ctx.fillRect(x - 14, y - 22, 30, 40);
    ctx.strokeStyle = '#2a323d'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y - 22); ctx.lineTo(x, y + 18); ctx.stroke();
    ctx.fillStyle = '#22282f'; ctx.fillRect(x - 5, y - 4, 3, 6); ctx.fillRect(x + 2, y - 4, 3, 6);
    ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(x - 14, y - 22, 30, 3);
  }
  _lamp(ctx, x, y, time) {
    ctx.fillStyle = '#2a3040'; ctx.fillRect(x - 3, y - 4, 6, 18);
    const fl = 0.8 + Math.sin(time * 9 + x) * 0.15;
    ctx.fillStyle = `rgba(150,200,255,${fl})`;
    ctx.beginPath(); ctx.arc(x, y - 8, 6, 0, TAU); ctx.fill();
  }
  _plant(ctx, x, y) {
    ctx.fillStyle = '#3a2a1e'; ctx.fillRect(x - 8, y + 2, 16, 12);
    ctx.fillStyle = '#2f6b3a';
    ctx.beginPath(); ctx.arc(x - 5, y - 2, 8, 0, TAU); ctx.arc(x + 6, y - 4, 7, 0, TAU); ctx.arc(x, y - 10, 9, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(120,220,140,0.25)'; ctx.beginPath(); ctx.arc(x - 2, y - 10, 4, 0, TAU); ctx.fill();
  }
  _pole(ctx, x, y) {
    ctx.fillStyle = '#20252f'; ctx.fillRect(x - 3, y - 20, 6, 38);
    ctx.fillStyle = '#2c333f'; ctx.fillRect(x - 12, y - 20, 24, 4);
  }

  _drawLights(game, time) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const L of game.map.lights) {
      if (!this._visible(L.x, L.y, L.r)) continue;
      const flick = 0.85 + Math.sin(time * 9 + L.x) * 0.05;
      const g = ctx.createRadialGradient(L.x, L.y, 4, L.x, L.y, L.r);
      g.addColorStop(0, `rgba(120,190,255,${0.32 * flick})`);
      g.addColorStop(0.4, `rgba(90,140,220,${0.12 * flick})`);
      g.addColorStop(1, 'rgba(60,90,160,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(L.x, L.y, L.r, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  _drawExtract(game, time) {
    if (!game.map.extract) return;
    const ctx = this.ctx;
    const ex = (game.map.extract.gx + 0.5) * TILE, ey = (game.map.extract.gy + 0.5) * TILE;
    const active = game.enemiesRemaining() === 0;
    const pulse = 0.5 + Math.sin(time * 4) * 0.5;
    ctx.save();
    ctx.translate(ex, ey);
    const col = active ? 'rgba(80,255,160,' : 'rgba(120,150,180,';
    for (let i = 0; i < 3; i++) {
      const r = 12 + i * 10 + (active ? pulse * 8 : 0);
      ctx.strokeStyle = col + (active ? 0.6 - i * 0.15 : 0.25 - i * 0.06) + ')';
      ctx.lineWidth = active ? 3 : 2;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
    }
    ctx.fillStyle = active ? `rgba(120,255,190,${0.6 + pulse * 0.3})` : 'rgba(150,170,190,0.4)';
    ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(active ? 'EXTRACT' : 'LOCKED', 0, -30);
    ctx.restore();
  }

  _drawVisionCones(game) {
    const ctx = this.ctx;
    for (const e of game.enemies) {
      if (e.downed || e.stun > 0) continue;
      if (!this._visible(e.x, e.y, e.visionRange)) continue;
      let color;
      switch (e.state) {
        case STATE.COMBAT: case STATE.ALERTED: color = 'rgba(255,60,60,'; break;
        case STATE.SUSPICIOUS: color = 'rgba(255,170,40,'; break;
        case STATE.SEARCHING: color = 'rgba(255,120,40,'; break;
        default: color = 'rgba(255,240,120,';
      }
      const half = e.state === STATE.COMBAT ? e.visionHalf + 0.3 : e.visionHalf;
      const steps = 16;
      ctx.beginPath(); ctx.moveTo(e.x, e.y);
      for (let i = 0; i <= steps; i++) {
        const a = e.angle - half + (2 * half) * (i / steps);
        const r = this._rayLen(game, e.x, e.y, a, e.visionRange);
        ctx.lineTo(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r);
      }
      ctx.closePath();
      const g = ctx.createRadialGradient(e.x, e.y, 4, e.x, e.y, e.visionRange);
      g.addColorStop(0, color + '0.22)'); g.addColorStop(1, color + '0)');
      ctx.fillStyle = g; ctx.fill();
    }
  }

  _rayLen(game, x, y, a, maxR) {
    const step = TILE * 0.35, dx = Math.cos(a), dy = Math.sin(a);
    let r = step;
    while (r < maxR) { if (game.map.isBlockedWorld(x + dx * r, y + dy * r)) return r; r += step; }
    return maxR;
  }

  // --- Pixel sprite billboard ---
  _drawSprite(kind, x, y, angle, frame, bob) {
    const ctx = this.ctx;
    const cv = getSprite(kind, frame);
    const w = SPRITE_W * SPRITE_SCALE, h = SPRITE_H * SPRITE_SCALE;
    const facingLeft = Math.cos(angle) < 0;
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y - h * 0.7 + (bob || 0)));
    if (facingLeft) ctx.scale(-1, 1);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cv, Math.round(-w / 2), 0, Math.round(w), Math.round(h));
    ctx.restore();
  }

  _shadow(x, y, rx = 14) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath(); ctx.ellipse(x, y + 12, rx, rx * 0.5, 0, 0, TAU); ctx.fill();
  }

  _drawEnemies(game, time) {
    const ctx = this.ctx;
    for (const e of game.enemies) {
      if (!this._visible(e.x, e.y, 40)) continue;
      if (e.downed) { this._drawDowned(ctx, e); continue; }
      this._shadow(e.x, e.y);
      const hostile = e.state === STATE.COMBAT || e.state === STATE.ALERTED;
      const moving = e.state !== STATE.IDLE && e.rooted <= 0 && e.stun <= 0;
      const frame = moving ? Math.floor(time * 6 + e.x * 0.05) % 2 : 0;
      const bob = moving ? Math.abs(Math.sin(time * 8 + e.x)) * -2 : 0;
      ctx.save();
      if (e.stun > 0) ctx.globalAlpha = 0.7;
      this._drawSprite(hostile ? 'enemyHot' : 'enemy', e.x, e.y, e.angle, frame, bob);
      ctx.restore();

      // State glyph.
      const glyph = e.stun > 0 ? '★' : e.rooted > 0 ? '🕸'
        : e.state === STATE.SUSPICIOUS ? '?'
        : (e.state === STATE.ALERTED || e.state === STATE.COMBAT) ? '!'
        : e.state === STATE.SEARCHING ? '?' : '';
      if (glyph) {
        ctx.fillStyle = e.state === STATE.SUSPICIOUS || e.state === STATE.SEARCHING ? '#ffce4a'
          : (e.state === STATE.ALERTED || e.state === STATE.COMBAT) ? '#ff4a4a' : '#ffce4a';
        ctx.font = 'bold 16px system-ui'; ctx.textAlign = 'center';
        ctx.fillText(glyph, e.x, e.y - 34 + Math.sin(time * 6) * 1.5);
      }
    }
  }

  _drawDowned(ctx, e) {
    ctx.save(); ctx.translate(e.x, e.y);
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(0, 4, 16, 8, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(150,60,60,0.7)'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(0, 0, 9, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(200,90,90,0.8)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-6, -6); ctx.lineTo(6, 6); ctx.moveTo(6, -6); ctx.lineTo(-6, 6); ctx.stroke();
    ctx.restore();
  }

  _drawPlayer(game, time) {
    const ctx = this.ctx;
    const p = game.player;
    this._shadow(p.x, p.y, 15);

    // Facing wedge on the ground.
    ctx.save();
    ctx.translate(p.x, p.y + 10);
    ctx.rotate(p.angle);
    ctx.fillStyle = this._hexA(p.hero.accent, 0.28);
    ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(26, -9); ctx.lineTo(26, 9); ctx.closePath(); ctx.fill();
    ctx.restore();

    // Persistent ground ring so the hero is always locatable.
    ctx.strokeStyle = this._hexA(p.hero.accent, p.hidden ? 0.35 : 0.9);
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.ellipse(p.x, p.y + 11, 17, 8, 0, 0, TAU); ctx.stroke();

    // Accent glow.
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, 34);
    g.addColorStop(0, this._hexA(p.hero.accent, p.hidden ? 0.08 : 0.2));
    g.addColorStop(1, this._hexA(p.hero.accent, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, 34, 0, TAU); ctx.fill();
    ctx.restore();

    let ox = 0, oy = 0;
    if (p.takedownAnim > 0) { const k = Math.sin((1 - p.takedownAnim / 0.22) * Math.PI) * 10; ox = Math.cos(p.angle) * k; oy = Math.sin(p.angle) * k; }
    const bob = (p.moving && !p.dashing) ? Math.abs(Math.sin(time * 9)) * -2 : 0;
    ctx.save();
    if (p.hidden) ctx.globalAlpha = 0.55;
    this._drawSprite(p.hero.spriteKind, p.x + ox, p.y + oy, p.angle, p.frame, bob);
    ctx.restore();

    if (p.hidden) {
      ctx.fillStyle = 'rgba(200,220,255,0.5)'; ctx.font = '11px system-ui'; ctx.textAlign = 'center';
      ctx.fillText('hidden', p.x, p.y - 40);
    }
  }

  _drawGrapple(game) {
    const p = game.player;
    if (!p.rope) return;
    const ctx = this.ctx;
    ctx.strokeStyle = `rgba(210,210,220,${clamp(p.rope.t / 0.35, 0, 1) * 0.8})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(p.x, p.y - 6); ctx.lineTo(p.rope.ax, p.rope.ay); ctx.stroke();
    ctx.fillStyle = '#c9ccd6'; ctx.beginPath(); ctx.arc(p.rope.ax, p.rope.ay, 4, 0, TAU); ctx.fill();
  }

  _drawRadar(game) {
    if (game.player.radarTimer <= 0) return;
    const ctx = this.ctx;
    const a = clamp(game.player.radarTimer / 1, 0, 1);
    for (const e of game.enemies) {
      if (e.downed) continue;
      ctx.strokeStyle = `rgba(255,80,80,${0.5 * a})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(e.x, e.y, 22, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + Math.cos(e.angle) * 24, e.y + Math.sin(e.angle) * 24); ctx.stroke();
    }
  }

  _drawProjectiles(game, time) {
    const ctx = this.ctx;
    for (const pr of game.projectiles) {
      if (pr.type === 'billyclub') {
        ctx.save(); ctx.translate(pr.x, pr.y); ctx.rotate(pr.spin);
        ctx.fillStyle = '#111'; ctx.fillRect(-11, -3, 22, 6);          // black grip half
        ctx.fillStyle = '#e23b3b'; ctx.fillRect(0, -3, 11, 6);          // red half
        ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillRect(-11, -3, 22, 1.5);
        ctx.restore();
      } else if (pr.type === 'batarang') {
        ctx.save(); ctx.translate(pr.x, pr.y); ctx.rotate(pr.spin);
        ctx.fillStyle = '#1a2036';
        ctx.beginPath();
        ctx.moveTo(-12, 0); ctx.lineTo(-3, -3); ctx.lineTo(0, -10); ctx.lineTo(3, -3);
        ctx.lineTo(12, 0); ctx.lineTo(3, 3); ctx.lineTo(0, 10); ctx.lineTo(-3, 3); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(120,150,255,0.6)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.restore();
      } else if (pr.type === 'web') {
        ctx.strokeStyle = 'rgba(235,240,255,0.9)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(pr.x, pr.y); ctx.lineTo(pr.x - pr.vx * 0.03, pr.y - pr.vy * 0.03); ctx.stroke();
        ctx.fillStyle = '#eef2ff'; ctx.beginPath(); ctx.arc(pr.x, pr.y, 3, 0, TAU); ctx.fill();
      } else if (pr.type === 'bullet') {
        ctx.strokeStyle = 'rgba(255,120,90,0.95)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(pr.x, pr.y); ctx.lineTo(pr.x - pr.vx * 0.02, pr.y - pr.vy * 0.02); ctx.stroke();
      }
    }
  }

  _drawZipTrails(game) {
    const ctx = this.ctx;
    for (const t of game.zipTrails) {
      ctx.strokeStyle = `rgba(230,180,255,${t.life * 0.8})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(t.x, t.y, 4, 0, TAU); ctx.stroke();
    }
  }

  _drawSmoke(game, time) {
    const ctx = this.ctx;
    for (const s of game.smokes) {
      const a = clamp(s.life / s.duration, 0, 1);
      ctx.save(); ctx.globalAlpha = 0.75 * Math.min(1, a * 2);
      for (let i = 0; i < 7; i++) {
        const ang = i / 7 * TAU + time * 0.3;
        const rr = s.radius * (0.4 + 0.5 * Math.sin(time + i));
        const px = s.x + Math.cos(ang) * s.radius * 0.4, py = s.y + Math.sin(ang) * s.radius * 0.4;
        const g = ctx.createRadialGradient(px, py, 2, px, py, rr);
        g.addColorStop(0, 'rgba(190,200,210,0.5)'); g.addColorStop(1, 'rgba(150,160,175,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, rr, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
  }

  _drawWebTraps(game, time) {
    const ctx = this.ctx;
    for (const w of game.webTraps) {
      ctx.save(); ctx.translate(w.x, w.y);
      ctx.strokeStyle = `rgba(230,235,255,${0.6 * clamp(w.life / w.duration, 0, 1)})`; ctx.lineWidth = 1.5;
      const R = w.radius;
      for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R); ctx.stroke(); }
      for (let ring = 1; ring <= 3; ring++) { ctx.beginPath(); ctx.arc(0, 0, R * ring / 3, 0, TAU); ctx.stroke(); }
      ctx.restore();
    }
  }

  _drawAlerts(game, time) {
    const ctx = this.ctx;
    for (const a of game.alertPings) {
      const t = 1 - a.life / a.max;
      ctx.strokeStyle = `rgba(255,70,70,${a.life / a.max})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(a.x, a.y, 10 + t * 60, 0, TAU); ctx.stroke();
    }
  }

  _drawFloaters(game) {
    const ctx = this.ctx;
    ctx.save(); ctx.textAlign = 'center'; ctx.font = 'bold 13px system-ui';
    for (const f of game.floaters) { ctx.globalAlpha = clamp(f.life, 0, 1); ctx.fillStyle = f.color || '#fff'; ctx.fillText(f.text, f.x, f.y); }
    ctx.restore();
  }

  _drawRain(ctx, time) {
    ctx.save(); ctx.strokeStyle = 'rgba(170,190,230,0.22)'; ctx.lineWidth = 1;
    const w = this.vw, h = this.vh;
    for (const d of this.rain) {
      const x = d.x * w, y = ((d.y + (time * d.spd) % 1) % 1) * h;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 2, y + d.len); ctx.stroke();
    }
    ctx.restore();
  }

  _drawFog(ctx) {
    const g = ctx.createRadialGradient(this.vw / 2, this.vh / 2, this.vh * 0.32, this.vw / 2, this.vh / 2, this.vh * 0.78);
    g.addColorStop(0, 'rgba(8,11,20,0)'); g.addColorStop(1, 'rgba(5,7,14,0.74)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, this.vw, this.vh);
  }

  _drawJoystick(ctx, input) {
    if (!input || !input.joy.active) return;
    const j = input.joy;
    ctx.save();
    ctx.strokeStyle = 'rgba(200,220,255,0.35)'; ctx.fillStyle = 'rgba(120,150,220,0.12)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(j.ox, j.oy, 60, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(200,220,255,0.45)'; ctx.beginPath(); ctx.arc(j.cx, j.cy, 26, 0, TAU); ctx.fill();
    ctx.restore();
  }

  _hexA(hex, a) {
    const h = hex.replace('#', '');
    return `rgba(${parseInt(h.substring(0, 2), 16)},${parseInt(h.substring(2, 4), 16)},${parseInt(h.substring(4, 6), 16)},${a})`;
  }
}
