# NIGHTFALL — Stealth Ops

A complete **mobile-first stealth-action game** built from scratch with vanilla
JavaScript + HTML5 Canvas. No frameworks, no build step, no external assets —
every graphic and sound is generated procedurally at runtime.

Clear a procedurally generated slice of a dark, rainy city: avoid the vision
cones, silently take down every masked criminal, then reach the extraction pad.
Fast (1–3 min) missions, instant restarts, hero-based abilities.

## Play it

It's a static site — just serve the folder and open it in a browser (mobile or
desktop):

```bash
# from the repo root
python3 -m http.server 8099
# then open http://localhost:8099 on your phone or desktop
```

> ES modules require an `http://` origin, so open it through a server rather than
> a `file://` path.

## Controls

**Touch (mobile)**
- **Left half of screen** — drag anywhere to summon the movement joystick.
- **✦ Takedown** — silent from behind, risky from the front (auto-targets the
  nearest enemy).
- **⤴ Dash** — quick burst to vault gaps and dodge.
- **◎ Ability** / **➤ Gadget** — hero-specific, with cooldown rings.

**Keyboard (desktop testing):** `WASD`/arrows move · `J` takedown · `Space`
dash · `K` ability · `L` gadget.

## Core loop

1. Spawn into a compact, procedurally generated stealth arena.
2. Enemies patrol fixed routes with readable vision cones.
3. Avoid detection and eliminate every enemy one by one.
4. Reach the glowing **EXTRACT** pad (unlocks once the map is clear).
5. Earn **Intel**, unlock heroes & upgrades, advance to the next sector.

The HUD tracks **Enemies Remaining**, HP, and the global **Alarm** level.
Detection isn't an instant fail — it raises the alarm and enemies converge, but
you only lose if your HP is emptied.

## Heroes

Each shares the base stealth kit (movement + contextual takedown) plus a signature
ability and gadget. Original designs, not licensed characters.

| Hero | Ability ◎ | Gadget ➤ |
|------|-----------|-----------|
| **Warden** — *The Fearless* | **Radar Sense** — reveal all enemies through walls | **Baton Throw** — ranged stun |
| **Nightfall** — *The Shadow* | **Smoke Screen** — break line-of-sight & hide | **Batarang** — ranged stun |
| **Weaver** — *The Silk* | **Web Trap** — root the first enemy that touches it | **Web Zip** — fast dash across the arena |

## Enemy AI

A readable state machine:
`Patrol → Idle → Suspicious → Alerted → Combat → Searching → Patrol`

Enemies perceive via a wall-occluded **vision cone** (color-coded by state) and
**hear sound events** (footsteps, loud takedowns, gunfire). On confirming you
they raise an alarm and nearby patrols move to search your last-known position.

## Progression

Persistent via `localStorage` (Intel currency):
- Unlock **Nightfall** and **Weaver**.
- Upgrade **Silent Hands** (takedown speed), **Ghost Step** (slower detection),
  **Field Tech** (faster cooldowns), and **Fleet Foot** (move speed).

## Project structure

```
index.html          # shell + all UI overlays (menu, heroes, upgrades, HUD, results)
styles.css          # UI + HUD styling, mobile-safe layout
src/
  main.js           # bootstrap, screen flow, game loop, HUD updates
  game.js           # mission orchestration: spawns, combat, alarm, win/lose
  render.js         # canvas atmosphere, entities, vision cones, effects
  input.js          # virtual joystick + action buttons + keyboard
  audio.js          # fully synthesized WebAudio SFX + rain/city ambience
  mapgen.js         # procedural rainy-city arena generator
  pathfind.js       # grid A* for enemy navigation
  heroes.js         # hero definitions & abilities
  progression.js    # save data, unlocks, upgrades
  entities/
    player.js       # movement, collision, takedowns, abilities
    enemy.js        # perception + AI state machine
```

## Tech notes

- Pure ES modules; no dependencies to install.
- Everything is drawn on a single `<canvas>`; menus/HUD are lightweight DOM.
- Audio is synthesized on the fly (started on first tap to satisfy autoplay
  policies).
- Deterministic map generation via a seedable RNG.
