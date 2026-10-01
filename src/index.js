// src/index.js -- logs every page request to johnhoeksema.com, and serves the
// list at /analytics.
//
// The Worker sits in front of GitHub Pages on the route johnhoeksema.com/*.
// Every request goes on to GitHub unchanged. When GitHub answers with a page,
// the Worker writes one row to D1 after the visitor already has the response.

import { botName } from './bots.js';

const PAGE_SIZE = 500;

export default {
  async fetch(request, env, ctx) {
    // If anything below throws, Cloudflare serves the site as if the Worker
    // were not there. An analytics bug must never take the site down.
    ctx.passThroughOnException();

    const url = new URL(request.url);
    if (url.pathname === '/analytics' || url.pathname === '/analytics/') {
      return analytics(url, env);
    }

    const response = await fetch(request);
    if (isPage(request, response)) ctx.waitUntil(log(request, url, env));
    return response;
  },
};

// A page is an HTML answer, including GitHub's 404 page. Images, CSS, fonts and
// video are skipped. Redirects are skipped too, because the request they send
// the browser on to is logged. A 304 carries no content type, so the browser's
// own Sec-Fetch-Dest header decides.
function isPage(request, response) {
  if (response.status === 304) return request.headers.get('sec-fetch-dest') === 'document';
  if (response.status >= 300 && response.status < 400) return false;
  return (response.headers.get('content-type') || '').startsWith('text/html');
}

async function log(request, url, env) {
  try {
    const cf = request.cf || {};
    const ua = request.headers.get('user-agent') || '';
    const location = [cf.city, cf.regionCode || cf.region, cf.country].filter(Boolean).join(', ');
    await env.DB.prepare(
      'INSERT INTO requests (ts, path, ip, location, bot, ua) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(
      Date.now(),
      url.pathname.slice(0, 512),
      request.headers.get('cf-connecting-ip'),
      location || null,
      botName(ua, cf.asn),
      ua.slice(0, 512) || null,
    ).run();
  } catch (e) {
    console.error('log failed:', e);
  }
}

// ---------------------------------------------------------------- the page

const TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric', month: 'short', day: 'numeric',
  hour: 'numeric', minute: '2-digit', second: '2-digit',
});

// Every value on the page came from a stranger's request. Escape all of it.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

async function analytics(url, env) {
  const before = parseInt(url.searchParams.get('before'), 10);
  let rows;
  try {
    // id rises with time, so the primary key answers this without an index.
    ({ results: rows } = await env.DB.prepare(
      'SELECT id, ts, path, ip, location, bot FROM requests WHERE id < ? ORDER BY id DESC LIMIT ?'
    ).bind(Number.isFinite(before) ? before : Number.MAX_SAFE_INTEGER, PAGE_SIZE).all());
  } catch (e) {
    return new Response(`Could not read the database: ${e}`, { status: 500 });
  }

  const body = rows.map((r) => `<tr${r.bot ? ' class="bot"' : ''}>`
    + `<td>${esc(TIME.format(r.ts))}</td><td>${esc(r.path)}</td><td>${esc(r.ip)}</td>`
    + `<td>${esc(r.location)}</td><td>${esc(r.bot)}</td></tr>`).join('\n');

  const nav = [
    Number.isFinite(before) ? '<a href="/analytics">newest</a>' : '',
    rows.length === PAGE_SIZE ? `<a href="/analytics?before=${rows[rows.length - 1].id}">older</a>` : '',
  ].filter(Boolean).join(' · ');

  return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Analytics — John Hoeksema</title>
<link rel="icon" type="image/png" href="/assets/images/favicon.png">
<link href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  body { margin: 0; padding: 16px; background: #141414; color: #F0F0F0; font: 13px/1.5 'Geist Mono', 'Courier New', monospace; }
  h1 { margin: 0 0 12px; font-size: 16px; color: #FF6200; }
  .wrap { overflow-x: auto; }
  table { border-collapse: collapse; white-space: nowrap; }
  th { text-align: left; font-size: 11px; font-weight: 500; color: #999; text-transform: uppercase; }
  th, td { padding: 4px 24px 4px 0; border-bottom: 1px solid #2A2A2A; }
  tr.bot { color: #666; }
  a { color: #FF6200; }
  p { color: #999; }
</style>
</head>
<body>
<h1>analytics</h1>
<div class="wrap">
<table>
<thead><tr><th>Time (New York)</th><th>Path</th><th>IP</th><th>Location</th><th>Bot</th></tr></thead>
<tbody>
${body}
</tbody>
</table>
</div>
${rows.length ? '' : '<p>No requests yet.</p>'}
${nav ? `<p>${nav}</p>` : ''}
</body>
</html>
`, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}
