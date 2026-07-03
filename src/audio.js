// Fully synthesized audio using the WebAudio API. No external assets needed.
// A single AudioContext drives short procedural SFX plus a looping rain/city bed.

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.started = false;
    this._rainNodes = null;
  }

  // Must be called from a user gesture (browsers block autoplay otherwise).
  start() {
    if (this.started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(this.ctx.destination);
    this.started = true;
    this._startRain();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.9;
  }

  _noiseBuffer(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  _startRain() {
    if (!this.ctx) return;
    // Filtered noise for rain, plus a slow low rumble for city wind.
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer(2);
    src.loop = true;

    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 6000;

    const g = this.ctx.createGain();
    g.gain.value = 0.06;

    src.connect(hp).connect(lp).connect(g).connect(this.master);
    src.start();

    // Low wind rumble.
    const windSrc = this.ctx.createBufferSource();
    windSrc.buffer = this._noiseBuffer(3);
    windSrc.loop = true;
    const windLp = this.ctx.createBiquadFilter();
    windLp.type = 'lowpass';
    windLp.frequency.value = 220;
    const windG = this.ctx.createGain();
    windG.gain.value = 0.05;
    windSrc.connect(windLp).connect(windG).connect(this.master);
    windSrc.start();

    this._rainNodes = { g, windG };
  }

  // Duck the rain bed briefly (used on alerts for tension).
  duckRain(amount = 0.02, seconds = 1.5) {
    if (!this._rainNodes) return;
    const t = this.ctx.currentTime;
    const g = this._rainNodes.g.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(amount, t + 0.1);
    g.linearRampToValueAtTime(0.06, t + seconds);
  }

  _tone(freq, dur, type = 'sine', vol = 0.3, slideTo = null) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  _noiseBurst(dur, freq, vol = 0.3, type = 'bandpass') {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer(dur + 0.05);
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = 1.5;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  footstep(surface = 'street') {
    const base = surface === 'roof' ? 130 : surface === 'interior' ? 90 : 160;
    this._noiseBurst(0.06, base + Math.random() * 30, 0.12, 'lowpass');
  }

  takedown() {
    this._noiseBurst(0.12, 1800, 0.35, 'bandpass');
    this._tone(180, 0.18, 'sine', 0.25, 90);
  }

  alert() {
    this._tone(880, 0.14, 'square', 0.28, 1200);
    this.duckRain();
  }

  suspicious() {
    this._tone(520, 0.1, 'triangle', 0.18, 620);
  }

  gadget() {
    this._tone(700, 0.16, 'sawtooth', 0.22, 300);
  }

  ability() {
    this._tone(300, 0.25, 'sawtooth', 0.25, 900);
  }

  throwSfx() {
    this._noiseBurst(0.14, 2600, 0.18, 'highpass');
  }

  hit() {
    this._noiseBurst(0.1, 400, 0.3, 'lowpass');
  }

  win() {
    [523, 659, 784, 1046].forEach((f, i) =>
      setTimeout(() => this._tone(f, 0.22, 'triangle', 0.3), i * 120)
    );
  }

  lose() {
    [400, 320, 240, 160].forEach((f, i) =>
      setTimeout(() => this._tone(f, 0.28, 'sawtooth', 0.28), i * 130)
    );
  }

  ui() {
    this._tone(660, 0.05, 'square', 0.12);
  }
}
