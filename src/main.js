// Entry point: wires screens, the game loop, and HUD updates together.

import { Renderer } from './render.js';
import { Input } from './input.js';
import { AudioManager } from './audio.js';
import { Progression } from './progression.js';
import { Game } from './game.js';
import { HEROES, HERO_ORDER } from './heroes.js';

const canvas = document.getElementById('game');
const renderer = new Renderer(canvas);
const input = new Input(canvas);
const audio = new AudioManager();
const progression = new Progression();

let game = null;
let currentLevel = 1;
let paused = false;
let screen = 'menu';

// ---------- Screen helpers ----------
const screens = ['menu', 'heroes', 'upgrades', 'how', 'pause', 'results', 'fieldupg'];
const OVERLAYS = new Set(['pause', 'results', 'fieldupg']); // keep game frame behind
function show(id) {
  for (const s of screens) document.getElementById(s).classList.add('hidden');
  const hud = document.getElementById('hud');
  if (id === 'game') {
    hud.classList.remove('hidden');
  } else {
    if (!OVERLAYS.has(id)) hud.classList.add('hidden');
    document.getElementById(id).classList.remove('hidden');
  }
  screen = id;
}

function $(id) { return document.getElementById(id); }
function intelStr() { return '⬡ ' + progression.data.intel; }
function clampFrac(v, max) { return max > 0 ? Math.max(0, Math.min(1, v / max)) : 0; }

// ---------- Resize ----------
function resize() { renderer.resize(); }
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));
resize();

// Start audio on first interaction.
function primeAudio() { audio.start(); audio.resume(); }
window.addEventListener('pointerdown', primeAudio, { once: true });
window.addEventListener('keydown', primeAudio, { once: true });

// ---------- Menu ----------
function refreshMenu() {
  const hero = HEROES[progression.data.selectedHero];
  $('menu-hero-line').textContent = hero.name + ' — ' + hero.tag;
  $('menu-best').textContent = progression.data.bestLevel;
  $('menu-intel').textContent = intelStr();
}

$('btn-play').onclick = () => { audio.ui(); currentLevel = progression.data.bestLevel; startGame(currentLevel); };
$('btn-heroes').onclick = () => { audio.ui(); buildHeroes(); show('heroes'); };
$('btn-upgrades').onclick = () => { audio.ui(); buildUpgrades(); show('upgrades'); };
$('btn-how').onclick = () => { audio.ui(); show('how'); };
document.querySelectorAll('[data-back]').forEach((b) => b.onclick = () => { audio.ui(); refreshMenu(); show('menu'); });

// ---------- Hero select ----------
function buildHeroes() {
  $('heroes-intel').textContent = intelStr();
  const list = $('hero-list');
  list.innerHTML = '';
  for (const id of HERO_ORDER) {
    const h = HEROES[id];
    const unlocked = progression.isUnlocked(id);
    const selected = progression.data.selectedHero === id;
    const card = document.createElement('div');
    card.className = 'hero-card' + (selected ? ' selected' : '') + (unlocked ? '' : ' locked');
    card.innerHTML = `
      <div class="hero-emblem" style="background:radial-gradient(circle at 35% 30%, ${h.accent}, ${h.color})">${h.name[0]}</div>
      <div class="hero-info">
        <div class="hero-name">${h.name} <span class="hero-tag">${h.tag}</span></div>
        <div class="hero-desc">${h.desc}</div>
        <div class="hero-desc" style="color:#8fa0c0">◎ ${h.ability.name} · ⇱ ${h.traversal.name} · ➤ ${h.projectile.name}</div>
      </div>
      <div class="hero-cta"></div>`;
    const cta = card.querySelector('.hero-cta');
    if (!unlocked) {
      const canAfford = progression.data.intel >= h.unlockCost;
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = 'Unlock ⬡' + h.unlockCost;
      b.disabled = !canAfford;
      if (!canAfford) b.style.opacity = 0.5;
      b.onclick = () => {
        if (progression.unlock(id)) { audio.gadget(); progression.selectHero(id); buildHeroes(); refreshMenu(); }
        else audio.lose();
      };
      cta.appendChild(b);
    } else if (selected) {
      cta.innerHTML = '<span class="badge on">SELECTED</span>';
    } else {
      const b = document.createElement('button');
      b.className = 'btn'; b.textContent = 'Select';
      b.onclick = () => { audio.ui(); progression.selectHero(id); buildHeroes(); refreshMenu(); };
      cta.appendChild(b);
    }
    list.appendChild(card);
  }
}

