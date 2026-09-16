// src/dashboard.js -- assembles the single self-contained dashboard page.
// The HTML, the client script and the basemap are imported as text modules
// (see the "rules" block in wrangler.jsonc) so none of them needs escaping
// and the page pulls in no third-party JavaScript at all.

import HTML from './dashboard.html';
import APP from './app.tpl';
import { WORLD } from './world.js';

let cached = null;

export function renderDashboard(dashPath) {
  if (!cached) {
    cached = HTML
      .replace('__WORLDDATA__', JSON.stringify(WORLD))
      .replace('__APPJS__', APP);
  }
  // Split on the placeholder rather than String.replace: a '$' in the path
  // would otherwise be read as a replacement pattern.
  return cached.split('__DASHPATH__').join(dashPath);
}
