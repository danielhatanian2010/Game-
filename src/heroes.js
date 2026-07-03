// Hero definitions. Each hero shares the same base stealth kit (movement +
// contextual takedown) but has a distinct ABILITY and GRAPPLE-slot power plus
// a signature color. Abilities are original takes, not licensed characters.

export const HEROES = {
  daredevil: {
    id: 'daredevil',
    name: 'Warden',
    tag: 'The Fearless',
    color: '#e23b3b',
    accent: '#ff6b6b',
    desc: 'Blind vigilante. Radar Sense reveals foes through walls; a thrown baton stuns at range.',
    speed: 172,
    unlockCost: 0,
    ability: {
      name: 'Radar Sense',
      key: 'ability',
      cooldown: 9,
      // Reveal all enemies through walls for a short window.
      type: 'radar',
      duration: 4,
    },
    grapple: {
      name: 'Baton Throw',
      key: 'grapple',
      cooldown: 3,
      // Ranged stun in facing direction.
      type: 'throw',
      range: 360,
      stun: 3.5,
    },
  },

  bat: {
    id: 'bat',
    name: 'Nightfall',
    tag: 'The Shadow',
    color: '#3a5bd9',
    accent: '#7aa0ff',
    desc: 'Caped detective. Drop a smoke screen to break line-of-sight; batarangs stun at range.',
    speed: 165,
    unlockCost: 120,
    ability: {
      name: 'Smoke Screen',
      key: 'ability',
      cooldown: 11,
      // Blinds enemies whose sightline crosses the cloud; hides player.
      type: 'smoke',
      radius: 150,
      duration: 5,
    },
    grapple: {
      name: 'Batarang',
      key: 'grapple',
      cooldown: 2.5,
      type: 'throw',
      range: 420,
      stun: 3,
    },
  },

  spider: {
    id: 'spider',
    name: 'Weaver',
    tag: 'The Silk',
    color: '#c33bd9',
    accent: '#e07bff',
    desc: 'Wall-crawler. Web-zip dashes across the arena; web traps root patrolling foes.',
    speed: 178,
    unlockCost: 200,
    ability: {
      name: 'Web Trap',
      key: 'ability',
      cooldown: 7,
      // Places a sticky node; first enemy to touch it is rooted.
      type: 'webtrap',
      duration: 6,
      rootTime: 4,
    },
    grapple: {
      name: 'Web Zip',
      key: 'grapple',
      cooldown: 2,
      // Fast dash in facing direction (stops at walls).
      type: 'zip',
      range: 300,
      speed: 900,
    },
  },
};

export const HERO_ORDER = ['daredevil', 'bat', 'spider'];
