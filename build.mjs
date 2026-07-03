// Bundles the ES-module game into a single self-contained game.html
// (inlined CSS + all JS in one <script>), for hosting anywhere and for
// publishing as a single-file page. Run:  node build.mjs
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = dirname(fileURLToPath(import.meta.url));

// Module concat order (dependencies first).
const order = [
  'src/utils.js',
  'src/heroes.js',
  'src/mapgen.js',
  'src/pathfind.js',
  'src/progression.js',
  'src/audio.js',
  'src/input.js',
  'src/entities/enemy.js',
  'src/entities/player.js',
  'src/sprites.js',
  'src/render.js',
  'src/game.js',
  'src/main.js',
];

function strip(src) {
  return src
    .replace(/^import[\s\S]*?;\s*$/gm, '')                             // drop import statements
    .replace(/^export\s+(const|let|var|class|function|async)/gm, '$1') // export X -> X
    .replace(/^export\s*\{[\s\S]*?\};?\s*$/gm, '');                    // drop `export { ... }`
}

const js = order
  .map((f) => `\n/* ===== ${f} ===== */\n` + strip(readFileSync(join(root, f), 'utf8')))
  .join('\n');

const css = readFileSync(join(root, 'styles.css'), 'utf8');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const body = html.match(/<body>([\s\S]*?)<script/)[1].trim();

const out = `<meta charset="utf-8">
<title>NIGHTFALL — Stealth Ops</title>
<style>
html,body{margin:0;height:100%;}
${css}
</style>
${body}
<script type="module">
${js}
</script>
`;

writeFileSync(join(root, 'game.html'), out);
const leftover = out.split('\n').filter((l) => /^\s*(import\s|export\s)/.test(l)).length;
console.log(`Wrote game.html (${out.length} bytes, ${leftover} leftover import/export lines)`);
