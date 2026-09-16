// src/index.js -- collector + dashboard for hoeksemaa.github.io
//
// Routes:
//   POST /s              the beacon collector (public, must stay public)
//   GET  <DASH_PATH>     the dashboard page
//   GET  <DASH_PATH>/api/*  JSON for the dashboard
//   everything else      a plain 404 that reveals nothing

import { classifyUA } from './bots.js';
import { s, n, i, normalizePath, nyParts, parseUA, networkSignals, fpHash } from './enrich.js';
import { renderDashboard } from './dashboard.js';
import { api, CORS } from './api.js';

// Column order for the events INSERT. Built once so the column list and the
// bind list can never drift apart -- that mismatch is the classic D1 bug.
const COLS = [
  'ts','day_local','hour_local','client_ts','env','event_type','pid','sid','vid','fp',
  'path','path_raw','title','referrer','ref_host','is_internal_ref',
  'target','value','ms','vis0',
  'ip','country','region','region_code','city','postal','lat','lon','tz','asn','as_org',
  'net_kind','geo_conf',
  'ua','browser','os','device','sw','sh','dpr','lang','plat','hc','storage_ok',
  'is_bot','bot_name','is_self','origin_ok',
];

const SITE_ORIGIN = 'https://hoeksemaa.github.io';

// Per-IP throttle, in D1. Three mechanisms were measured on this account:
//   * the platform `ratelimit` binding  -- deploys on free, does not enforce
//   * an isolate-memory Map             -- free-tier requests get fresh isolates
//   * the Cache API (caches.default)    -- does not persist on workers.dev
// D1 is the only consistent store available, so it is what we use. The counter
// costs ~2 row writes, against ~19 for a full event, so a blocked request is
// roughly 10x cheaper than one that gets through.
const RL_MAX = 120;
async function rateLimited(db, ip) {
  try {
    const bucket = Math.floor(Date.now() / 60000);
    const row = await db.prepare(
      `INSERT INTO rl (k,n,exp) VALUES (?,1,?)
       ON CONFLICT(k) DO UPDATE SET n = n + 1
       RETURNING n`
    ).bind(`${ip}|${bucket}`, Date.now() + 120000).first();
    return (row?.n || 0) > RL_MAX;
  } catch {
    return false;                        // fail open: never lose a real visit
  }
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
      'referrer-policy': 'no-referrer',
    },
  });

const notFound = () => new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } });

// 204 with the CORS headers the fetch fallback needs. The sendBeacon path is
// no-cors and ignores these, but the fallback uses mode:'cors' with
// credentials, which requires an exact origin plus allow-credentials.
const collected = () =>
  new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': SITE_ORIGIN,
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
      'cache-control': 'no-store',
    },
  });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS' && path === '/s') return collected();
    if (path === '/s') {
      if (request.method !== 'POST') return notFound();

      // Reject an oversized body from its header, BEFORE reading it. The free
      // plan accepts bodies up to 100 MB; request.text() would buffer and
      // UTF-8 decode all of it before any length check could run.
      const len = parseInt(request.headers.get('content-length') || '0', 10);
      if (Number.isFinite(len) && len > 8192) return collected();

      // Per-IP rate limit. The collector URL is public by necessity, and one
      // page view costs ~19 D1 row writes, so a few thousand forged POSTs
      // exhaust the daily write quota -- which also blocks READS, taking the
      // dashboard offline until UTC midnight.
      //
      // MEASURED on this account: the platform `ratelimit` binding deploys on
      // free but does not enforce, isolate memory resets between requests, and
      // caches.default does not persist on workers.dev. D1 is what works.
      // A real visitor sends well under 20 events per page view.
      const ip = request.headers.get('cf-connecting-ip') || 'anon';
      if (await rateLimited(env.DB, ip)) return collected();   // drop silently; never confirm to a scraper

      // The body MUST be read before the response is sent. Deferring the read
      // into ctx.waitUntil() throws "Can't read from request stream after
      // response has been sent" -- and because the collector always answers
      // 204, that failure is invisible from the outside.
      let raw;
      try { raw = await request.text(); } catch { return collected(); }
      ctx.waitUntil(collect(raw, request, env));
      return collected();
    }

    if (path === '/robots.txt') {
      return new Response('User-agent: *\nDisallow: /\n', { headers: { 'content-type': 'text/plain' } });
    }

    // Fail closed: with no DASH_PATH configured, nothing below is reachable.
    const dash = env.DASH_PATH;
    if (!dash) return notFound();
    if (path === dash || path === dash + '/') {
      return new Response(renderDashboard(dash), {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'x-robots-tag': 'noindex, nofollow',
          'referrer-policy': 'no-referrer',
        },
      });
    }
    if (path.startsWith(dash + '/api/')) {
      // The POST routes send application/json, which is not CORS-safelisted,
      // so the browser preflights them.
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      try {
        return await api(path.slice((dash + '/api/').length), url, request, env);
      } catch (e) {
        return json({ error: String(e && e.message || e) }, 500);
      }
    }
    return notFound();
  },
};

// ---------------------------------------------------------------- collector

