// Persistent progression via localStorage: unlocked heroes, currency (Intel),
// permanent upgrades, and best level reached.

import { HEROES } from './heroes.js';

const KEY = 'nightfall_save_v1';

const DEFAULT = {
  intel: 0,
  bestLevel: 1,
  selectedHero: 'daredevil',
  unlocked: { daredevil: true, bat: false, spider: false },
  upgrades: {
    takedownSpeed: 0, // faster takedown windup
    detection: 0,     // slower enemy suspicion buildup
    cooldown: 0,      // faster ability cooldowns
    speed: 0,         // move speed
  },
};

export const UPGRADE_DEFS = {
  takedownSpeed: { name: 'Silent Hands', desc: 'Takedowns land faster', max: 4, cost: (l) => 60 + l * 50 },
  detection: { name: 'Ghost Step', desc: 'Enemies notice you slower', max: 4, cost: (l) => 70 + l * 55 },
  cooldown: { name: 'Field Tech', desc: 'Gadget cooldowns recharge faster', max: 4, cost: (l) => 80 + l * 60 },
  speed: { name: 'Fleet Foot', desc: 'Move a little faster', max: 3, cost: (l) => 90 + l * 70 },
};

export class Progression {
  constructor() {
    this.data = this._load();
  }

  _load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return structuredClone(DEFAULT);
      const parsed = JSON.parse(raw);
      // Merge with defaults so new fields survive upgrades.
      return {
        ...structuredClone(DEFAULT),
        ...parsed,
        unlocked: { ...DEFAULT.unlocked, ...(parsed.unlocked || {}) },
        upgrades: { ...DEFAULT.upgrades, ...(parsed.upgrades || {}) },
      };
    } catch {
      return structuredClone(DEFAULT);
    }
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch {}
  }

  addIntel(n) { this.data.intel += n; this.save(); }

  isUnlocked(id) { return !!this.data.unlocked[id]; }

  unlock(id) {
    const hero = HEROES[id];
    if (!hero || this.isUnlocked(id)) return false;
    if (this.data.intel < hero.unlockCost) return false;
    this.data.intel -= hero.unlockCost;
    this.data.unlocked[id] = true;
    this.save();
    return true;
  }

  selectHero(id) {
    if (this.isUnlocked(id)) { this.data.selectedHero = id; this.save(); }
  }

  upgradeLevel(key) { return this.data.upgrades[key] || 0; }

  buyUpgrade(key) {
    const def = UPGRADE_DEFS[key];
    const lvl = this.upgradeLevel(key);
    if (lvl >= def.max) return false;
    const cost = def.cost(lvl);
    if (this.data.intel < cost) return false;
    this.data.intel -= cost;
    this.data.upgrades[key] = lvl + 1;
    this.save();
    return true;
  }

  // Derived multipliers used by gameplay.
  mods() {
    const u = this.data.upgrades;
    return {
      takedownMult: 1 - u.takedownSpeed * 0.15,     // faster
      suspicionMult: 1 - u.detection * 0.16,        // slower buildup
      cooldownMult: 1 - u.cooldown * 0.15,          // faster recharge
      speedMult: 1 + u.speed * 0.06,
    };
  }

  recordLevel(level) {
    if (level > this.data.bestLevel) { this.data.bestLevel = level; this.save(); }
  }
}
