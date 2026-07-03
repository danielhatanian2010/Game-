// Hero definitions. Each hero has three action slots:
//   ability   (◎) — hero power (radar / smoke / web trap)
//   traversal (⤴) — movement tool (grapple hook / web zip)   [replaces old dash]
//   projectile(➤) — signature thrown weapon (billy club / batarang / web shot)
// plus its own upgrade tree. Designs are original homages, not licensed art.

export const HEROES = {
  daredevil: {
    id: 'daredevil',
    name: 'Warden',
    tag: 'The Fearless',
    spriteKind: 'daredevil',
    color: '#d02a2a',
    accent: '#ff6b6b',
    desc: 'Blind vigilante. Radar Sense reveals foes through walls; ricocheting billy clubs bounce between them.',
    speed: 172,
    unlockCost: 0,
    ability: { name: 'Radar Sense', type: 'radar', cooldown: 9, duration: 4 },
    traversal: { name: 'Grapple Hook', type: 'grapple', cooldown: 3.5, range: 340, speed: 1050 },
    projectile: { name: 'Billy Club', type: 'billyclub', cooldown: 3.2, range: 900, speed: 560, bounces: 3 },
    upgrades: [
      { key: 'clubCount', name: 'Double Billy Clubs', desc: 'Throw an extra club in a fan', max: 2, cost: (l) => 90 + l * 90 },
      { key: 'clubBounce', name: 'Ricochet Mastery', desc: '+1 wall/enemy bounce per level', max: 2, cost: (l) => 80 + l * 70 },
      { key: 'radarDur', name: 'Heightened Senses', desc: 'Radar Sense lasts longer', max: 3, cost: (l) => 70 + l * 55 },
      { key: 'grappleCd', name: 'Swift Line', desc: 'Grapple recharges faster', max: 3, cost: (l) => 75 + l * 60 },
    ],
  },

  bat: {
    id: 'bat',
    name: 'Nightfall',
    tag: 'The Shadow',
    spriteKind: 'bat',
    color: '#2b3350',
    accent: '#7aa0ff',
    desc: 'Caped detective. Smoke breaks line-of-sight; the batarang seeks a target, strikes, and returns.',
    speed: 165,
    unlockCost: 120,
    ability: { name: 'Smoke Screen', type: 'smoke', cooldown: 11, radius: 150, duration: 5 },
    traversal: { name: 'Grapple Hook', type: 'grapple', cooldown: 3.5, range: 360, speed: 1050 },
    projectile: { name: 'Batarang', type: 'batarang', cooldown: 3, range: 520, speed: 620, targets: 1 },
    upgrades: [
      { key: 'batTargets', name: 'Twin Batarang', desc: 'Batarang strikes an extra target', max: 2, cost: (l) => 95 + l * 90 },
      { key: 'smokeSize', name: 'Thick Smoke', desc: 'Bigger, longer smoke screen', max: 3, cost: (l) => 70 + l * 55 },
      { key: 'grappleCd', name: 'Grapple Tune', desc: 'Grapple recharges faster', max: 3, cost: (l) => 75 + l * 60 },
      { key: 'intimidate', name: 'Intimidation', desc: 'Enemies notice you slower', max: 3, cost: (l) => 80 + l * 60 },
    ],
  },

  spider: {
    id: 'spider',
    name: 'Weaver',
    tag: 'The Silk',
    spriteKind: 'spider',
    color: '#b02fd0',
    accent: '#e07bff',
    desc: 'Wall-crawler. Web-zip dashes across the arena; web shots take down foes at range and web traps root patrols.',
    speed: 178,
    unlockCost: 200,
    ability: { name: 'Web Trap', type: 'webtrap', cooldown: 7, duration: 6, rootTime: 4, radius: 34 },
    traversal: { name: 'Web Zip', type: 'zip', cooldown: 2, range: 320, speed: 950 },
    projectile: { name: 'Web Shot', type: 'web', cooldown: 2.4, range: 560, speed: 720 },
    upgrades: [
      { key: 'webCount', name: 'Twin Web Shot', desc: 'Fire an extra web strand', max: 2, cost: (l) => 90 + l * 90 },
      { key: 'trapSize', name: 'Wide Web', desc: 'Larger trap, longer root', max: 3, cost: (l) => 70 + l * 55 },
      { key: 'zipRange', name: 'Long Line', desc: 'Web-zip reaches farther', max: 3, cost: (l) => 75 + l * 60 },
      { key: 'agility', name: 'Spider Agility', desc: 'Move a little faster', max: 3, cost: (l) => 85 + l * 65 },
    ],
  },
};

export const HERO_ORDER = ['daredevil', 'bat', 'spider'];

// Mid-run "field upgrades" offered at the halfway floor. Pick one; it modifies
// the player's mods for the rest of the building. Hero-specific.
export const RUN_PERKS = {
  daredevil: [
    { id: 'triClub', name: 'Triple Clubs', desc: 'Throw three billy clubs at once', apply: (m) => { m.clubCount = Math.max(m.clubCount, 3); } },
    { id: 'ricochet', name: 'Wild Ricochet', desc: '+2 club bounces', apply: (m) => { m.clubBounce += 2; } },
    { id: 'deepRadar', name: 'Deep Radar', desc: 'Radar Sense lasts +3s', apply: (m) => { m.radarBonus += 3; } },
  ],
  bat: [
    { id: 'twinBat', name: 'Swarm Batarang', desc: 'Batarang strikes +2 targets', apply: (m) => { m.batTargets += 2; } },
    { id: 'denseSmoke', name: 'Dense Smoke', desc: 'Bigger, longer smoke screen', apply: (m) => { m.smokeBonus += 2; } },
    { id: 'ghost', name: 'Ghost Step', desc: 'Enemies notice you much slower', apply: (m) => { m.suspicionMult *= 0.7; } },
  ],
  spider: [
    { id: 'twinWeb', name: 'Triple Web', desc: 'Fire two extra web strands', apply: (m) => { m.webCount += 2; } },
    { id: 'wideTrap', name: 'Wide Web', desc: 'Bigger trap, longer root', apply: (m) => { m.trapBonus += 2; } },
    { id: 'longZip', name: 'Long Line', desc: 'Web-zip reaches much farther', apply: (m) => { m.zipBonus += 0.5; } },
  ],
};