async function collect(raw, request, env) {
  try {
    if (!raw || raw.length > 8192) return;          // cap before parsing
    let b;
    try { b = JSON.parse(raw); } catch { return; }
    if (!b || typeof b !== 'object') return;

    const cf = request.cf || {};
    const ua = request.headers.get('user-agent') || '';
    const origin = request.headers.get('origin') || '';
    const ts = Date.now();
    const { day_local, hour_local } = nyParts(ts);
    const bot = classifyUA(ua);
    const net = networkSignals(cf, ua);
    const dev = parseUA(ua);

    const pathRaw = s(b.p) || '/';
    const pathNorm = normalizePath(pathRaw);

    let refHost = null, internal = 0;
    const refRaw = s(b.r);
    if (refRaw) {
      try { const u = new URL(refRaw); refHost = u.host; internal = u.origin === SITE_ORIGIN ? 1 : 0; } catch {}
    }

    // 'dev' keeps jekyll serve traffic out of the real numbers without dropping it.
    const env_ = b.e === 'test' ? 'test'
      : (origin && origin !== SITE_ORIGIN) || /localhost|127\.0\.0\.1/.test(s(b.h) || '') ? 'dev'
      : 'prod';

    const fp = await fpHash(
      [b.sw, b.sh, b.dpr, b.lang, b.plat, b.hc, dev.os, dev.browser].map((x) => (x == null ? '' : x)),
      env.FP_SALT || 'hx'
    );

    const row = {
      ts, day_local, hour_local, client_ts: i(b.t), env: env_,
      event_type: s(b.k) || 'pv', pid: s(b.pid), sid: s(b.sid), vid: s(b.vid), fp,
      path: pathNorm, path_raw: s(pathRaw), title: s(b.ti), referrer: refRaw,
      ref_host: refHost, is_internal_ref: internal,
      target: s(b.tg), value: i(b.v), ms: i(b.ms), vis0: s(b.vis),
      ip: s(request.headers.get('cf-connecting-ip')),
      country: s(cf.country), region: s(cf.region), region_code: s(cf.regionCode),
      city: s(cf.city), postal: s(cf.postalCode),
      lat: n(cf.latitude), lon: n(cf.longitude),   // cf gives these as STRINGS
      tz: s(cf.timezone), asn: i(cf.asn), as_org: s(cf.asOrganization),
      net_kind: net.net_kind, geo_conf: net.geo_conf,
      ua: s(ua), browser: dev.browser, os: dev.os, device: dev.device,
      sw: i(b.sw), sh: i(b.sh), dpr: n(b.dpr), lang: s(b.lang), plat: s(b.plat), hc: i(b.hc),
      storage_ok: b.ns ? 0 : 1,
      is_bot: bot.is_bot, bot_name: s(bot.name),
      is_self: b.x ? 1 : 0,
      origin_ok: !origin || origin === SITE_ORIGIN ? 1 : 0,
    };

    const placeholders = COLS.map(() => '?').join(',');
    const values = COLS.map((c) => (row[c] === undefined ? null : row[c]));

    // Partial unique indexes make the double-fire cases idempotent for free.
    let sql = `INSERT INTO events (${COLS.join(',')}) VALUES (${placeholders})`;
    if (row.event_type === 'pv') sql += ` ON CONFLICT(pid) WHERE event_type='pv' DO NOTHING`;
    else if (row.event_type === 'end') sql += ` ON CONFLICT(pid) WHERE event_type='end' DO UPDATE SET ms=max(ms, excluded.ms)`;

    const stmts = [env.DB.prepare(sql).bind(...values)];

    // Catalogs, so the dashboard's dropdowns never scan the events table.
    if (row.event_type === 'pv' && row.env === 'prod' && !row.is_bot) {
      stmts.push(env.DB.prepare(
        `INSERT INTO endpoints (path,title,first_seen,last_seen,hits) VALUES (?,?,?,?,1)
         ON CONFLICT(path) DO UPDATE SET last_seen=excluded.last_seen, hits=hits+1,
           title=COALESCE(excluded.title, endpoints.title)`
      ).bind(row.path, row.title, ts, ts));

      if (row.city || row.country) {
        const key = `${row.country || '?'}|${row.region || ''}|${row.city || ''}`;
        stmts.push(env.DB.prepare(
          `INSERT INTO places (geo_key,country,region,city,lat,lon,first_seen,last_seen,hits)
           VALUES (?,?,?,?,?,?,?,?,1)
           ON CONFLICT(geo_key) DO UPDATE SET last_seen=excluded.last_seen, hits=hits+1,
             lat=COALESCE(excluded.lat, places.lat), lon=COALESCE(excluded.lon, places.lon)`
        ).bind(key, row.country, row.region, row.city, row.lat, row.lon, ts, ts));
      }
      if (row.vid) {
        stmts.push(env.DB.prepare(
          `INSERT INTO visitors (vid,first_seen,last_seen,hits,is_self,last_ip,last_city,last_country,last_as_org)
           VALUES (?,?,?,1,?,?,?,?,?)
           ON CONFLICT(vid) DO UPDATE SET last_seen=excluded.last_seen, hits=hits+1,
             is_self=max(visitors.is_self, excluded.is_self),
             last_ip=excluded.last_ip, last_city=excluded.last_city,
             last_country=excluded.last_country, last_as_org=excluded.last_as_org`
        ).bind(row.vid, ts, ts, row.is_self, row.ip, row.city, row.country, row.as_org));
      }
    }
    if (row.event_type === 'vplay' && row.env === 'prod' && !row.is_bot) {
      stmts.push(env.DB.prepare(`UPDATE endpoints SET has_video=1 WHERE path=?`).bind(row.path));
    }

    // Sweep expired throttle rows now and then, rather than on every request.
    if ((ts % 200) < 2) stmts.push(env.DB.prepare('DELETE FROM rl WHERE exp < ?').bind(ts));

    await env.DB.batch(stmts);
  } catch (e) {
    // Last resort: leave a trace somewhere John can see it. Every other layer
    // swallows errors on purpose, so without this a broken pipeline and a
    // quiet week look identical.
    try {
      await env.DB.prepare('INSERT INTO errors (ts,msg) VALUES (?,?)')
        .bind(Date.now(), String(e && e.message || e).slice(0, 500)).run();
    } catch {}
  }
}
