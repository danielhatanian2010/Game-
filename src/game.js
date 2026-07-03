// The Game orchestrates one mission: map, player, enemies, gadget effects,
// signature projectiles, sound events, alarm propagation, and win/lose.

import { GameMap, TILE } from './mapgen.js';
import { Player } from './entities/player.js';
import { Enemy, STATE } from './entities/enemy.js';
import { RUN_PERKS } from './heroes.js';
import { makeRng, randInt, clamp, dist } from './utils.js';

export class Game {
  constructor({ input, audio, renderer, progression, heroId, level }) {
    this.input = input;
    this.audio = audio;
    this.renderer = renderer;
    this.progression = progression;
    this.baseLevel = level;   // the sector number
    this.heroId = heroId;

    // A sector is a building of several floors.
    this.floorsTotal = clamp(3 + Math.floor(level / 2), 3, 6);
    this.halfwayFloor = Math.ceil(this.floorsTotal / 2);
    this.floor = 1;
    this.upgradedThisLevel = false;
    this.floorBanner = 0;     // >0 while a "FLOOR n" banner shows

    this.state = 'playing';   // playing | upgrade | complete | failed
    this.time = 0;
    this.alarm = 0;
    this.detections = 0;
    this.intelEarned = 0;

    this.playerHealthMax = 100;
    this.playerHealth = 100;
    this.playerHitFlash = 0;
    this.player = null;

    this._resetTransient();
    this.generateFloor(true);
  }

  // Effective difficulty grows as you climb.
  get level() { return this.baseLevel + (this.floor - 1); }

  _resetTransient() {
    this.enemies = [];
    this.projectiles = [];
    this.sounds = [];
    this.smokes = [];
    this.webTraps = [];
    this.zipTrails = [];
    this.alertPings = [];
    this.floaters = [];
    this.alarm = 0;
  }

  generateFloor(first) {
    this.seed = (Date.now() ^ (this.level * 2654435761) ^ (this.floor * 40503)) >>> 0;
    this.rng = makeRng(this.seed);
    this.map = new GameMap(this.seed, this.level);
    this._resetTransient();

    const start = this.map.randomFloorPos();
    if (first) {
      const heroMods = this.progression.heroMods(this.heroId);
      this.player = new Player(this.heroId, start.x, start.y, heroMods);
    } else {
      // Carry the same hero (with any perks) up; reposition + small heal.
      this.player.x = start.x; this.player.y = start.y;
      this.player.dashing = null; this.player.rope = null;
      this.player.cdAbility = this.player.cdTraverse = this.player.cdProjectile = 0;
      this.playerHealth = Math.min(this.playerHealthMax, this.playerHealth + 30);
    }

    const count = clamp(3 + Math.floor(this.level * 1.2), 3, 12);
    const placed = [{ x: this.player.x, y: this.player.y }];
    const MIN_APART = TILE * 5.5, MIN_FROM_PLAYER = TILE * 6;
    let guard = 0;
    while (this.enemies.length < count && guard++ < 400) {
      const pos = this.map.randomFloorPos();
      let ok = dist(pos.x, pos.y, this.player.x, this.player.y) >= MIN_FROM_PLAYER;
      for (const p of placed) if (dist(pos.x, pos.y, p.x, p.y) < MIN_APART) { ok = false; break; }
      if (!ok) continue;
      placed.push({ x: pos.x, y: pos.y });
      const wps = [{ x: pos.x, y: pos.y }];
      const n = randInt(this.rng, 2, 3);
      for (let k = 0; k < n; k++) { const wp = this.map.randomFloorPos(pos, TILE * 2.5); wps.push({ x: wp.x, y: wp.y }); }
      this.enemies.push(new Enemy(pos.x, pos.y, wps, {
        visionRange: TILE * (3.8 + Math.min(this.level * 0.12, 1.6)),
        visionHalf: 0.6,
        speed: 70 + Math.min(this.level * 2, 30),
      }));
    }
    guard = 0;
    while (this.enemies.length < 3 && guard++ < 100) {
      const pos = this.map.randomFloorPos({ x: this.player.x, y: this.player.y }, TILE * 4);
      this.enemies.push(new Enemy(pos.x, pos.y, [{ x: pos.x, y: pos.y }], { visionRange: TILE * 4, visionHalf: 0.6, speed: 74 }));
    }
    this.floorBanner = 2;
  }

  // Offered at the halfway floor.
  runPerkChoices() { return RUN_PERKS[this.heroId] || []; }

