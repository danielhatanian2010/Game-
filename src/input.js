// Touch + keyboard input. Left half of the screen is a dynamic virtual joystick;
// the right-side action buttons are real DOM elements handled here too.
// Keyboard fallback (desktop testing): WASD/arrows move, J attack, K ability,
// L grapple, Space jump.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;

    // Movement vector, magnitude 0..1.
    this.move = { x: 0, y: 0 };

    // Edge-triggered action flags (consumed by game each frame).
    this.actions = { attack: false, jump: false, ability: false, grapple: false };
    this._held = { attack: false, jump: false, ability: false, grapple: false };

    // Joystick visual state.
    this.joy = { active: false, ox: 0, oy: 0, cx: 0, cy: 0 };

    this._joyPointerId = null;
    this._keys = {};

    this._bindTouch();
    this._bindKeys();
    this._bindButtons();
  }

  _bindTouch() {
    const c = this.canvas;
    const onDown = (e) => {
      for (const t of e.changedTouches ? e.changedTouches : [e]) {
        const x = t.clientX, y = t.clientY;
        // Only the left ~55% of the screen drives the stick, so buttons stay free.
        if (x < window.innerWidth * 0.55 && this._joyPointerId === null) {
          this._joyPointerId = t.identifier ?? 'mouse';
          this.joy.active = true;
          this.joy.ox = this.joy.cx = x;
          this.joy.oy = this.joy.cy = y;
        }
      }
    };
    const onMove = (e) => {
      for (const t of e.changedTouches ? e.changedTouches : [e]) {
        const id = t.identifier ?? 'mouse';
        if (id === this._joyPointerId) {
          this.joy.cx = t.clientX;
          this.joy.cy = t.clientY;
          this._updateJoy();
        }
      }
    };
    const onUp = (e) => {
      for (const t of e.changedTouches ? e.changedTouches : [e]) {
        const id = t.identifier ?? 'mouse';
        if (id === this._joyPointerId) {
          this._joyPointerId = null;
          this.joy.active = false;
          this.move.x = 0;
          this.move.y = 0;
        }
      }
    };

    c.addEventListener('touchstart', (e) => { e.preventDefault(); onDown(e); }, { passive: false });
    c.addEventListener('touchmove', (e) => { e.preventDefault(); onMove(e); }, { passive: false });
    c.addEventListener('touchend', (e) => { e.preventDefault(); onUp(e); }, { passive: false });
    c.addEventListener('touchcancel', (e) => { e.preventDefault(); onUp(e); }, { passive: false });

    // Mouse support for desktop.
    let mouseDown = false;
    c.addEventListener('mousedown', (e) => { mouseDown = true; onDown(e); });
    window.addEventListener('mousemove', (e) => { if (mouseDown) onMove(e); });
    window.addEventListener('mouseup', (e) => { mouseDown = false; onUp(e); });
  }

  _updateJoy() {
    const dx = this.joy.cx - this.joy.ox;
    const dy = this.joy.cy - this.joy.oy;
    const max = 60;
    const len = Math.hypot(dx, dy);
    const clamped = Math.min(len, max);
    const nx = len > 0 ? dx / len : 0;
    const ny = len > 0 ? dy / len : 0;
    // Clamp visual knob distance.
    this.joy.cx = this.joy.ox + nx * clamped;
    this.joy.cy = this.joy.oy + ny * clamped;
    const mag = clamped / max;
    // Small dead zone.
    this.move.x = mag > 0.12 ? nx * mag : 0;
    this.move.y = mag > 0.12 ? ny * mag : 0;
  }

  _press(name) {
    if (!this._held[name]) this.actions[name] = true;
    this._held[name] = true;
  }
  _release(name) {
    this._held[name] = false;
  }

  _bindButtons() {
    const map = { 'btn-attack': 'attack', 'btn-jump': 'jump', 'btn-ability': 'ability', 'btn-grapple': 'grapple' };
    for (const [id, action] of Object.entries(map)) {
      const el = document.getElementById(id);
      if (!el) continue;
      const down = (e) => { e.preventDefault(); this._press(action); el.classList.add('pressed'); };
      const up = (e) => { e.preventDefault(); this._release(action); el.classList.remove('pressed'); };
      el.addEventListener('touchstart', down, { passive: false });
      el.addEventListener('touchend', up, { passive: false });
      el.addEventListener('mousedown', down);
      el.addEventListener('mouseup', up);
      el.addEventListener('mouseleave', up);
    }
  }

  _bindKeys() {
    window.addEventListener('keydown', (e) => {
      this._keys[e.key.toLowerCase()] = true;
      const k = e.key.toLowerCase();
      if (k === 'j') this._press('attack');
      if (k === 'k') this._press('ability');
      if (k === 'l') this._press('grapple');
      if (k === ' ') this._press('jump');
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      this._keys[k] = false;
      if (k === 'j') this._release('attack');
      if (k === 'k') this._release('ability');
      if (k === 'l') this._release('grapple');
      if (k === ' ') this._release('jump');
    });
  }

  // Fold keyboard movement into the move vector each frame.
  pollKeyboard() {
    if (this.joy.active) return;
    let x = 0, y = 0;
    if (this._keys['a'] || this._keys['arrowleft']) x -= 1;
    if (this._keys['d'] || this._keys['arrowright']) x += 1;
    if (this._keys['w'] || this._keys['arrowup']) y -= 1;
    if (this._keys['s'] || this._keys['arrowdown']) y += 1;
    const len = Math.hypot(x, y);
    if (len > 0) { this.move.x = x / len; this.move.y = y / len; }
    else if (!this._keys['_wasKey']) { /* leave joystick value */ }
  }

  // Read + clear an edge-triggered action.
  consume(name) {
    if (this.actions[name]) { this.actions[name] = false; return true; }
    return false;
  }

  clearActions() {
    this.actions.attack = this.actions.jump = this.actions.ability = this.actions.grapple = false;
  }
}
