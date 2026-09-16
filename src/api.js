// src/api.js -- JSON for the dashboard. Every value is bound with ?; the only
// things interpolated into SQL are ORDER BY column/direction, and those come
// from an allowlist. ORDER BY cannot be parameterized in SQLite, so this is
// the exact spot where a sortable table becomes injectable.

const SORTS = Object.assign(Object.create(null), {
  ts: 'e.ts', path: 'e.path', city: 'e.city', country: 'e.country',
  as_org: 'e.as_org', ip: 'e.ip', browser: 'e.browser', os: 'e.os',
  event_type: 'e.event_type', ms: 'e.ms',
});
const DIRS = Object.assign(Object.create(null), { asc: 'ASC', desc: 'DESC' });

const RECENT_COLS = `e.id, e.ts, e.event_type, e.path, e.path_raw, e.title, e.vid, e.ip,
  e.city, e.region, e.region_code, e.country, e.as_org, e.net_kind, e.geo_conf,
  e.browser, e.os, e.device, e.ms, e.target, e.value, e.is_bot, e.bot_name,
  e.is_self, e.ref_host, e.lat, e.lon, e.env, e.vis0, e.storage_ok`;

// Builds the shared WHERE clause. Returns {sql, args}.
function filters(u, alias = 'e') {
  const w = [], a = [];
  const g = (k) => { const v = u.searchParams.get(k); return v === null || v === '' ? null : v; };

  w.push(`${alias}.env = ?`); a.push(g('env') || 'prod');

  if (g('bots') !== '1') { w.push(`${alias}.is_bot = 0`); }
  if (g('self') !== '1') { w.push(`${alias}.is_self = 0`); }

  const from = g('from'), to = g('to');
  if (from) { w.push(`${alias}.ts >= ?`); a.push(parseInt(from, 10)); }
  if (to)   { w.push(`${alias}.ts <= ?`); a.push(parseInt(to, 10)); }

  for (const [q, col] of [['path','path'], ['country','country'], ['city','city'], ['vid','vid'], ['type','event_type']]) {
    const v = g(q);
    if (v) { w.push(`${alias}.${col} = ?`); a.push(v); }
  }
  const q = g('q');
  if (q) {
    w.push(`(${alias}.path LIKE ? OR ${alias}.city LIKE ? OR ${alias}.as_org LIKE ? OR ${alias}.ip LIKE ? OR ${alias}.title LIKE ?)`);
    const like = `%${q}%`; a.push(like, like, like, like, like);
  }
  return { sql: w.join(' AND '), args: a };
}

// The dashboard page is served from hoeksemaa.github.io, so every API read is
// cross-origin. This grants exactly that one origin. It is not a new exposure:
// the same JSON is already readable at the Worker's own path by anyone who
// knows it, because the owner chose to run this without a password.
export const SITE = 'https://hoeksemaa.github.io';
export const CORS = {
  'access-control-allow-origin': SITE,
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
  'vary': 'Origin',
};
const jsonOK = (d) => new Response(JSON.stringify(d), {
  headers: Object.assign({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex',
  }, CORS),
});