  applyPerk(id) {
    const perk = (RUN_PERKS[this.heroId] || []).find((p) => p.id === id);
    if (perk) { perk.apply(this.player.mods); this.player.applyMods(); }
    this.upgradedThisLevel = true;
    this.state = 'playing';
    this.nextFloor();
  }

  nextFloor() {
    if (this.floor >= this.floorsTotal) { this._win(); return; }
    this.floor++;
    this.audio.win();
    this.generateFloor(false);
  }

  // Called when the player steps into an active elevator.
  _useElevator() {
    if (this.floor === this.halfwayFloor && !this.upgradedThisLevel) {
      this.state = 'upgrade'; // main.js shows the field-upgrade screen
      return;
    }
    this.nextFloor();
  }

  _checkElevator() {
    if (this.enemiesRemaining() !== 0 || !this.map.extract) return;
    const ex = (this.map.extract.gx + 0.5) * TILE, ey = (this.map.extract.gy + 0.5) * TILE;
    if (dist(this.player.x, this.player.y, ex, ey) < TILE * 0.8) this._useElevator();
  }

  enemiesRemaining() { return this.enemies.filter((e) => !e.downed).length; }

  update(dt) {
    if (this.state !== 'playing') return;
    this.time += dt;
    this.input.pollKeyboard();

    this.player.update(dt, this.input, this);
    for (const e of this.enemies) e.update(dt, this);

    this._updateProjectiles(dt);
    this._updateEffects(dt);
    this._checkWebTraps();
    this._decaySounds(dt);
    this._updateAlarm(dt);
    if (this.playerHitFlash > 0) this.playerHitFlash -= dt;

    let exposure = 0;
    for (const e of this.enemies) if (!e.downed && e.canSeePlayer) exposure = Math.max(exposure, e.suspicion);
    this.player.detectionMeter = exposure;

    if (this.floorBanner > 0) this.floorBanner -= dt;

    this._checkElevator();
    if (this.playerHealth <= 0) this._lose();

    this.input.clearActions();
  }

  // --- Takedowns ---
  doTakedown(enemy, player, fromBehind) {
    if (enemy.downed) return;
    enemy.takeDown();
    this.audio.takedown();
    this.spawnFloater(enemy.x, enemy.y, fromBehind ? 'SILENT' : 'TAKEDOWN', '#8effc0');
    this.intelEarned += fromBehind ? 12 : 9;
  }

  // --- Signature projectiles ---
  fireProjectile(player, angle) {
    const def = player.hero.projectile;
    const mods = player.mods;
    this.audio.throwSfx();
    const ox = player.x + Math.cos(angle) * 18, oy = player.y + Math.sin(angle) * 18;

    if (def.type === 'billyclub') {
      const count = mods.clubCount;
      const bounces = def.bounces + mods.clubBounce;
      const spread = 0.22;
      for (let i = 0; i < count; i++) {
        const a = angle + (count > 1 ? (i - (count - 1) / 2) * spread : 0);
        this.projectiles.push({
          type: 'billyclub', x: ox, y: oy,
          vx: Math.cos(a) * def.speed, vy: Math.sin(a) * def.speed,
          bounces, hit: [], spin: 0, life: 2.6,
        });
      }
    } else if (def.type === 'batarang') {
      this.projectiles.push({
        type: 'batarang', x: ox, y: oy,
        vx: Math.cos(angle) * def.speed, vy: Math.sin(angle) * def.speed,
        speed: def.speed, hitsLeft: mods.batTargets, hit: [], phase: 'out',
        traveled: 0, range: def.range, spin: 0, life: 5,
      });
    } else if (def.type === 'web') {
      const count = mods.webCount;
      const spread = 0.16;
      for (let i = 0; i < count; i++) {
        const a = angle + (count > 1 ? (i - (count - 1) / 2) * spread : 0);
        this.projectiles.push({
          type: 'web', x: ox, y: oy,
          vx: Math.cos(a) * def.speed, vy: Math.sin(a) * def.speed,
          life: def.range / def.speed,
        });
      }
    }
  }

  enemyFire(enemy, playerPos) {
    const a = Math.atan2(playerPos.y - enemy.y, playerPos.x - enemy.x);
    const speed = 520;
    this.projectiles.push({
      type: 'bullet', enemy: true,
      x: enemy.x + Math.cos(a) * 18, y: enemy.y + Math.sin(a) * 18,
      vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: 1.2, dmg: 9,
    });
    this.audio.hit();
    this.emitSound(enemy.x, enemy.y, TILE * 5, 'alarm');
  }

