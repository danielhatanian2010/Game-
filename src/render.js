// All canvas drawing: rainy-city atmosphere, map, entities, vision cones and
// gadget effects. Uses a camera that follows the player with slight smoothing.

import { TILE, FLOOR, WALL, VOID } from './mapgen.js';
import { STATE } from './entities/enemy.js';
import { TAU, clamp } from './utils.js';

const ZONE_FLOOR = {
  street: '#242b3d',
  interior: '#2d2740',
  roof: '#1f2a38',
  crate: '#242b3d',
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = { x: 0, y: 0 };
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
    for (let i = 0; i < 220; i++) {
      this.rain.push({
        x: Math.random(), y: Math.random(),
        len: 8 + Math.random() * 14,
        spd: 0.5 + Math.random() * 0.9,
      });
    }
  }

  updateCamera(game, dt) {
    const p = game.player;
    // Center on player but keep map roughly in view; gentle smoothing.
    const tx = p.x - this.vw / 2;
    const ty = p.y - this.vh / 2;
    this.cam.x += (tx - this.cam.x) * Math.min(1, dt * 6);
    this.cam.y += (ty - this.cam.y) * Math.min(1, dt * 6);
    // Clamp to map bounds with a margin.
    const margin = 80;
    const maxX = game.map.worldWidth() - this.vw + margin;
    const maxY = game.map.worldHeight() - this.vh + margin;
    this.cam.x = clamp(this.cam.x, -margin, Math.max(-margin, maxX));
    this.cam.y = clamp(this.cam.y, -margin, Math.max(-margin, maxY));
  }

  render(game, time) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Night sky base.
    ctx.fillStyle = '#080a12';
    ctx.fillRect(0, 0, this.vw, this.vh);

    ctx.save();
    ctx.translate(-Math.round(this.cam.x), -Math.round(this.cam.y));

    this._drawMap(game, time);
    this._drawLights(game, time);
    this._drawExtract(game, time);
    this._drawWebTraps(game, time);
    this._drawSmoke(game, time);
    this._drawVisionCones(game);
    this._drawEnemies(game, time);
    this._drawProjectiles(game);
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

  _drawMap(game, time) {
    const ctx = this.ctx;
    const map = game.map;
    const c0 = Math.max(0, Math.floor(this.cam.x / TILE));
    const r0 = Math.max(0, Math.floor(this.cam.y / TILE));
    const c1 = Math.min(map.cols, Math.ceil((this.cam.x + this.vw) / TILE) + 1);
    const r1 = Math.min(map.rows, Math.ceil((this.cam.y + this.vh) / TILE) + 1);

    // Floors first.
    for (let gy = r0; gy < r1; gy++) {
      for (let gx = c0; gx < c1; gx++) {
        const cell = map.cells[map.idx(gx, gy)];
        if (cell !== FLOOR) continue;
        const x = gx * TILE, y = gy * TILE;
        const zone = map.zones[map.idx(gx, gy)];
        ctx.fillStyle = ZONE_FLOOR[zone] || ZONE_FLOOR.street;
        ctx.fillRect(x, y, TILE, TILE);
        // Wet sheen grid lines.
        ctx.strokeStyle = 'rgba(120,150,200,0.06)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
      }
    }

    // Walls with a fake-height top edge for a 2.5D read.
    for (let gy = r0; gy < r1; gy++) {
      for (let gx = c0; gx < c1; gx++) {
        const cell = map.cells[map.idx(gx, gy)];
        if (cell !== WALL) continue;
        const x = gx * TILE, y = gy * TILE;
        const zone = map.zones[map.idx(gx, gy)];
        const isCrate = zone === 'crate';
        // Body / shadow.
        ctx.fillStyle = isCrate ? '#3a2f22' : '#11141f';
        ctx.fillRect(x, y, TILE, TILE);
        // Top face highlight.
        ctx.fillStyle = isCrate ? '#5a4630' : '#1b2030';
        ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 8);
        // Rim light.
        ctx.fillStyle = isCrate ? 'rgba(255,200,120,0.15)' : 'rgba(120,160,220,0.10)';
        ctx.fillRect(x + 2, y + 2, TILE - 4, 3);
      }
    }
  }

  _drawLights(game, time) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const L of game.map.lights) {
      if (!this._visible(L.x, L.y, L.r)) continue;
      const flick = 0.85 + Math.sin(time * 9 + L.x) * 0.05;
      const g = ctx.createRadialGradient(L.x, L.y, 4, L.x, L.y, L.r);
      g.addColorStop(0, `rgba(120,190,255,${0.35 * flick})`);
      g.addColorStop(0.4, `rgba(90,140,220,${0.14 * flick})`);
      g.addColorStop(1, 'rgba(60,90,160,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(L.x, L.y, L.r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawExtract(game, time) {
    if (!game.map.extract) return;
    const ctx = this.ctx;
    const ex = (game.map.extract.gx + 0.5) * TILE;
    const ey = (game.map.extract.gy + 0.5) * TILE;
    const active = game.enemiesRemaining() === 0;
    const pulse = 0.5 + Math.sin(time * 4) * 0.5;
    ctx.save();
    ctx.translate(ex, ey);
    const col = active ? `rgba(80,255,160,` : `rgba(120,150,180,`;
    for (let i = 0; i < 3; i++) {
      const r = 12 + i * 10 + (active ? pulse * 8 : 0);
      ctx.strokeStyle = col + (active ? 0.6 - i * 0.15 : 0.25 - i * 0.06) + ')';
      ctx.lineWidth = active ? 3 : 2;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.stroke();
    }
    // Chevrons pointing in.
    ctx.fillStyle = active ? `rgba(120,255,190,${0.6 + pulse * 0.3})` : 'rgba(150,170,190,0.4)';
    ctx.font = 'bold 12px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(active ? 'EXTRACT' : 'LOCKED', 0, active ? -30 : -28);
    ctx.restore();
  }

  _drawVisionCones(game) {
    const ctx = this.ctx;
    for (const e of game.enemies) {
      if (e.downed || e.stun > 0) continue;
      if (!this._visible(e.x, e.y, e.visionRange)) continue;
      let color;
      switch (e.state) {
        case STATE.COMBAT:
        case STATE.ALERTED: color = 'rgba(255,60,60,'; break;
        case STATE.SUSPICIOUS: color = 'rgba(255,170,40,'; break;
        case STATE.SEARCHING: color = 'rgba(255,120,40,'; break;
        default: color = 'rgba(255,240,120,';
      }
      const half = e.state === STATE.COMBAT ? e.visionHalf + 0.3 : e.visionHalf;
      const steps = 16;
      ctx.beginPath();
      ctx.moveTo(e.x, e.y);
      for (let i = 0; i <= steps; i++) {
        const a = e.angle - half + (2 * half) * (i / steps);
        // Ray-cast the cone edge so it stops at walls.
        const r = this._rayLen(game, e.x, e.y, a, e.visionRange);
        ctx.lineTo(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r);
      }
      ctx.closePath();
      const g = ctx.createRadialGradient(e.x, e.y, 4, e.x, e.y, e.visionRange);
      g.addColorStop(0, color + '0.22)');
      g.addColorStop(1, color + '0)');
      ctx.fillStyle = g;
      ctx.fill();
    }
  }

  _rayLen(game, x, y, a, maxR) {
    const step = TILE * 0.35;
    const dx = Math.cos(a), dy = Math.sin(a);
    let r = step;
    while (r < maxR) {
      if (game.map.isBlockedWorld(x + dx * r, y + dy * r)) return r;
      r += step;
    }
    return maxR;
  }

  _drawEnemies(game, time) {
    const ctx = this.ctx;
    for (const e of game.enemies) {
      if (!this._visible(e.x, e.y)) continue;
      if (e.downed) { this._drawDowned(ctx, e); continue; }
      // Shadow.
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(e.x, e.y + 10, 14, 7, 0, 0, TAU);
      ctx.fill();

      // Hostile enemies read as bright orange-red; passive ones as muted rust —
      // both clearly distinct from any playable hero color.
      const hostile = e.state === STATE.COMBAT || e.state === STATE.ALERTED;
      const bodyCol = e.hitFlash > 0 ? '#ffffff'
        : e.stun > 0 ? '#6f7280'
        : hostile ? '#ff6a2a' : '#8f4a3c';
      const headCol = e.stun > 0 ? '#4a4d58' : hostile ? '#b83b12' : '#4d221b';
      this._drawHumanoid(ctx, e.x, e.y, e.angle, bodyCol, headCol, 13, 'rgba(0,0,0,0.55)');

      // State glyph above head.
      const glyph = e.stun > 0 ? '★' : e.rooted > 0 ? '🕸'
        : e.state === STATE.SUSPICIOUS ? '?'
        : (e.state === STATE.ALERTED || e.state === STATE.COMBAT) ? '!'
        : e.state === STATE.SEARCHING ? '?' : '';
      if (glyph) {
        ctx.fillStyle = e.state === STATE.SUSPICIOUS ? '#ffce4a'
          : (e.state === STATE.ALERTED || e.state === STATE.COMBAT) ? '#ff4a4a' : '#ffce4a';
        ctx.font = 'bold 16px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(glyph, e.x, e.y - 24 + Math.sin(time * 6) * 1.5);
      }
    }
  }

  _drawDowned(ctx, e) {
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(0, 4, 16, 8, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,60,60,0.7)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, 9, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(200,90,90,0.8)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-6, -6); ctx.lineTo(6, 6);
    ctx.moveTo(6, -6); ctx.lineTo(-6, 6);
    ctx.stroke();
    ctx.restore();
  }

  _drawHumanoid(ctx, x, y, angle, bodyCol, headCol, size, outline = null) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + Math.PI / 2); // sprite faces "up" at angle 0 -> rotate
    // Torso (capsule).
    if (outline) {
      ctx.strokeStyle = outline;
      ctx.lineWidth = 2.5;
      this._roundRect(ctx, -size * 0.6, -size * 0.4, size * 1.2, size * 1.5, 6);
      ctx.stroke();
    }
    ctx.fillStyle = bodyCol;
    this._roundRect(ctx, -size * 0.6, -size * 0.4, size * 1.2, size * 1.5, 6);
    ctx.fill();
    // Shoulders hint.
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    this._roundRect(ctx, -size * 0.6, -size * 0.4, size * 1.2, 5, 3);
    ctx.fill();
    // Head.
    ctx.fillStyle = headCol;
    ctx.beginPath();
    ctx.arc(0, -size * 0.55, size * 0.5, 0, TAU);
    ctx.fill();
    // Facing nub (nose direction).
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.arc(0, -size * 0.9, size * 0.16, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  _drawPlayer(game, time) {
    const ctx = this.ctx;
    const p = game.player;
    // Shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 11, 15, 7, 0, 0, TAU);
    ctx.fill();

    // Lunge offset during takedown.
    let ox = 0, oy = 0;
    if (p.takedownAnim > 0) {
      const k = Math.sin((1 - p.takedownAnim / 0.22) * Math.PI) * 10;
      ox = Math.cos(p.angle) * k; oy = Math.sin(p.angle) * k;
    }

    // Glow halo in hero accent (additive).
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, 36);
    g.addColorStop(0, this._hexA(p.hero.accent, p.hidden ? 0.1 : 0.28));
    g.addColorStop(1, this._hexA(p.hero.accent, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, 36, 0, TAU); ctx.fill();
    ctx.restore();

    // Persistent ground ring so the player is always instantly locatable.
    ctx.strokeStyle = this._hexA(p.hero.accent, p.hidden ? 0.35 : 0.9);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 11, 17, 8, 0, 0, TAU);
    ctx.stroke();

    // Bright white outline keeps the hero readable over any floor/enemy.
    this._drawHumanoid(ctx, p.x + ox, p.y + oy, p.angle, p.hero.color, p.hero.accent, 15, 'rgba(255,255,255,0.85)');

    if (p.hidden) {
      ctx.fillStyle = 'rgba(200,220,255,0.5)';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('hidden', p.x, p.y - 26);
    }
  }

  _drawRadar(game) {
    // Warden radar sense: outline all enemies through walls.
    if (game.player.radarTimer <= 0) return;
    const ctx = this.ctx;
    const a = clamp(game.player.radarTimer / 1, 0, 1);
    ctx.save();
    for (const e of game.enemies) {
      if (e.downed) continue;
      ctx.strokeStyle = `rgba(255,80,80,${0.5 * a})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(e.x, e.y, 20, 0, TAU);
      ctx.stroke();
      // Direction tick.
      ctx.beginPath();
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(e.x + Math.cos(e.angle) * 22, e.y + Math.sin(e.angle) * 22);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawProjectiles(game) {
    const ctx = this.ctx;
    for (const pr of game.projectiles) {
      ctx.strokeStyle = pr.enemy ? 'rgba(255,120,90,0.95)' : 'rgba(180,220,255,0.95)';
      ctx.lineWidth = pr.enemy ? 3 : 4;
      ctx.beginPath();
      ctx.moveTo(pr.x, pr.y);
      ctx.lineTo(pr.x - pr.vx * 0.02, pr.y - pr.vy * 0.02);
      ctx.stroke();
    }
  }

  _drawZipTrails(game) {
    const ctx = this.ctx;
    for (const t of game.zipTrails) {
      ctx.strokeStyle = `rgba(230,180,255,${t.life * 0.8})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(t.x, t.y, 4, 0, TAU);
      ctx.stroke();
    }
  }

  _drawSmoke(game, time) {
    const ctx = this.ctx;
    for (const s of game.smokes) {
      const a = clamp(s.life / s.duration, 0, 1);
      ctx.save();
      ctx.globalAlpha = 0.75 * Math.min(1, a * 2);
      for (let i = 0; i < 7; i++) {
        const ang = i / 7 * TAU + time * 0.3;
        const rr = s.radius * (0.4 + 0.5 * Math.sin(time + i));
        const px = s.x + Math.cos(ang) * s.radius * 0.4;
        const py = s.y + Math.sin(ang) * s.radius * 0.4;
        const g = ctx.createRadialGradient(px, py, 2, px, py, rr);
        g.addColorStop(0, 'rgba(190,200,210,0.5)');
        g.addColorStop(1, 'rgba(150,160,175,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(px, py, rr, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
  }

  _drawWebTraps(game, time) {
    const ctx = this.ctx;
    for (const w of game.webTraps) {
      ctx.save();
      ctx.translate(w.x, w.y);
      ctx.strokeStyle = `rgba(230,235,255,${0.6 * clamp(w.life / w.duration, 0, 1)})`;
      ctx.lineWidth = 1.5;
      const R = w.radius;
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * TAU;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R); ctx.stroke();
      }
      for (let ring = 1; ring <= 3; ring++) {
        ctx.beginPath(); ctx.arc(0, 0, R * ring / 3, 0, TAU); ctx.stroke();
      }
      ctx.restore();
    }
  }

  _drawAlerts(game, time) {
    // Expanding rings where alarms were raised.
    const ctx = this.ctx;
    for (const a of game.alertPings) {
      const t = 1 - a.life / a.max;
      ctx.strokeStyle = `rgba(255,70,70,${a.life / a.max})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(a.x, a.y, 10 + t * 60, 0, TAU);
      ctx.stroke();
    }
  }

  _drawFloaters(game) {
    const ctx = this.ctx;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = 'bold 13px system-ui';
    for (const f of game.floaters) {
      ctx.globalAlpha = clamp(f.life, 0, 1);
      ctx.fillStyle = f.color || '#fff';
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.restore();
  }

  _drawRain(ctx, time) {
    ctx.save();
    ctx.strokeStyle = 'rgba(170,190,230,0.25)';
    ctx.lineWidth = 1;
    const w = this.vw, h = this.vh;
    for (const d of this.rain) {
      const x = d.x * w;
      const y = ((d.y + (time * d.spd) % 1) % 1) * h;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 2, y + d.len);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawFog(ctx) {
    // Vignette + faint fog to sell the night mood.
    const g = ctx.createRadialGradient(this.vw / 2, this.vh / 2, this.vh * 0.3,
      this.vw / 2, this.vh / 2, this.vh * 0.75);
    g.addColorStop(0, 'rgba(10,14,24,0)');
    g.addColorStop(1, 'rgba(6,8,16,0.72)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.vw, this.vh);
  }

  _drawJoystick(ctx, input) {
    if (!input || !input.joy.active) return;
    const j = input.joy;
    ctx.save();
    ctx.strokeStyle = 'rgba(200,220,255,0.35)';
    ctx.fillStyle = 'rgba(120,150,220,0.12)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(j.ox, j.oy, 60, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(200,220,255,0.45)';
    ctx.beginPath(); ctx.arc(j.cx, j.cy, 26, 0, TAU); ctx.fill();
    ctx.restore();
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  _hexA(hex, a) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
}
