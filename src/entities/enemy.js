// Masked-criminal enemy with a readable AI state machine:
//   PATROL -> IDLE -> SUSPICIOUS -> ALERTED -> COMBAT -> SEARCHING -> PATROL
// Perception = a vision cone (line-of-sight ray-checked) plus hearing of sound
// events. Navigation uses grid A* to route through corridors.

import { TILE } from '../mapgen.js';
import { findPath } from '../pathfind.js';
import { clamp, angleDiff, rotateToward, TAU, dist } from '../utils.js';

export const STATE = {
  PATROL: 'Patrol',
  IDLE: 'Idle',
  SUSPICIOUS: 'Suspicious',
  ALERTED: 'Alerted',
  COMBAT: 'Combat',
  SEARCHING: 'Searching',
};

export class Enemy {
  constructor(x, y, waypoints, opts = {}) {
    this.x = x;
    this.y = y;
    this.radius = 15;
    this.angle = Math.random() * TAU;

    this.waypoints = waypoints;    // array of {x,y}
    this.wpIndex = 0;

    this.state = STATE.PATROL;
    this.suspicion = 0;            // 0..1; crosses thresholds to change state
    this.stateTimer = 0;

    this.visionRange = opts.visionRange || TILE * 4.2;
    this.visionHalf = opts.visionHalf || 0.62; // half-angle of cone (radians)
    this.speedPatrol = opts.speed || 74;
    this.speedAlert = (opts.speed || 74) * 1.7;
    this.turnSpeed = 3.2;

    this.lastKnown = null;         // {x,y} last confirmed player position
    this.path = null;
    this.pathIndex = 0;
    this.repathTimer = 0;
    this.target = null;            // current move target {x,y}

    this.fireCooldown = 0;
    this.stun = 0;                 // stunned by gadget (can't act)
    this.rooted = 0;               // held by web trap (can't move, can see)
    this.downed = false;           // taken down (permanently out)
    this.dead = false;             // alias for downed; kept for clarity

    this.hitFlash = 0;
    this.canSeePlayer = false;     // updated each frame for rendering
  }

  gx() { return Math.floor(this.x / TILE); }
  gy() { return Math.floor(this.y / TILE); }

  update(dt, game) {
    if (this.downed) return;
    this.stateTimer += dt;
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt);

    if (this.stun > 0) {
      this.stun -= dt;
      this.canSeePlayer = false;
      return; // fully incapacitated but not out
    }
    if (this.rooted > 0) this.rooted -= dt;

    // --- Perception ---
    const vis = this._perceivePlayer(game);
    this.canSeePlayer = vis > 0;
    this._hearSounds(game);

    // Suspicion dynamics.
    const susMod = game.player.mods.suspicionMult;
    if (vis > 0) {
      this.suspicion = clamp(this.suspicion + vis * dt * 1.7 * susMod, 0, 1);
      this.lastKnown = { x: game.player.x, y: game.player.y };
      // Face the player while we can see them.
      const a = Math.atan2(game.player.y - this.y, game.player.x - this.x);
      this.angle = rotateToward(this.angle, a, this.turnSpeed * 2 * dt);
    } else {
      // Decay depends on state (alerted enemies stay tense longer).
      const decay = this.state === STATE.COMBAT || this.state === STATE.ALERTED ? 0.12 : 0.5;
      this.suspicion = clamp(this.suspicion - decay * dt, 0, 1);
    }