  _koEnemy(e, x, y, label) {
    e.takeDown();
    this.audio.takedown();
    this.spawnFloater(x, y, label, '#ffd27a');
    this.intelEarned += 8;
    this.emitSound(x, y, TILE * 3, 'alarm'); // ranged KOs make noise
  }

  _updateProjectiles(dt) {
    const map = this.map;
    for (const p of this.projectiles) {
      if (p.type === 'billyclub') {
        p.spin += dt * 22;
        // Axis-separated wall bounce.
        let nx = p.x + p.vx * dt, ny = p.y + p.vy * dt;
        let bounced = false;
        if (map.isBlockedWorld(nx, p.y)) { p.vx = -p.vx; bounced = true; }
        if (map.isBlockedWorld(p.x, ny)) { p.vy = -p.vy; bounced = true; }
        if (bounced) { if (--p.bounces < 0) { p.life = 0; continue; } this.audio.hit(); }
        p.x += p.vx * dt; p.y += p.vy * dt;
        // Enemy hits.
        for (const e of this.enemies) {
          if (e.downed || p.hit.includes(e)) continue;
          if (dist(p.x, p.y, e.x, e.y) < e.radius + 8) {
            p.hit.push(e);
            this._koEnemy(e, e.x, e.y, 'KO');
            // Ricochet off the enemy: keep momentum with a small scatter so a
            // well-aimed throw ploughs through a line, counting one bounce each.
            const sp = Math.hypot(p.vx, p.vy);
            const a = Math.atan2(p.vy, p.vx) + (Math.random() - 0.5) * 0.7;
            p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp;
            if (--p.bounces < 0) { p.life = 0; }
            break;
          }
        }
        p.life -= dt;
      } else if (p.type === 'batarang') {
        p.spin += dt * 26;
        const sp = p.speed;
        if (p.phase === 'out') {
          // Steer toward nearest live enemy not yet hit.
          let tgt = null, td = 1e9;
          for (const e of this.enemies) {
            if (e.downed || p.hit.includes(e)) continue;
            const d = dist(p.x, p.y, e.x, e.y);
            if (d < td) { td = d; tgt = e; }
          }
          if (tgt) this._steer(p, tgt.x, tgt.y, sp, dt, 9);
          p.x += p.vx * dt; p.y += p.vy * dt; p.traveled += sp * dt;
          if (map.isBlockedWorld(p.x, p.y)) { // bounce off walls gently while seeking
            const a = Math.atan2(p.vy, p.vx) + Math.PI;
            p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp;
          }
          for (const e of this.enemies) {
            if (e.downed || p.hit.includes(e)) continue;
            if (dist(p.x, p.y, e.x, e.y) < e.radius + 7) {
              p.hit.push(e); this._koEnemy(e, e.x, e.y, 'KO');
              if (--p.hitsLeft <= 0) p.phase = 'back';
            }
          }
          if (!tgt || p.traveled > p.range) p.phase = 'back';
        } else {
          // Return to the player.
          this._steer(p, this.player.x, this.player.y, sp, dt, 12);
          p.x += p.vx * dt; p.y += p.vy * dt;
          for (const e of this.enemies) {
            if (e.downed || p.hit.includes(e)) continue;
            if (dist(p.x, p.y, e.x, e.y) < e.radius + 7) { p.hit.push(e); this._koEnemy(e, e.x, e.y, 'KO'); }
          }
          if (dist(p.x, p.y, this.player.x, this.player.y) < 20) p.life = 0;
        }
        p.life -= dt;
      } else if (p.type === 'web') {
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (map.isBlockedWorld(p.x, p.y)) { p.life = 0; this.spawnFloater(p.x, p.y, '·', '#dfe6ff'); }
        for (const e of this.enemies) {
          if (e.downed) continue;
          if (dist(p.x, p.y, e.x, e.y) < e.radius + 6) { this._koEnemy(e, e.x, e.y, 'WEBBED'); p.life = 0; break; }
        }
        p.life -= dt;
      } else if (p.type === 'bullet') {
        p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
        if (map.isBlockedWorld(p.x, p.y)) { p.life = 0; continue; }
        if (dist(p.x, p.y, this.player.x, this.player.y) < this.player.radius + 4) { this._damagePlayer(p.dmg); p.life = 0; }
      }
    }
    this.projectiles = this.projectiles.filter((p) => p.life > 0);
  }

