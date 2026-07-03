// Procedural pixel-art characters. Each character is composed on a small pixel
// grid (via stamped shapes + auto outline), rendered once to an offscreen
// canvas per (type, frame), then blitted with image smoothing disabled so it
// stays crisp and chunky. Front-facing "billboard" sprites; the world code
// flips them horizontally by facing and adds a ground facing indicator.

const GW = 18, GH = 22;      // grid cells
const PX = 4;                // offscreen pixels per grid cell

// A tiny grid you can stamp shapes into, then auto-outline + render.
class Grid {
  constructor() { this.d = new Array(GW * GH).fill(null); }
  set(x, y, c) { if (x >= 0 && y >= 0 && x < GW && y < GH && c) this.d[y * GW + x] = c; }
  get(x, y) { return (x < 0 || y < 0 || x >= GW || y >= GH) ? null : this.d[y * GW + x]; }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); }
  // Mirror the left half onto the right for symmetry (center line between 8 and 9).
  mirror() {
    for (let y = 0; y < GH; y++)
      for (let x = 0; x < GW / 2; x++) {
        const c = this.get(x, y);
        if (c) this.set(GW - 1 - x, y, c);
      }
  }
  // Add a dark outline around the silhouette for readability.
  outline(col) {
    const add = [];
    for (let y = 0; y < GH; y++)
      for (let x = 0; x < GW; x++) {
        if (this.get(x, y)) continue;
        if (this.get(x - 1, y) || this.get(x + 1, y) || this.get(x, y - 1) || this.get(x, y + 1))
          add.push([x, y]);
      }
    for (const [x, y] of add) this.set(x, y, col);
  }
}

// Build a character grid from a palette + feature flags.
// feature: 'horns' | 'ears' | 'mask' | 'beanie'
function build(pal, feature, frame) {
  const g = new Grid();
  const { suit, dark, lite, skin, accent, eye } = pal;

  // --- Head / mask ---
  g.rect(5, 3, 4, 6, suit);       // head block (left half; mirrored later)
  g.rect(5, 3, 4, 1, lite);       // top highlight
  g.rect(5, 8, 4, 2, feature === 'mask' ? suit : skin); // jaw (skin unless full mask)

  // Eyes
  if (feature === 'mask') {
    // Spider: big white eyes with a dark rim.
    g.rect(5, 6, 3, 2, '#ffffff');
    g.set(7, 6, dark);
  } else {
    g.set(6, 6, eye);             // eye
    g.set(5, 6, dark);            // eye shadow
  }
  // Mouth / chin shading
  g.set(7, 9, dark);

  // --- Feature on top of head ---
  if (feature === 'horns') {
    g.set(5, 2, suit); g.set(5, 1, lite); g.set(5, 0, lite);
    g.set(6, 2, suit);
  } else if (feature === 'ears') {
    g.set(5, 2, suit); g.set(5, 1, suit); g.set(4, 1, dark);
  } else if (feature === 'beanie') {
    g.rect(5, 2, 4, 2, dark);     // cap
    g.rect(5, 5, 4, 2, dark);     // mask band over eyes
    g.set(6, 6, eye);             // glowing eye through mask
  } else if (feature === 'mask') {
    // web lines
    g.set(6, 4, dark); g.set(6, 8, dark);
  }

  // --- Torso ---
  g.rect(4, 10, 5, 6, suit);      // chest (left half)
  g.rect(4, 10, 5, 1, lite);      // shoulder highlight
  g.rect(4, 14, 5, 2, dark);      // belt / lower shading
  // Emblem stripe (accent) center chest
  g.set(8, 11, accent); g.set(8, 12, accent); g.set(8, 13, accent);
  g.set(7, 12, accent);

  // --- Arms (animate slightly by frame) ---
  const armY = 11 + (frame ? 0 : 0);
  g.rect(2, armY, 2, 4, suit);    // left arm
  g.rect(2, armY + 4, 2, 1, dark);// glove
  g.set(3, armY - 1, lite);

  // --- Legs / boots (two walk frames) ---
  if (frame === 1) {
    g.rect(5, 16, 2, 4, dark);    // left leg forward
    g.rect(7, 16, 2, 3, suit);
    g.rect(5, 20, 2, 1, '#101018');
  } else {
    g.rect(5, 16, 2, 4, suit);
    g.rect(7, 16, 2, 4, dark);
    g.rect(5, 20, 2, 1, '#101018');
  }

  g.mirror();
  g.outline('#0b0d14');
  return g;
}

function renderGrid(g) {
  const cv = document.createElement('canvas');
  cv.width = GW * PX; cv.height = GH * PX;
  const ctx = cv.getContext('2d');
  for (let y = 0; y < GH; y++)
    for (let x = 0; x < GW; x++) {
      const c = g.get(x, y);
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(x * PX, y * PX, PX, PX);
    }
  return cv;
}

const cache = new Map();

// palette + feature per character kind.
export const CHAR_STYLE = {
  daredevil: { feature: 'horns', pal: { suit: '#d02a2a', dark: '#7c1414', lite: '#f2564e', skin: '#e0a074', accent: '#2a0808', eye: '#3a0a0a' } },
  bat:       { feature: 'ears',  pal: { suit: '#2b3350', dark: '#151a2e', lite: '#4a557f', skin: '#d9a578', accent: '#f2d24a', eye: '#dfe6ff' } },
  spider:    { feature: 'mask',  pal: { suit: '#b02fd0', dark: '#5f1476', lite: '#e070ff', skin: '#b02fd0', accent: '#12040f', eye: '#ffffff' } },
  enemy:     { feature: 'beanie',pal: { suit: '#4a4f5e', dark: '#282c38', lite: '#69708a', skin: '#c99a72', accent: '#ff5a2a', eye: '#ff5a3a' } },
  enemyHot:  { feature: 'beanie',pal: { suit: '#7a4038', dark: '#3a1c18', lite: '#b8564a', skin: '#c99a72', accent: '#ffd24a', eye: '#ffe14a' } },
};

// Return a cached sprite canvas for (kind, frame).
export function getSprite(kind, frame) {
  const key = kind + frame;
  if (cache.has(key)) return cache.get(key);
  const style = CHAR_STYLE[kind] || CHAR_STYLE.enemy;
  const cv = renderGrid(build(style.pal, style.feature, frame));
  cache.set(key, cv);
  return cv;
}

export const SPRITE_W = GW * PX;
export const SPRITE_H = GH * PX;