    this._runState(dt, game, vis);
  }

  _runState(dt, game, vis) {
    switch (this.state) {
      case STATE.PATROL: {
        this._patrol(dt, game);
        if (this.suspicion > 0.25) this._enter(STATE.SUSPICIOUS, game);
        break;
      }
      case STATE.IDLE: {
        // Pause and glance around.
        this.angle += Math.sin(this.stateTimer * 2) * dt * 0.9;
        if (this.stateTimer > 1.4) this._enter(STATE.PATROL, game);
        if (this.suspicion > 0.25) this._enter(STATE.SUSPICIOUS, game);
        break;
      }
      case STATE.SUSPICIOUS: {
        // Turn toward and slowly approach the stimulus.
        if (this.lastKnown) {
          const a = Math.atan2(this.lastKnown.y - this.y, this.lastKnown.x - this.x);
          this.angle = rotateToward(this.angle, a, this.turnSpeed * dt);
          this._moveTo(this.lastKnown, this.speedPatrol * 0.75, dt, game);
        }
        if (this.suspicion >= 0.85) { this._enter(STATE.ALERTED, game); }
        else if (this.suspicion < 0.12) { this._enter(STATE.SEARCHING, game); }
        break;
      }
      case STATE.ALERTED: {
        // Confirmed. Raise the alarm once, then close for combat.
        if (!this._alarmRaised) { this._alarmRaised = true; game.raiseAlarm(this); }
        if (vis > 0) this._enter(STATE.COMBAT, game);
        else if (this.lastKnown) {
          this._moveTo(this.lastKnown, this.speedAlert, dt, game);
          if (dist(this.x, this.y, this.lastKnown.x, this.lastKnown.y) < TILE * 0.6)
            this._enter(STATE.SEARCHING, game);
        }
        break;
      }
      case STATE.COMBAT: {
        this._combat(dt, game, vis);
        break;
      }
      case STATE.SEARCHING: {
        // Sweep toward last known, look around, then give up.
        if (this.lastKnown) {
          this._moveTo(this.lastKnown, this.speedAlert * 0.8, dt, game);
          if (dist(this.x, this.y, this.lastKnown.x, this.lastKnown.y) < TILE * 0.7) {
            this.lastKnown = null;
            this.stateTimer = 0;
          }
        } else {
          this.angle += Math.sin(this.stateTimer * 2.5) * dt * 1.6;
          if (this.stateTimer > 3.5) { this._alarmRaised = false; this._enter(STATE.PATROL, game); }
        }
        if (this.suspicion > 0.55) this._enter(STATE.SUSPICIOUS, game);
        break;
      }
    }
  }

  _enter(state, game) {
    if (this.state === state) return;
    const prev = this.state;
    this.state = state;
    this.stateTimer = 0;
    this.path = null;
    if (state === STATE.SUSPICIOUS && prev === STATE.PATROL) game.audio.suspicious();
    if (state === STATE.ALERTED) game.audio.alert();
  }

  _patrol(dt, game) {
    if (!this.waypoints.length) { this._enter(STATE.IDLE, game); return; }
    const wp = this.waypoints[this.wpIndex];
    this._moveTo(wp, this.speedPatrol, dt, game);
    if (dist(this.x, this.y, wp.x, wp.y) < TILE * 0.5) {
      this.wpIndex = (this.wpIndex + 1) % this.waypoints.length;
      if (Math.random() < 0.4) this._enter(STATE.IDLE, game);
    }
  }

  _combat(dt, game, vis) {
    const p = game.player;
    if (vis > 0) this.lastKnown = { x: p.x, y: p.y };
    if (vis <= 0) {
      // Lost sight — go search after a beat.
      if (this.stateTimer > 1.2) this._enter(STATE.SEARCHING, game);
      if (this.lastKnown) this._moveTo(this.lastKnown, this.speedAlert, dt, game);
      return;
    }
    const d = dist(this.x, this.y, p.x, p.y);
    const a = Math.atan2(p.y - this.y, p.x - this.x);
    this.angle = rotateToward(this.angle, a, this.turnSpeed * 2.2 * dt);
    // Keep a firing distance: approach if far, hold if in range.
    const idealRange = TILE * 3.2;
    if (d > idealRange) this._moveTo({ x: p.x, y: p.y }, this.speedAlert, dt, game);
    // Fire.
    if (this.fireCooldown <= 0 && d < this.visionRange && Math.abs(angleDiff(this.angle, a)) < 0.35) {
      this.fireCooldown = 1.1;
      game.enemyFire(this, p);
    }
  }

  // --- Perception helpers ---

  _perceivePlayer(game) {
    const p = game.player;
    if (p.hidden) return 0; // hidden by own smoke
    // Smoke clouds between us and the player block sight.
    const d = dist(this.x, this.y, p.x, p.y);
    if (d > this.visionRange) return 0;
    const a = Math.atan2(p.y - this.y, p.x - this.x);
    const off = Math.abs(angleDiff(this.angle, a));
    // In-combat/alerted enemies have slightly wider awareness.
    const half = this.state === STATE.COMBAT ? this.visionHalf + 0.3 : this.visionHalf;
    if (off > half) return 0;
    if (!this._lineOfSight(game, p.x, p.y)) return 0;
    if (this._smokeBlocks(game, p.x, p.y)) return 0;

    // Detection strength: stronger when close, centered, and player is lit.
    const near = 1 - d / this.visionRange;
    const centered = 1 - off / half;
    let light = 0.5;
    for (const L of game.map.lights) {
      const ld = dist(p.x, p.y, L.x, L.y);
      if (ld < L.r) light = Math.max(light, 1 - ld / L.r);
    }
    const crouchFactor = p.moving ? 1 : 0.7; // standing still is a bit stealthier
    return clamp((0.4 + near * 0.6) * (0.5 + centered * 0.5) * (0.6 + light * 0.6) * crouchFactor, 0, 1.4);
  }

  _lineOfSight(game, tx, ty) {
    // Sample along the segment; blocked if any sample hits a wall cell.
    const steps = Math.ceil(dist(this.x, this.y, tx, ty) / (TILE * 0.4));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const sx = this.x + (tx - this.x) * t;
      const sy = this.y + (ty - this.y) * t;
      if (game.map.isBlockedWorld(sx, sy)) return false;
    }
    return true;
  }

  _smokeBlocks(game, tx, ty) {
    for (const s of game.smokes) {
      // Distance from smoke center to the sight segment.
      if (this._segCircle(this.x, this.y, tx, ty, s.x, s.y, s.radius * 0.8)) return true;
    }
    return false;
  }

  _segCircle(ax, ay, bx, by, cx, cy, r) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy || 1;
    let t = ((cx - ax) * dx + (cy - ay) * dy) / l2;
    t = clamp(t, 0, 1);
    const px = ax + dx * t, py = ay + dy * t;
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
  }

  _hearSounds(game) {
    if (this.state === STATE.COMBAT || this.downed) return;
    for (const snd of game.sounds) {
      const d = dist(this.x, this.y, snd.x, snd.y);
      if (d < snd.radius) {
        // Louder/closer sounds bump suspicion and mark a location to check.
        const strength = (1 - d / snd.radius) * (snd.type === 'alarm' ? 1 : 0.5);
        this.suspicion = clamp(this.suspicion + strength * 0.5, 0, 1);
        if (this.suspicion > 0.15) this.lastKnown = { x: snd.x, y: snd.y };
        if (this.state === STATE.PATROL || this.state === STATE.IDLE) {
          if (this.suspicion > 0.25) this._enter(STATE.SUSPICIOUS, game);
        }
      }
    }
  }

  // --- Navigation ---

  _moveTo(target, speed, dt, game) {
    if (this.rooted > 0) return;
    this.target = target;
    this.repathTimer -= dt;
    const tgx = Math.floor(target.x / TILE), tgy = Math.floor(target.y / TILE);
    const needRepath = !this.path || this.repathTimer <= 0 ||
      this._pathTarget?.gx !== tgx || this._pathTarget?.gy !== tgy;
    if (needRepath) {
      this.path = findPath(game.map, this.gx(), this.gy(), tgx, tgy);
      this.pathIndex = 0;
      this._pathTarget = { gx: tgx, gy: tgy };
      this.repathTimer = 0.5;
    }

    let aimX = target.x, aimY = target.y;
    if (this.path && this.path.length > 1) {
      // Advance along path nodes.
      let node = this.path[this.pathIndex];
      let nodeX = (node.gx + 0.5) * TILE, nodeY = (node.gy + 0.5) * TILE;
      if (dist(this.x, this.y, nodeX, nodeY) < TILE * 0.4 && this.pathIndex < this.path.length - 1) {
        this.pathIndex++;
        node = this.path[this.pathIndex];
        nodeX = (node.gx + 0.5) * TILE; nodeY = (node.gy + 0.5) * TILE;
      }
      aimX = nodeX; aimY = nodeY;
    }

    const a = Math.atan2(aimY - this.y, aimX - this.x);
    // Only turn toward travel direction when not actively facing the player.
    if (this.state !== STATE.COMBAT && this.state !== STATE.ALERTED)
      this.angle = rotateToward(this.angle, a, this.turnSpeed * dt);
    const nx = this.x + Math.cos(a) * speed * dt;
    const ny = this.y + Math.sin(a) * speed * dt;
    // Collision (axis separated).
    if (!game.map.isBlockedWorld(nx + Math.sign(Math.cos(a)) * this.radius, this.y))
      this.x = nx;
    if (!game.map.isBlockedWorld(this.x, ny + Math.sign(Math.sin(a)) * this.radius))
      this.y = ny;
  }

  takeDown() {
    this.downed = true;
    this.dead = true;
    this.canSeePlayer = false;
  }

  stunFor(t) {
    this.stun = Math.max(this.stun, t);
    this.hitFlash = 0.25;
    // Being hit makes them suspicious toward last stimulus.
    this.suspicion = Math.max(this.suspicion, 0.4);
  }
}
