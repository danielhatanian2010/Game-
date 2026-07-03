// Persistent progression via localStorage: unlocked heroes, Intel currency,
// per-hero upgrade levels, and best sector reached.

import { HEROES } from './heroes.js';

const KEY = 'nightfall_save_v2';

function defaultData() {
  return {
    intel: 0,
    bestLevel: 1,
    selectedHero: 'daredevil',
    unlocked: { daredevil: true, bat: false, spider: false },
    upgrades: { daredevil: {}, bat: {}, spider: {} }, // upgrades[hero][key] = level
  };
}

export class Progression {
  constructor() { this.data = this._load(); }

  _load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaultData();
      const p = JSON.parse(raw);
      const d = defaultData();
      return {
        ...d, ...p,
        unlocked: { ...d.unlocked, ...(p.unlocked || {}) },
        upgrades: {
          daredevil: { ...(p.upgrades?.daredevil || {}) },
          bat: { ...(p.upgrades?.bat || {}) },
          spider: { ...(p.upgrades?.spider || {}) },
        },
      };
    } catch { return defaultData(); }
  }

  save() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch {} }

  addIntel(n) { this.data.intel += n; this.save(); }
  isUnlocked(id) { return !!this.data.unlocked[id]; }

  unlock(id) {
    const hero = HEROES[id];
    if (!hero || this.isUnlocked(id) || this.data.intel < hero.unlockCost) return false;
    this.data.intel -= hero.unlockCost;
    this.data.unlocked[id] = true;
    this.save();
    return true;
  }

  selectHero(id) { if (this.isUnlocked(id)) { this.data.selectedHero = id; this.save(); } }

  upgradeLevel(heroId, key) { return this.data.upgrades[heroId]?.[key] || 0; }

  buyUpgrade(heroId, key) {
    const hero = HEROES[heroId];
    const def = hero.upgrades.find((u) => u.key === key);
    if (!def) return false;
    const lvl = this.upgradeLevel(heroId, key);
    if (lvl >= def.max) return false;
    const cost = def.cost(lvl);
    if (this.data.intel < cost) return false;
    this.data.intel -= cost;
    this.data.upgrades[heroId][key] = lvl + 1;
    this.save();
    return true;
  }

  // Derived, gameplay-facing effect values for the given hero.
  heroMods(heroId) {
    const L = (k) => this.upgradeLevel(heroId, k);
    return {
      // Daredevil
      clubCount: 1 + L('clubCount'),
      clubBounce: L('clubBounce'),
      radarBonus: L('radarDur') * 1.5,
      // Batman
      batTargets: 1 + L('batTargets'),
      smokeBonus: L('smokeSize'),        // scales radius + duration
      // Spider
      webCount: 1 + L('webCount'),
      trapBonus: L('trapSize'),
      zipBonus: L('zipRange') * 0.22,    // fractional range increase
      // Shared-ish (still per hero)
      grappleCd: 1 - L('grappleCd') * 0.14,
      suspicionMult: 1 - L('intimidate') * 0.16,
      speedMult: 1 + L('agility') * 0.05,
    };
  }

  recordLevel(level) { if (level > this.data.bestLevel) { this.data.bestLevel = level; this.save(); } }
}
