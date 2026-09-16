// Builds the standalone dashboard into the Jekyll site so it is reachable at
// https://hoeksemaa.github.io/back-room
//
// The file is written with NO YAML frontmatter on purpose. Jekyll copies such
// files verbatim, which means it does not get _layouts/default.html, which
// means the beacon never runs on it. John's own dashboard visits therefore
// never appear in his own data. Do not add frontmatter to this output.

import { readFileSync, writeFileSync } from 'node:fs';
import { WORLD } from './src/world.js';

const API_BASE = 'https://hx-7f3a91c4.hoeksemaa.workers.dev/back-room';
const OUT = '/Users/john/Dev/hoeksemaa.github.io/back-room.html';

const html = readFileSync('src/dashboard.html', 'utf8');
const app = readFileSync('src/app.tpl', 'utf8');

const page = html
  .replace('__WORLDDATA__', JSON.stringify(WORLD))
  .replace('__APPJS__', app)
  .split('__DASHPATH__').join(API_BASE);

for (const ph of ['__WORLDDATA__', '__APPJS__', '__DASHPATH__']) {
  if (page.includes(ph)) { console.error('Unsubstituted placeholder:', ph); process.exit(1); }
}
// Liquid would only run on a file with frontmatter, but check anyway: a stray
// {{ or {% in the output would be a nasty surprise if that ever changed.
const liquid = page.match(/\{\{|\{%/g);
if (liquid) console.warn('warning: contains Liquid-like syntax:', liquid.length, 'occurrences');

writeFileSync(OUT, page);
console.log('wrote', OUT, (page.length / 1024).toFixed(1) + ' KB');