export async function api(route, url, request, env) {
  const DB = env.DB;

  if (route === 'summary') {
    const f = filters(url);
    const { nyParts } = await import('./enrich.js');
    const today = nyParts(Date.now()).day_local;
    const [tot, uniq, top, last, err] = await DB.batch([
      DB.prepare(`SELECT COUNT(*) c, COUNT(DISTINCT vid) v FROM events e WHERE ${f.sql} AND e.event_type='pv'`).bind(...f.args),
      DB.prepare(`SELECT COUNT(*) c FROM events e WHERE ${f.sql} AND e.event_type='pv' AND e.day_local = ?`).bind(...f.args, today),
      DB.prepare(`SELECT e.path, COUNT(*) c FROM events e WHERE ${f.sql} AND e.event_type='pv' GROUP BY e.path ORDER BY c DESC LIMIT 1`).bind(...f.args),
      // ts rises with id, so the rowid index answers this with one seek.
      // MAX(ts) would scan: no index has ts as its leftmost column.
      DB.prepare(`SELECT ts t FROM events ORDER BY id DESC LIMIT 1`),
      DB.prepare(`SELECT COUNT(*) c, MAX(ts) t FROM errors`),
    ]);
    const city = await DB.prepare(
      `SELECT e.city, e.country, COUNT(*) c FROM events e WHERE ${f.sql} AND e.event_type='pv' AND e.city IS NOT NULL
       GROUP BY e.city, e.country ORDER BY c DESC LIMIT 1`).bind(...f.args).first();
    return jsonOK({
      views: tot.results[0]?.c || 0,
      visitors: tot.results[0]?.v || 0,
      today: uniq.results[0]?.c || 0,
      top_path: top.results[0]?.path || null,
      top_path_c: top.results[0]?.c || 0,
      top_city: city ? `${city.city}, ${city.country}` : null,
      top_city_c: city?.c || 0,
      last_event: last.results[0]?.t || null,
      errors: err.results[0]?.c || 0,
      error_last: err.results[0]?.t || null,
      now: Date.now(),
    });
  }

  if (route === 'recent') {
    const f = filters(url);
    const sort = SORTS[url.searchParams.get('sort')] || SORTS.ts;
    const dir = DIRS[url.searchParams.get('dir')] || 'DESC';
    // Capped at 200: the 10ms CPU limit is spent on JSON-serializing the
    // response, not on waiting for D1.
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '200', 10) || 200, 200);
    const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);
    const r = await DB.prepare(
      `SELECT ${RECENT_COLS}, v.label FROM events e LEFT JOIN visitors v ON v.vid = e.vid
       WHERE ${f.sql} ORDER BY ${sort} ${dir}, e.id ${dir} LIMIT ? OFFSET ?`
    ).bind(...f.args, limit, offset).all();
    return jsonOK({ rows: r.results || [], limit, offset });
  }

  if (route === 'places') {
    const f = filters(url);
    const geoWhere = `${f.sql} AND e.event_type='pv' AND e.lat IS NOT NULL AND e.lon IS NOT NULL`;
    const r = await DB.prepare(
      `WITH agg AS (
         SELECT e.country, e.region, e.city,
                COUNT(*) c, COUNT(DISTINCT e.vid) v, MAX(e.ts) last_ts,
                MAX(e.geo_conf) geo_conf
         FROM events e WHERE ${geoWhere}
         GROUP BY e.country, e.region, e.city
       ),
       rep AS (
         SELECT e.country, e.region, e.city, e.region_code, e.lat, e.lon,
                ROW_NUMBER() OVER (PARTITION BY e.country, e.region, e.city ORDER BY e.ts DESC) rn
         FROM events e WHERE ${geoWhere}
       )
       SELECT a.city, a.region, a.country, a.c, a.v, a.last_ts, a.geo_conf,
              r.region_code, r.lat, r.lon
       FROM agg a JOIN rep r
         ON r.rn = 1 AND r.country IS a.country AND r.region IS a.region AND r.city IS a.city
       ORDER BY a.c DESC LIMIT 500`
    ).bind(...f.args, ...f.args).all();
    const nogeo = await DB.prepare(
      `SELECT COUNT(*) c FROM events e WHERE ${f.sql} AND e.event_type='pv' AND (e.lat IS NULL OR e.lon IS NULL)`
    ).bind(...f.args).first();
    return jsonOK({ places: r.results || [], no_geo: nogeo?.c || 0 });
  }

  if (route === 'histogram') {
    const f = filters(url);
    const by = url.searchParams.get('by') === 'hour' ? 'hour' : 'day';
    const sql = by === 'hour'
      ? `SELECT e.day_local || 'T' || printf('%02d', e.hour_local) k, COUNT(*) c
         FROM events e WHERE ${f.sql} AND e.event_type='pv' GROUP BY k ORDER BY k`
      : `SELECT e.day_local k, COUNT(*) c
         FROM events e WHERE ${f.sql} AND e.event_type='pv' GROUP BY k ORDER BY k`;
    const r = await DB.prepare(sql).bind(...f.args).all();
    return jsonOK({ by, buckets: r.results || [] });
  }

  // Facets come from the catalogs, never from SELECT DISTINCT over events.
  if (route === 'facets') {
    const [eps, pl] = await DB.batch([
      DB.prepare(`SELECT path, title, hits, last_seen, has_video FROM endpoints ORDER BY hits DESC LIMIT 300`),
      DB.prepare(`SELECT country, region, city, hits FROM places ORDER BY hits DESC LIMIT 300`),
    ]);
    return jsonOK({ endpoints: eps.results || [], places: pl.results || [] });
  }

  if (route === 'videos') {
    const f = filters(url);
    const r = await DB.prepare(
      `SELECT e.path, e.target,
              SUM(CASE WHEN e.event_type='vplay' THEN 1 ELSE 0 END) plays,
              COUNT(DISTINCT CASE WHEN e.event_type='vplay' THEN e.vid END) viewers,
              SUM(CASE WHEN e.event_type='vdone' THEN 1 ELSE 0 END) completions,
              MAX(e.value) max_pct, MAX(e.ts) last_ts
       FROM events e WHERE ${f.sql} AND e.event_type IN ('vplay','vprog','vdone')
       GROUP BY e.path, e.target ORDER BY last_ts DESC LIMIT 50`
    ).bind(...f.args).all();
    return jsonOK({ videos: r.results || [] });
  }

  if (route === 'watchers') {
    const f = filters(url);
    const r = await DB.prepare(
      `SELECT e.vid, v.label, MAX(e.value) pct, MAX(e.ts) last_ts, e.target, e.path,
              v.last_city city, v.last_country country, v.last_as_org as_org, v.last_ip ip
       FROM events e LEFT JOIN visitors v ON v.vid=e.vid
       WHERE ${f.sql} AND e.event_type IN ('vplay','vprog','vdone')
       GROUP BY e.vid, e.target, e.path, v.label, v.last_city, v.last_country, v.last_as_org, v.last_ip
       ORDER BY last_ts DESC LIMIT 100`
    ).bind(...f.args).all();
    return jsonOK({ watchers: r.results || [] });
  }

  if (route === 'visitor') {
    const vid = url.searchParams.get('vid');
    if (!vid) return jsonOK({ error: 'vid required' });
    const [meta, evts] = await DB.batch([
      DB.prepare(`SELECT * FROM visitors WHERE vid = ?`).bind(vid),
      DB.prepare(
        `SELECT ts, event_type, path, path_raw, title, target, value, ms, city, region_code, country,
                as_org, ip, browser, os, device, ref_host, net_kind
         FROM events WHERE vid = ? ORDER BY ts DESC LIMIT 200`).bind(vid),
    ]);
    return jsonOK({ visitor: meta.results[0] || null, events: evts.results || [] });
  }

  if (route === 'label' && request.method === 'POST') {
    const b = await request.json().catch(() => null);
    if (!b || !b.vid || typeof b.vid !== 'string') return jsonOK({ ok: false });
    const vid = b.vid.slice(0, 128);
    const label = typeof b.label === 'string' ? (b.label.trim().slice(0, 64) || null) : null;
    await DB.prepare(
      `INSERT INTO visitors (vid,first_seen,last_seen,hits,label) VALUES (?,?,?,0,?)
       ON CONFLICT(vid) DO UPDATE SET label=excluded.label`
    ).bind(vid, Date.now(), Date.now(), label).run();
    return jsonOK({ ok: true });
  }

  if (route === 'mark-self' && request.method === 'POST') {
    const b = await request.json().catch(() => null);
    if (!b || !b.vid || typeof b.vid !== 'string') return jsonOK({ ok: false });
    const mvid = b.vid.slice(0, 128);
    const val = b.is_self ? 1 : 0;
    await DB.batch([
      DB.prepare(`UPDATE visitors SET is_self=? WHERE vid=?`).bind(val, mvid),
      DB.prepare(`UPDATE events SET is_self=? WHERE vid=?`).bind(val, mvid),
    ]);
    return jsonOK({ ok: true });
  }

  // Proves the whole round trip without leaving the page. On day one this is
  // the difference between "broken" and "nobody has visited yet".
  if (route === 'test' && request.method === 'POST') {
    const ts = Date.now();
    const { nyParts } = await import('./enrich.js');
    const p = nyParts(ts);
    await DB.prepare(
      `INSERT INTO events (ts,day_local,hour_local,env,event_type,path,path_raw,title,city,region,country,lat,lon,as_org,browser,os,device,vid,pid)
       VALUES (?,?,?,'test','test','/test','/test','dashboard test event','Brooklyn','New York','US',40.6782,-73.9442,'(test)','-','-','-','test-visitor',?)`
    ).bind(ts, p.day_local, p.hour_local, 'test-' + ts).run();
    return jsonOK({ ok: true, ts });
  }

  if (route === 'purge-test' && request.method === 'POST') {
    const r = await DB.prepare(`DELETE FROM events WHERE env='test'`).run();
    return jsonOK({ ok: true, deleted: r.meta?.changes ?? 0 });
  }

  if (route === 'errors') {
    const r = await DB.prepare(`SELECT ts,msg FROM errors ORDER BY ts DESC LIMIT 50`).all();
    return jsonOK({ errors: r.results || [] });
  }

  return new Response('Not Found', { status: 404, headers: CORS });
}