// ---------- Upgrades ----------
// Which hero the upgrades screen is currently showing.
let upgHeroId = null;

function buildUpgrades() {
  $('upg-intel').textContent = intelStr();
  if (!upgHeroId || !progression.isUnlocked(upgHeroId)) upgHeroId = progression.data.selectedHero;

  // Hero tabs (only unlocked heroes can be upgraded).
  const tabs = $('upg-tabs');
  tabs.innerHTML = '';
  for (const id of HERO_ORDER) {
    const h = HEROES[id];
    const unlocked = progression.isUnlocked(id);
    const tab = document.createElement('div');
    tab.className = 'hero-tab' + (id === upgHeroId ? ' active' : '') + (unlocked ? '' : ' locked');
    tab.textContent = h.name;
    if (unlocked) tab.onclick = () => { audio.ui(); upgHeroId = id; buildUpgrades(); };
    tabs.appendChild(tab);
  }

  const hero = HEROES[upgHeroId];
  const list = $('upg-list');
  list.innerHTML = '';
  for (const def of hero.upgrades) {
    const lvl = progression.upgradeLevel(upgHeroId, def.key);
    const maxed = lvl >= def.max;
    const cost = maxed ? 0 : def.cost(lvl);
    const card = document.createElement('div');
    card.className = 'upg-card';
    let pips = '';
    for (let i = 0; i < def.max; i++) pips += `<div class="pip ${i < lvl ? 'on' : ''}"></div>`;
    card.innerHTML = `
      <div class="upg-info">
        <div class="upg-name">${def.name}</div>
        <div class="upg-desc">${def.desc}</div>
        <div class="pips">${pips}</div>
      </div>
      <div class="upg-cta"></div>`;
    const cta = card.querySelector('.upg-cta');
    if (maxed) {
      cta.innerHTML = '<span class="badge on">MAX</span>';
    } else {
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = '⬡' + cost;
      const afford = progression.data.intel >= cost;
      b.disabled = !afford; if (!afford) b.style.opacity = 0.5;
      b.onclick = () => { if (progression.buyUpgrade(upgHeroId, def.key)) { audio.gadget(); buildUpgrades(); } else audio.lose(); };
      cta.appendChild(b);
    }
    list.appendChild(card);
  }
}

// ---------- Game lifecycle ----------
function startGame(level) {
  primeAudio();
  currentLevel = level;
  paused = false;
  game = new Game({ input, audio, renderer, progression, heroId: progression.data.selectedHero, level });
  renderer.cam.x = game.player.x - renderer.vw / 2;
  renderer.cam.y = game.player.y - renderer.vh / 2;
  // Configure action button labels + glyphs for this hero.
  const hero = HEROES[progression.data.selectedHero];
  const abilityShort = { radar: 'Radar', smoke: 'Smoke', webtrap: 'Trap' };
  const weaponShort = { billyclub: 'Club', batarang: 'Batarang', web: 'Web' };
  $('ability-lbl').textContent = abilityShort[hero.ability.type] || hero.ability.name;
  $('jump-lbl').textContent = hero.traversal.type === 'grapple' ? 'Grapple' : 'Web Zip';
  $('jump-glyph').textContent = hero.traversal.type === 'grapple' ? '⇱' : '➰';
  $('grapple-lbl').textContent = weaponShort[hero.projectile.type] || hero.projectile.name;
  $('hud-hero').textContent = hero.name;
  $('hud-level').textContent = 'Floor 1/' + game.floorsTotal;
  show('game');
}

// ---------- HUD update ----------
let warnBlink = 0;
function updateHUD(dt) {
  if (!game) return;
  const remaining = game.enemiesRemaining();
  $('hud-enemies').textContent = remaining > 0 ? 'Enemies: ' + remaining : 'Reach the LIFT ▲';
  $('hud-level').textContent = 'Floor ' + game.floor + '/' + game.floorsTotal;
  $('hud-intel').textContent = '⬡ ' + (progression.data.intel + game.intelEarned);
  // Floor banner.
  const banner = $('floor-banner');
  if (game.floorBanner > 0) { banner.textContent = 'FLOOR ' + game.floor; banner.classList.remove('hidden'); }
  else banner.classList.add('hidden');
  const hp = Math.max(0, game.playerHealth / game.playerHealthMax);
  $('hp-fill').style.width = (hp * 100) + '%';
  $('alarm-fill').style.width = (game.alarm * 100) + '%';
  const alarmLbl = $('alarm-label');
  alarmLbl.textContent = game.alarm > 0.66 ? 'ALARM' : game.alarm > 0.15 ? 'ALERT' : 'CALM';
  alarmLbl.style.color = game.alarm > 0.66 ? 'var(--danger)' : game.alarm > 0.15 ? 'var(--warn)' : 'var(--dim)';

  // Cooldown rings (read straight from the player's timers).
  const pl = game.player;
  $('cd-ability').style.transform = `scaleY(${clampFrac(pl.cdAbility, pl.abilityMax)})`;
  $('cd-jump').style.transform = `scaleY(${clampFrac(pl.cdTraverse, pl.traverseMax)})`;
  $('cd-grapple').style.transform = `scaleY(${clampFrac(pl.cdProjectile, pl.projectileMax)})`;

  // Detection warning.
  const spotted = game.enemies.some((e) => !e.downed && (e.state === 'Combat' || e.state === 'Alerted') && e.canSeePlayer);
  $('detect-warning').classList.toggle('hidden', !spotted);
}

