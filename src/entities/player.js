// The player-controlled hero. Handles movement + collision, facing, the
// contextual stealth takedown, and hero abilities (radar / smoke / webtrap /
// throw / zip). Rendering lives in render.js.

import { HEROES } from '../heroes.js';
import { TILE } from '../mapgen.js';
import { clamp, TAU, angleDiff } from '../utils.js';

export class Player {
  constructor(heroId, x, y, mods) {
    this.hero = HEROES[heroId];
    this.x = x;
    this.y = y;
    this.radius = 15;
    this.angle = -Math.PI / 2;
    this.mods = mods;
    this.speed = this.hero.speed * mods.speedMult;

    this.moving = false;
    this.footTimer = 0;
    this.sprinting = false;

    // Cooldown timers (seconds remaining).
    this.cdAbility = 0;
    this.cdGrapple = 0;

    // Active effects.
    this.radarTimer = 0;   // Warden radar sense reveal
    this.zipping = null;   // { dx, dy, remaining } active web-zip dash
    this.takedownAnim = 0; // brief lunge animation

    this.hidden = false;   // inside own smoke
    this.detectionMeter = 0; // 0..1 aggregate exposure for the HUD ring
  }

  get takedownRange() { return 46; }

  update(dt, input, game) {
    // Cooldowns.
    this.cdAbility = Math.max(0, this.cdAbility - dt);
    this.cdGrapple = Math.max(0, this.cdGrapple - dt);
    this.radarTimer = Math.max(0, this.radarTimer - dt);
    if (this.takedownAnim > 0) this.takedownAnim = Math.max(0, this.takedownAnim - dt);

    // --- Movement (web-zip overrides manual control) ---
    if (this.zipping) {
      this._updateZip(dt, game);
    } else {
      let mx = input.move.x, my = input.move.y;
      const mag = Math.hypot(mx, my);
      this.moving = mag > 0.05;
      if (this.moving) {
        this.angle = Math.atan2(my, mx);
        const spd = this.speed * clamp(mag, 0, 1);
        this._moveWithCollision(mx / (mag || 1) * spd * dt, my / (mag || 1) * spd * dt, game);
      }
    }

    // Footstep audio + sound events for enemy hearing.
    if (this.moving && !this.zipping) {
      this.footTimer -= dt;
      if (this.footTimer <= 0) {
        this.footTimer = 0.34;
        const zone = game.map.zoneAtWorld(this.x, this.y);
        game.audio.footstep(zone === 'roof' ? 'roof' : zone === 'interior' ? 'interior' : 'street');
        // Footsteps are a small sound the enemies can hear.
        game.emitSound(this.x, this.y, TILE * 2.1, 'step');
      }
    }

    // --- Actions ---
    if (input.consume('attack')) this._tryTakedown(game);
    if (input.consume('jump')) this._parkour(game);
    if (input.consume('ability')) this._useAbility(game);
    if (input.consume('grapple')) this._useGrapple(game);

    // Am I standing inside my own smoke? (grants hidden)
    this.hidden = game.smokes.some(
      (s) => Math.hypot(s.x - this.x, s.y - this.y) < s.radius
    );
  }

  _moveWithCollision(dx, dy, game) {
    const map = game.map;
    const r = this.radius;
    // Axis-separated so we slide along walls.
    let nx = this.x + dx;
    if (!this._blocked(map, nx - r, this.y) && !this._blocked(map, nx + r, this.y) &&
        !this._blocked(map, nx, this.y - r) && !this._blocked(map, nx, this.y + r)) {
      this.x = nx;
    }
    let ny = this.y + dy;
    if (!this._blocked(map, this.x - r, ny) && !this._blocked(map, this.x + r, ny) &&
        !this._blocked(map, this.x, ny - r) && !this._blocked(map, this.x, ny + r)) {
      this.y = ny;
    }
  }

  _blocked(map, x, y) { return map.isBlockedWorld(x, y); }

  _updateZip(dt, game) {
    const z = this.zipping;
    const step = z.speed * dt;
    const dist = Math.min(step, z.remaining);
    const nx = this.x + z.dx * dist;
    const ny = this.y + z.dy * dist;
    // Stop at walls.
    if (game.map.isBlockedWorld(nx + z.dx * this.radius, ny + z.dy * this.radius)) {
      this.zipping = null;
      return;
    }
    this.x = nx; this.y = ny;
    z.remaining -= dist;
    game.spawnZipTrail(this.x, this.y);
    if (z.remaining <= 0) this.zipping = null;
  }

  // Silent takedown if an enemy is close and (roughly) not facing us.
  _tryTakedown(game) {
    let best = null, bestD = 1e9;
    for (const e of game.enemies) {
      if (e.dead || e.downed) continue;
      const d = Math.hypot(e.x - this.x, e.y - this.y);
      if (d > this.takedownRange || d > bestD) continue;
      best = e; bestD = d;
    }
    if (best) {
      // Face the target and lunge.
      this.angle = Math.atan2(best.y - this.y, best.x - this.x);
      this.takedownAnim = 0.22 * this.mods.takedownMult;
      const fromBehind = Math.abs(angleDiff(best.angle, this.angle + Math.PI)) < 1.2;
      // Alerted enemies facing you resist a clean takedown but still get hit;
      // behind/unaware = instant. Either way they go down here (fast game).
      game.doTakedown(best, this, fromBehind);
    } else {
      // Whiff — small lunge feedback.
      this.takedownAnim = 0.12;
    }
  }

  _parkour(game) {
    // Contextual dash/vault: a short burst in facing direction if a wall or
    // ledge is just ahead, otherwise a quick evasive hop.
    const dashDir = this.moving ? this.angle : this.angle;
    const dx = Math.cos(dashDir), dy = Math.sin(dashDir);
    const burst = 46;
    const tx = this.x + dx * burst, ty = this.y + dy * burst;
    if (!game.map.isBlockedWorld(tx, ty)) {
      this.x = tx; this.y = ty;
      game.emitSound(this.x, this.y, TILE * 1.4, 'step');
    }
  }

  _useAbility(game) {
    if (this.cdAbility > 0) return;
    const a = this.hero.ability;
    this.cdAbility = a.cooldown * this.mods.cooldownMult;
    game.audio.ability();
    switch (a.type) {
      case 'radar':
        this.radarTimer = a.duration;
        break;
      case 'smoke':
        game.spawnSmoke(this.x, this.y, a.radius, a.duration);
        break;
      case 'webtrap':
        game.spawnWebTrap(this.x, this.y, a.duration, a.rootTime);
        break;
    }
  }

  _useGrapple(game) {
    if (this.cdGrapple > 0) return;
    const g = this.hero.grapple;
    this.cdGrapple = g.cooldown * this.mods.cooldownMult;
    switch (g.type) {
      case 'throw':
        game.audio.throwSfx();
        game.spawnProjectile(this.x, this.y, this.angle, g.range, g.stun);
        break;
      case 'zip':
        game.audio.gadget();
        this.zipping = { dx: Math.cos(this.angle), dy: Math.sin(this.angle), remaining: g.range, speed: g.speed };
        break;
    }
  }
}
