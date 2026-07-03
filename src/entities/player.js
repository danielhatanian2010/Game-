// The player-controlled hero. Slots:
//   attack  -> stealth takedown (only on enemies that DON'T see you)
//   jump    -> traversal: grapple hook (Warden/Nightfall) or web-zip (Weaver)
//   ability -> radar / smoke / web trap
//   grapple -> signature projectile: billy club / batarang / web shot

import { HEROES } from '../heroes.js';
import { TILE } from '../mapgen.js';
import { clamp, angleDiff } from '../utils.js';

export class Player {
  constructor(heroId, x, y, heroMods) {
    this.hero = HEROES[heroId];
    this.x = x; this.y = y;
    this.radius = 15;
    this.angle = -Math.PI / 2;
    this.mods = heroMods;
    this.speed = this.hero.speed * heroMods.speedMult;

    this.moving = false;
    this.footTimer = 0;
    this.walkT = 0;      // walk cycle time -> sprite frame
    this.frame = 0;

    // Cooldowns (current + max, for HUD rings).
    this.cdAbility = 0;
    this.abilityMax = this.hero.ability.cooldown;
    this.cdTraverse = 0;
    this.traverseMax = this.hero.traversal.cooldown * (this.hero.traversal.type === 'grapple' ? heroMods.grappleCd : 1);
    this.cdProjectile = 0;
    this.projectileMax = this.hero.projectile.cooldown;

    this.radarTimer = 0;
    this.dashing = null;      // active grapple/zip { tx, ty, speed, kind }
    this.rope = null;         // grapple rope visual { ax, ay, t }
    this.takedownAnim = 0;
    this.hidden = false;
    this.detectionMeter = 0;
  }

  get takedownRange() { return 46; }

  update(dt, input, game) {
    this.cdAbility = Math.max(0, this.cdAbility - dt);
    this.cdTraverse = Math.max(0, this.cdTraverse - dt);
    this.cdProjectile = Math.max(0, this.cdProjectile - dt);
    this.radarTimer = Math.max(0, this.radarTimer - dt);
    if (this.takedownAnim > 0) this.takedownAnim = Math.max(0, this.takedownAnim - dt);
    if (this.rope) { this.rope.t -= dt; if (this.rope.t <= 0) this.rope = null; }

    if (this.dashing) {
      this._updateDash(dt, game);
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

    // Walk animation frame.
    if (this.moving || this.dashing) { this.walkT += dt; this.frame = (Math.floor(this.walkT * 7) % 2); }
    else { this.frame = 0; }

    // Footsteps.
    if (this.moving && !this.dashing) {
      this.footTimer -= dt;
      if (this.footTimer <= 0) {
        this.footTimer = 0.34;
        const zone = game.map.zoneAtWorld(this.x, this.y);
        game.audio.footstep(zone === 'roof' ? 'roof' : zone === 'interior' ? 'interior' : 'street');
        game.emitSound(this.x, this.y, TILE * 2.1, 'step');
      }
    }

    if (input.consume('attack')) this._tryTakedown(game);
    if (input.consume('jump')) this._traverse(game);
    if (input.consume('ability')) this._useAbility(game);
    if (input.consume('grapple')) this._throw(game);

    this.hidden = game.smokes.some((s) => Math.hypot(s.x - this.x, s.y - this.y) < s.radius);
  }

  _moveWithCollision(dx, dy, game) {
    const map = game.map, r = this.radius;
    const nx = this.x + dx;
    if (!this._blk(map, nx - r, this.y) && !this._blk(map, nx + r, this.y) &&
        !this._blk(map, nx, this.y - r) && !this._blk(map, nx, this.y + r)) this.x = nx;
    const ny = this.y + dy;
    if (!this._blk(map, this.x - r, ny) && !this._blk(map, this.x + r, ny) &&
        !this._blk(map, this.x, ny - r) && !this._blk(map, this.x, ny + r)) this.y = ny;
  }
  _blk(map, x, y) { return map.isBlockedWorld(x, y); }

  // --- Traversal: grapple hook or web zip. Both dash to a computed target,
  //     stopping just short of the first wall along the facing direction. ---
  _traverse(game) {
    if (this.cdTraverse > 0 || this.dashing) return;
    const t = this.hero.traversal;
    let range = t.range;
    if (t.type === 'zip') range *= (1 + this.mods.zipBonus);
    const dx = Math.cos(this.angle), dy = Math.sin(this.angle);
    const step = TILE * 0.3;
    let lastX = this.x, lastY = this.y, r = step;
    while (r < range) {
      const px = this.x + dx * r, py = this.y + dy * r;
      if (game.map.isBlockedWorld(px + dx * this.radius, py + dy * this.radius)) break;
      lastX = px; lastY = py; r += step;
    }
    if (Math.hypot(lastX - this.x, lastY - this.y) < TILE * 0.5) return; // nowhere to go, don't waste cd
    this.cdTraverse = this.traverseMax;
    this.dashing = { tx: lastX, ty: lastY, speed: t.speed, kind: t.type };
    if (t.type === 'grapple') { this.rope = { ax: lastX, ay: lastY, t: 0.35 }; game.audio.gadget(); }
    else game.audio.gadget();
    game.emitSound(this.x, this.y, TILE * 1.6, 'step');
  }

  _updateDash(dt, game) {
    const d = this.dashing;
    const dxT = d.tx - this.x, dyT = d.ty - this.y;
    const dist = Math.hypot(dxT, dyT);
    const step = d.speed * dt;
    if (dist <= step) { this.x = d.tx; this.y = d.ty; this.dashing = null; return; }
    this.x += dxT / dist * step; this.y += dyT / dist * step;
    if (d.kind === 'zip') game.spawnZipTrail(this.x, this.y);
  }

  // Silent takedown only on the nearest enemy that cannot see you.
  _tryTakedown(game) {
    let best = null, bestD = 1e9;
    for (const e of game.enemies) {
      if (e.dead || e.downed) continue;
      if (e.canSeePlayer) continue;           // must be unaware of you
      const d = Math.hypot(e.x - this.x, e.y - this.y);
      if (d > this.takedownRange || d > bestD) continue;
      best = e; bestD = d;
    }
    if (best) {
      this.angle = Math.atan2(best.y - this.y, best.x - this.x);
      this.takedownAnim = 0.22;
      const fromBehind = Math.abs(angleDiff(best.angle, this.angle + Math.PI)) < 1.3;
      game.doTakedown(best, this, fromBehind);
    } else {
      this.takedownAnim = 0.12; // whiff
    }
  }

  _useAbility(game) {
    if (this.cdAbility > 0) return;
    const a = this.hero.ability;
    this.cdAbility = this.abilityMax;
    game.audio.ability();
    if (a.type === 'radar') this.radarTimer = a.duration + this.mods.radarBonus;
    else if (a.type === 'smoke') game.spawnSmoke(this.x, this.y, a.radius * (1 + this.mods.smokeBonus * 0.22), a.duration + this.mods.smokeBonus);
    else if (a.type === 'webtrap') game.spawnWebTrap(this.x, this.y, a.duration, a.rootTime + this.mods.trapBonus, a.radius * (1 + this.mods.trapBonus * 0.18));
  }

  _throw(game) {
    if (this.cdProjectile > 0) return;
    this.cdProjectile = this.projectileMax;
    game.fireProjectile(this, this.angle);
  }
}