// ---------- Pause ----------
$('btn-pause').onclick = () => { if (game && game.state === 'playing') { paused = true; audio.ui(); show('pause'); } };
$('btn-resume').onclick = () => { audio.ui(); paused = false; show('game'); };
$('btn-restart').onclick = () => { audio.ui(); startGame(currentLevel); };
$('btn-quit').onclick = () => { audio.ui(); game = null; refreshMenu(); show('menu'); };
$('btn-mute').onclick = () => {
  audio.setMuted(!audio.muted);
  $('btn-mute').textContent = 'Sound: ' + (audio.muted ? 'OFF' : 'ON');
};

// ---------- Field upgrade (mid-run) ----------
function showFieldUpgrade() {
  const list = $('fieldupg-list');
  list.innerHTML = '';
  for (const perk of game.runPerkChoices()) {
    const card = document.createElement('div');
    card.className = 'upg-card fieldupg-card';
    card.innerHTML = `<div class="upg-info"><div class="upg-name">${perk.name}</div><div class="upg-desc">${perk.desc}</div></div><div class="upg-cta">➤</div>`;
    card.onclick = () => { audio.gadget(); game.applyPerk(perk.id); show('game'); };
    list.appendChild(card);
  }
  show('fieldupg');
}

// ---------- Results ----------
function showResults() {
  const r = game.lastResult;
  const title = $('result-title');
  if (r.win) { title.textContent = 'BUILDING SECURED'; title.className = 'result-title win'; }
  else { title.textContent = 'MISSION FAILED'; title.className = 'result-title lose'; }
  $('result-sub').textContent = r.win
    ? (r.stealth ? `All ${r.floors} floors cleared — never detected.` : `Reached the roof after ${game.detections} contact(s).`)
    : `Taken down on floor ${game.floor}. Regroup and try again.`;
  const stats = $('result-stats');
  stats.innerHTML = `
    <div class="row"><span>Intel earned</span><span>⬡ ${r.intel}</span></div>
    <div class="row"><span>Total intel</span><span>⬡ ${progression.data.intel}</span></div>
    <div class="row"><span>Sector</span><span>${currentLevel}${r.win ? ' ✓' : ''}</span></div>`;
  $('btn-next').classList.toggle('hidden', !r.win);
  show('results');
}
$('btn-next').onclick = () => { audio.ui(); startGame(currentLevel + 1); };
$('btn-replay').onclick = () => { audio.ui(); startGame(currentLevel); };
$('btn-results-menu').onclick = () => { audio.ui(); game = null; refreshMenu(); show('menu'); };

// ---------- Main loop ----------
let last = performance.now();
let resultsShown = false;
function loop(now) {
  let dt = (now - last) / 1000;
  last = now;
  dt = Math.min(dt, 0.05); // clamp big frame gaps

  try {
    if (game && screen === 'game' && !paused) {
      if (game.state === 'playing') {
        resultsShown = false;
        game.update(dt);
        updateHUD(dt);
      } else if (game.state === 'upgrade') {
        updateHUD(dt);
        showFieldUpgrade();            // pick-one boost, then next floor
      } else if (!resultsShown) {
        resultsShown = true;
        updateHUD(dt);
        setTimeout(showResults, 700);  // brief beat before the panel
      }
      game.render(dt);
    } else if (game && OVERLAYS.has(screen)) {
      // Keep the frozen scene visible behind overlays.
      game.render(0);
    }
  } catch (err) {
    // A single bad frame must never permanently freeze the game.
    console.error(err);
  }
  requestAnimationFrame(loop);
}

// ---------- Boot ----------
refreshMenu();
show('menu');
requestAnimationFrame(loop);
