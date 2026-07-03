// Isometric projection helpers. Gameplay stays in top-down world (x,y) space;
// only rendering + input direction are transformed to a 2:1 dimetric view,
// giving the tilted "sort of 3D" POV.

import { TILE } from './mapgen.js';

// Half tile footprint on screen (a = half width, b = half height) and wall height.
export const ISO = { a: 36, b: 18, wallH: 40 };

// World pixels -> isometric screen offset (before camera translate). wz raises up.
export function toIso(wx, wy, wz = 0) {
  const tx = wx / TILE, ty = wy / TILE;
  return { x: (tx - ty) * ISO.a, y: (tx + ty) * ISO.b - wz };
}

// A screen-space input vector (e.g. joystick) -> normalized world direction so
// "up" on the stick moves the hero away from the camera along the iso grid.
export function screenDirToWorld(mx, my) {
  const dtx = mx / ISO.a + my / ISO.b;
  const dty = my / ISO.b - mx / ISO.a;
  const l = Math.hypot(dtx, dty) || 1;
  return { x: dtx / l, y: dty / l };
}

// Depth key for back-to-front painting (larger = nearer camera / drawn later).
export function depth(wx, wy) { return wx + wy; }
