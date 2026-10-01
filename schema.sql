-- johnhoeksema.com analytics -- D1 schema
-- Apply with:  npm run schema
-- The --remote flag in that script is MANDATORY. Without it this writes to a
-- local sqlite file, and the deployed Worker sees no table.

-- One row per page request. id rises with time, so the page's
-- ORDER BY id DESC needs no index, and each insert is one row write.
CREATE TABLE IF NOT EXISTS requests (
  id       INTEGER PRIMARY KEY,
  ts       INTEGER NOT NULL,   -- epoch milliseconds, stamped by the Worker
  path     TEXT    NOT NULL,   -- exactly as requested, no query string
  ip       TEXT,
  location TEXT,               -- "City, Region, Country" from Cloudflare
  bot      TEXT,               -- bot name, or NULL for a person
  ua       TEXT                -- not shown; kept so the bot rules can be rechecked
);
