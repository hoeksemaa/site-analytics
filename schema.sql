-- hoeksemaa.github.io analytics -- D1 schema
-- Apply with:  npx wrangler d1 execute site-analytics --remote --file=./schema.sql -y
-- The --remote flag is MANDATORY. Without it this writes to a local sqlite file
-- and the deployed Worker sees no tables, while every visitor still gets a 204.

CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY,

  -- time. ts is epoch MILLISECONDS stamped by the Worker, never by the browser.
  -- day_local/hour_local are America/New_York, precomputed so the histogram
  -- never has to do timezone maths in SQLite (which has none).
  ts           INTEGER NOT NULL,
  day_local    TEXT    NOT NULL,
  hour_local   INTEGER NOT NULL,
  client_ts    INTEGER,

  -- 'prod' | 'dev' (localhost) | 'test' (the dashboard's test button)
  env          TEXT    NOT NULL DEFAULT 'prod',

  -- 'pv' | 'end' | 'vplay' | 'vprog' | 'vdone' | 'test'
  event_type   TEXT    NOT NULL,
  pid          TEXT,                  -- page-view id: ties end/video events to their pv
  sid          TEXT,                  -- session id (sessionStorage)
  vid          TEXT,                  -- visitor id (localStorage)
  fp           TEXT,                  -- server-computed fingerprint hash

  -- what was loaded
  path         TEXT    NOT NULL,      -- normalized: no .html, no trailing slash, no query
  path_raw     TEXT,                  -- exactly what the browser sent, for debugging
  title        TEXT,
  referrer     TEXT,
  ref_host     TEXT,
  is_internal_ref INTEGER NOT NULL DEFAULT 0,

  -- event payload. target = video src basename; value = percent (vprog) or ms (end)
  target       TEXT,
  value        INTEGER,
  ms           INTEGER,
  vis0         TEXT,                  -- visibility at send: visible|hidden|prerender

  -- network / geo, all nullable: every cf geo field is optional
  ip           TEXT,
  country      TEXT,
  region       TEXT,
  region_code  TEXT,
  city         TEXT,
  postal       TEXT,
  lat          REAL,
  lon          REAL,
  tz           TEXT,
  asn          INTEGER,
  as_org       TEXT,
  net_kind     TEXT,                  -- NULL | dc | vpn | relay | tor
  geo_conf     TEXT    NOT NULL DEFAULT 'exact',  -- exact|regional|relay|unknown

  -- client
  ua           TEXT,
  browser      TEXT,
  os           TEXT,
  device       TEXT,                  -- desktop|mobile|tablet
  sw           INTEGER,
  sh           INTEGER,
  dpr          REAL,
  lang         TEXT,
  plat         TEXT,
  hc           INTEGER,
  storage_ok   INTEGER NOT NULL DEFAULT 1,

  -- classification
  is_bot       INTEGER NOT NULL DEFAULT 0,
  bot_name     TEXT,
  is_self      INTEGER NOT NULL DEFAULT 0,
  origin_ok    INTEGER NOT NULL DEFAULT 1
);

-- Every index we will ever want, created now. Adding one later to a large
-- table costs one write per existing row out of the 100k/day free budget.
CREATE INDEX IF NOT EXISTS idx_events_recent ON events(env, is_bot, ts DESC);
CREATE INDEX IF NOT EXISTS idx_events_path   ON events(path, ts DESC);
CREATE INDEX IF NOT EXISTS idx_events_geo    ON events(country, city, ts DESC);
CREATE INDEX IF NOT EXISTS idx_events_vid    ON events(vid, ts DESC);
CREATE INDEX IF NOT EXISTS idx_events_type   ON events(event_type, ts DESC);

-- Partial unique index so a re-fired exit event UPDATES the dwell time
-- instead of inserting a second row. Tab-flipping must not double-count.
CREATE UNIQUE INDEX IF NOT EXISTS ux_events_end ON events(pid) WHERE event_type = 'end';

-- Same trick for the pageview itself. A bfcache restore or a double-fired
-- beacon reuses the pid and is ignored; a genuine refresh gets a new pid
-- and is counted. This costs zero extra reads, unlike a time-window query.
CREATE UNIQUE INDEX IF NOT EXISTS ux_events_pv ON events(pid) WHERE event_type = 'pv';

-- ---------------------------------------------------------------------------
-- Catalogs. These exist so the dashboard's filter dropdowns never run
-- SELECT DISTINCT over the whole events table on every page load.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS endpoints (
  path       TEXT PRIMARY KEY,
  title      TEXT,
  first_seen INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  hits       INTEGER NOT NULL DEFAULT 0,
  has_video  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS places (
  geo_key    TEXT PRIMARY KEY,        -- country|region|city
  country    TEXT,
  region     TEXT,
  city       TEXT,
  lat        REAL,
  lon        REAL,
  first_seen INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  hits       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_places_hits ON places(hits DESC);

CREATE TABLE IF NOT EXISTS visitors (
  vid        TEXT PRIMARY KEY,
  first_seen INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  hits       INTEGER NOT NULL DEFAULT 0,
  label      TEXT,                    -- John can name a visitor by hand
  is_self    INTEGER NOT NULL DEFAULT 0,
  last_ip    TEXT,
  last_city  TEXT,
  last_country TEXT,
  last_as_org TEXT
);
CREATE INDEX IF NOT EXISTS idx_visitors_seen ON visitors(last_seen DESC);

-- Somewhere for a failed insert to leave a trace. Without this, a broken
-- pipeline is indistinguishable from a quiet week.
CREATE TABLE IF NOT EXISTS errors (
  id   INTEGER PRIMARY KEY,
  ts   INTEGER NOT NULL,
  msg  TEXT
);

-- Per-IP request counter for the public collector. WITHOUT ROWID so the
-- primary key IS the table: one b-tree write per hit, no secondary index.
-- This is the only store that proved consistent on the free tier -- the
-- platform ratelimit binding and the Cache API were both measured as no-ops.
CREATE TABLE IF NOT EXISTS rl (
  k   TEXT PRIMARY KEY,
  n   INTEGER NOT NULL,
  exp INTEGER NOT NULL
) WITHOUT ROWID;
