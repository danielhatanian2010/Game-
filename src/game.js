// The Game orchestrates one mission: map, player, enemies, gadget effects,
// sound events, alarm propagation, and win/lose. main.js owns screens and the
// loop and calls update()/render() here.

import { GameMap, TILE } from './mapgen.js';
import { Player } from './entities/player.js';
import { Enemy, STATE } from './entities/enemy.js';
import { makeRng, randInt, clamp, dist } from './utils.js';

export class Game {
  constructor({ input, audio, renderer, progression, heroId, level }) {
    this.input = input;
    this.audio = audio;
    this.renderer = renderer;
    this.progression = progression;
    this.level = level;
    this.heroId = heroId;

    this.state = 'playing'; // playing | complete | failed
    this.time = 0;
    this.alarm = 0;         // global alarm 0..1
    this.detections = 0;    // how many times spotted (for scoring)
    this.intelEarned = 0;

    this.seed = (Date.now() ^ (level * 2654435761)) >>> 0;
    this.rng = makeRng(this.seed);
    this.map = new GameMap(this.seed, level);

    // Transient world objects.
    this.enemies = [];
    this.projectiles = [];
    this.sounds = [];      // active sound events (decay each frame)
    this.smokes = [];
    this.webTraps = [];
    this.zipTrails = [];
    this.alertPings = [];
    this.floaters = [];    // score/text popups (screen space) handled in main

    this.playerHealthMax = 100;
    this.playerHealth = 100;
    this.playerHitFlash = 0;

    this._spawn();
  }

  _spawn() {
    const mods = this.progression.mods();
    // Player starts near map center-ish, away from extract.
    const start = this.map.randomFloorPos();
    this.player = new Player(this.heroId, start.x, start.y, mods);

    // Enemy count scales with level.
    const count = clamp(3 + Math.floor(this.level * 1.2), 3, 12);
    const extractPos = {
      x: (this.map.extract.gx + 0.5) * TILE,
      y: (this.map.extract.gy + 0.5) * TILE,
    };
    for (let i = 0; i < count; i++) {
      const pos = this.map.randomFloorPos({ x: this.player.x, y: this.player.y }, TILE * 4);
      // Build a small patrol loop from nearby floor tiles.
      const wps = [{ x: pos.x, y: pos.y }];
      const n = randInt(this.rng, 2, 3);
      for (let k = 0; k < n; k++) {
        const wp = this.map.randomFloorPos(pos, TILE * 2);
        wps.push({ x: wp.x, y: wp.y });
      }
      const e = new Enemy(pos.x, pos.y, wps, {
        visionRange: TILE * (3.8 + Math.min(this.level * 0.12, 1.6)),
        visionHalf: 0.6,
        speed: 70 + Math.min(this.level * 2, 30),
      });
      this.enemies.push(e);
    }
  }

  enemiesRemaining() {
    return this.enemies.filter((e) => !e.downed).length;
  }

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

    // Exposure meter for HUD: highest suspicion among enemies that can see us.
    let exposure = 0;
    for (const e of this.enemies) if (!e.downed) exposure = Math.max(exposure, e.canSeePlayer ? e.suspicion : 0);
    this.player.detectionMeter = exposure;

    // Win: all enemies down AND player on extract pad.
    if (this.enemiesRemaining() === 0) {
      const ex = (this.map.extract.gx + 0.5) * TILE;
      const ey = (this.map.extract.gy + 0.5) * TILE;
      if (dist(this.player.x, this.player.y, ex, ey) < TILE * 0.7) this._win();
    }

    // Lose: health depleted.
    if (this.playerHealth <= 0) this._lose();