  // Rotate a projectile's velocity toward a target at a max turn rate.
  _steer(p, tx, ty, sp, dt, turn) {
    const want = Math.atan2(ty - p.y, tx - p.x);
    let cur = Math.atan2(p.vy, p.vx);
    let d = want - cur;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    cur += clamp(d, -turn * dt, turn * dt);
    p.vx = Math.cos(cur) * sp; p.vy = Math.sin(cur) * sp;
  }

  _damagePlayer(dmg) {
    this.playerHealth = Math.max(0, this.playerHealth - dmg);
    this.playerHitFlash = 0.25;
    this.detections++;
    this.audio.hit();
  }

  // --- Sound & alarm ---
  emitSound(x, y, radius, type) { this.sounds.push({ x, y, radius, type, life: 0.25 }); }
  _decaySounds(dt) { for (const s of this.sounds) s.life -= dt; this.sounds = this.sounds.filter((s) => s.life > 0); }

  raiseAlarm(source) {
    this.alarm = 1;
    this.alertPings.push({ x: source.x, y: source.y, life: 0.9, max: 0.9 });
    this.audio.alert();
    for (const e of this.enemies) {
      if (e.downed || e === source) continue;
      if (dist(e.x, e.y, source.x, source.y) < TILE * 8) {
        e.lastKnown = { x: source.x, y: source.y };
        if (e.state === STATE.PATROL || e.state === STATE.IDLE || e.state === STATE.SUSPICIOUS) {
          e.suspicion = Math.max(e.suspicion, 0.5);
          e.state = STATE.SEARCHING; e.stateTimer = 0;
        }
      }
    }
  }

  _updateAlarm(dt) {
    const hot = this.enemies.some((e) => !e.downed && (e.state === STATE.COMBAT || e.state === STATE.ALERTED));
    if (hot) this.alarm = 1; else this.alarm = Math.max(0, this.alarm - dt * 0.25);
  }

  // --- Gadgets ---
  spawnSmoke(x, y, radius, duration) { this.smokes.push({ x, y, radius, duration, life: duration }); this.spawnFloater(x, y, 'SMOKE', '#cfd6e6'); }
  spawnWebTrap(x, y, duration, rootTime, radius) { this.webTraps.push({ x, y, radius: radius || 34, duration, life: duration, rootTime, armed: true }); this.spawnFloater(x, y, 'WEB TRAP', '#e6ebff'); }

  _checkWebTraps() {
    for (const w of this.webTraps) {
      if (!w.armed) continue;
      for (const e of this.enemies) {
        if (e.downed) continue;
        if (dist(w.x, w.y, e.x, e.y) < w.radius) {
          e.rooted = w.rootTime; w.armed = false;
          this.audio.gadget(); this.spawnFloater(e.x, e.y, 'ROOTED', '#e6ebff');
          break;
        }
      }
    }
  }

  spawnZipTrail(x, y) { this.zipTrails.push({ x, y, life: 1 }); }
  spawnFloater(x, y, text, color) { this.floaters.push({ x, y, text, color, life: 1 }); }

  _updateEffects(dt) {
    for (const s of this.smokes) s.life -= dt; this.smokes = this.smokes.filter((s) => s.life > 0);
    for (const w of this.webTraps) w.life -= dt; this.webTraps = this.webTraps.filter((w) => w.life > 0);
    for (const t of this.zipTrails) t.life -= dt * 2.2; this.zipTrails = this.zipTrails.filter((t) => t.life > 0);
    for (const a of this.alertPings) a.life -= dt; this.alertPings = this.alertPings.filter((a) => a.life > 0);
    for (const f of this.floaters) { f.y -= dt * 24; f.life -= dt * 0.8; } this.floaters = this.floaters.filter((f) => f.life > 0);
  }

  _win() {
    this.state = 'complete';
    this.audio.win();
    const stealthBonus = this.detections === 0 ? 80 : Math.max(0, 50 - this.detections * 8);
    this.intelEarned += 40 + this.baseLevel * 12 + this.floorsTotal * 10 + stealthBonus;
    this.progression.addIntel(this.intelEarned);
    this.progression.recordLevel(this.baseLevel + 1);
    this.lastResult = { win: true, intel: this.intelEarned, stealth: this.detections === 0, detections: this.detections, floors: this.floorsTotal };
  }

  _lose() {
    if (this.state !== 'playing') return;
    this.state = 'failed';
    this.audio.lose();
    this.intelEarned = Math.floor(this.intelEarned * 0.4);
    this.progression.addIntel(this.intelEarned);
    this.lastResult = { win: false, intel: this.intelEarned };
  }

  render(dt) {
    this.renderer.updateCamera(this, dt);
    this.renderer.render(this, this.time);
  }
}