    this.input.clearActions();
  }

  // --- Combat / interactions ---

  doTakedown(enemy, player, fromBehind) {
    if (enemy.downed) return;
    enemy.takeDown();
    this.audio.takedown();
    this.spawnFloater(enemy.x, enemy.y, fromBehind ? 'SILENT' : 'TAKEDOWN', '#8effc0');
    // A loud-ish takedown from the front makes a small noise nearby enemies hear.
    if (!fromBehind) this.emitSound(enemy.x, enemy.y, TILE * 2.4, 'step');
    this.intelEarned += fromBehind ? 12 : 8;
  }

  enemyFire(enemy, player) {
    // Enemy shoots a slow tracer at the player's current position.
    const a = Math.atan2(player.y - enemy.y, player.x - enemy.x);
    const speed = 520;
    this.projectiles.push({
      x: enemy.x + Math.cos(a) * 18, y: enemy.y + Math.sin(a) * 18,
      vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
      enemy: true, life: 1.2, dmg: 9,
    });
    this.audio.hit();
    this.emitSound(enemy.x, enemy.y, TILE * 5, 'alarm');
  }

  spawnProjectile(x, y, angle, range, stun) {
    const speed = 780;
    this.projectiles.push({
      x: x + Math.cos(angle) * 18, y: y + Math.sin(angle) * 18,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      enemy: false, life: range / speed, stun,
    });
  }

  _updateProjectiles(dt) {
    for (const pr of this.projectiles) {
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      pr.life -= dt;
      if (this.map.isBlockedWorld(pr.x, pr.y)) { pr.life = 0; continue; }
      if (pr.enemy) {
        // Hit the player?
        if (dist(pr.x, pr.y, this.player.x, this.player.y) < this.player.radius + 4) {
          this._damagePlayer(pr.dmg);
          pr.life = 0;
        }
      } else {
        // Player gadget: stun the first enemy hit.
        for (const e of this.enemies) {
          if (e.downed) continue;
          if (dist(pr.x, pr.y, e.x, e.y) < e.radius + 5) {
            e.stunFor(pr.stun);
            this.audio.hit();
            this.spawnFloater(e.x, e.y, 'STUN', '#bfe0ff');
            this.emitSound(e.x, e.y, TILE * 2, 'step');
            pr.life = 0;
            break;
          }
        }
      }
    }
    this.projectiles = this.projectiles.filter((p) => p.life > 0);
  }

  _damagePlayer(dmg) {
    this.playerHealth = Math.max(0, this.playerHealth - dmg);
    this.playerHitFlash = 0.25;
    this.detections++;
    this.audio.hit();
  }

  // --- Sound & alarm ---

  emitSound(x, y, radius, type) {
    this.sounds.push({ x, y, radius, type, life: 0.25 });
  }

  _decaySounds(dt) {
    for (const s of this.sounds) s.life -= dt;
    this.sounds = this.sounds.filter((s) => s.life > 0);
  }

  raiseAlarm(source) {
    this.alarm = 1;
    this.alertPings.push({ x: source.x, y: source.y, life: 0.9, max: 0.9 });
    this.audio.alert();
    // Nearby patrolling enemies converge on the source.
    for (const e of this.enemies) {
      if (e.downed || e === source) continue;
      if (dist(e.x, e.y, source.x, source.y) < TILE * 8) {
        e.lastKnown = { x: source.x, y: source.y };
        if (e.state === STATE.PATROL || e.state === STATE.IDLE || e.state === STATE.SUSPICIOUS) {
          e.suspicion = Math.max(e.suspicion, 0.5);
          e.state = STATE.SEARCHING;
          e.stateTimer = 0;
        }
      }
    }
  }

  _updateAlarm(dt) {
    // Alarm cools down when nobody is alerted/combat.
    const anyHot = this.enemies.some((e) => !e.downed && (e.state === STATE.COMBAT || e.state === STATE.ALERTED));
    if (anyHot) this.alarm = 1;
    else this.alarm = Math.max(0, this.alarm - dt * 0.25);
  }

  // --- Gadgets ---

  spawnSmoke(x, y, radius, duration) {
    this.smokes.push({ x, y, radius, duration, life: duration });
    this.spawnFloater(x, y, 'SMOKE', '#cfd6e6');
  }

  spawnWebTrap(x, y, duration, rootTime) {
    this.webTraps.push({ x, y, radius: 34, duration, life: duration, rootTime, armed: true });
    this.spawnFloater(x, y, 'WEB TRAP', '#e6ebff');
  }

  _checkWebTraps() {
    for (const w of this.webTraps) {
      if (!w.armed) continue;
      for (const e of this.enemies) {
        if (e.downed) continue;
        if (dist(w.x, w.y, e.x, e.y) < w.radius) {
          e.rooted = w.rootTime;
          w.armed = false;
          this.audio.gadget();
          this.spawnFloater(e.x, e.y, 'ROOTED', '#e6ebff');
          break;
        }
      }
    }
  }

  spawnZipTrail(x, y) {
    this.zipTrails.push({ x, y, life: 1 });
  }

  spawnFloater(x, y, text, color) {
    this.floaters.push({ x, y, text, color, life: 1 });
  }

  _updateEffects(dt) {
    for (const s of this.smokes) s.life -= dt;
    this.smokes = this.smokes.filter((s) => s.life > 0);
    for (const w of this.webTraps) w.life -= dt;
    this.webTraps = this.webTraps.filter((w) => w.life > 0);
    for (const t of this.zipTrails) t.life -= dt * 2.2;
    this.zipTrails = this.zipTrails.filter((t) => t.life > 0);
    for (const a of this.alertPings) a.life -= dt;
    this.alertPings = this.alertPings.filter((a) => a.life > 0);
    for (const f of this.floaters) { f.y -= dt * 24; f.life -= dt * 0.8; }
    this.floaters = this.floaters.filter((f) => f.life > 0);
  }

  // --- End states ---

  _win() {
    this.state = 'complete';
    this.audio.win();
    // Reward: base + stealth bonus + level bonus.
    const stealthBonus = this.detections === 0 ? 60 : Math.max(0, 40 - this.detections * 8);
    this.intelEarned += 30 + this.level * 10 + stealthBonus;
    this.progression.addIntel(this.intelEarned);
    this.progression.recordLevel(this.level + 1);
    this.lastResult = { win: true, intel: this.intelEarned, stealth: this.detections === 0, detections: this.detections };
  }

  _lose() {
    if (this.state !== 'playing') return;
    this.state = 'failed';
    this.audio.lose();
    // Small consolation intel.
    this.intelEarned = Math.floor(this.intelEarned * 0.4);
    this.progression.addIntel(this.intelEarned);
    this.lastResult = { win: false, intel: this.intelEarned };
  }

  render(dt) {
    this.renderer.updateCamera(this, dt);
    this.renderer.render(this, this.time);
  }
}
