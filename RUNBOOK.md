# Runbook

## Once a month: back up

D1 Time Travel keeps only **7 days** on the free plan, not 30. This database is
the only copy of data you want to keep forever, so the export is the archive.

```bash
cd ~/Dev/site-analytics && npm run backup
```

Keep the file somewhere that is not Cloudflare.

## Once a month: keep the query planner honest

```bash
npx wrangler d1 execute site-analytics --remote -y --command "ANALYZE"
```

## When something looks wrong

The whole pipeline swallows errors on purpose: the Worker always returns 204,
the database write happens after the response, and the beacon never throws into
your page. That is correct — a visitor must never see an analytics failure —
but it means a broken pipeline and a quiet week look identical.

Three things tell them apart:

1. **`LAST EVENT` in the dashboard header.** Age, not count. If it says 3 days
   and you know people visited, something is broken.
2. **The HEALTH tab.** Write errors are logged to a table and shown there.
   `SEND TEST EVENT` proves the round trip without leaving the page.
3. `npm run tail` for live errors.

The most likely failure is applying the schema without `--remote`, which writes
to a local file and leaves production with no tables. Check with:

```bash
npx wrangler d1 execute site-analytics --remote -y \
  --command "SELECT COUNT(*) FROM events"
```

## Every few months: check you have not been added to a filter list

The beacon host is `workers.dev`, which is a different registrable domain from
`hoeksemaa.github.io`, so third-party blocking rules can apply to it. There is
no blanket rule today, but maintainers do write path rules at the workers.dev
level when a beacon path becomes popular (`||workers.dev/api/event` already
exists, from Plausible self-hosters all picking the same path).

```bash
gh api -H "Accept: application/vnd.github.raw" \
  /repos/easylist/easylist/contents/easyprivacy/easyprivacy_thirdparty.txt | grep -i "workers.dev"
gh api -H "Accept: application/vnd.github.raw" \
  /repos/uBlockOrigin/uAssets/contents/filters/filters-2026.txt | grep -i "workers.dev"
```

If a rule appears that matches `/s`, change the path in `src/index.js` and in
the beacon, and redeploy. The permanent fix costs about $10/year: put the site
and the beacon on one real domain, which makes the request first-party and
exempt from third-party rules entirely.

## Mark a browser as yours

Visit any page with `?noanalytics=1` once per browser. Your visits are then
flagged, not dropped, and hidden by default behind the `MINE` toggle. Undo it
with `?noanalytics=0`.

## Change the dashboard path

Edit `DASH_PATH` in `wrangler.jsonc`, then `npm run deploy`.

## Turn the whole thing off

Remove the `<script>` block from `_layouts/default.html` and push. Collection
stops immediately; the data stays. To delete it all:

```bash
npx wrangler delete                        # the Worker
npx wrangler d1 delete site-analytics      # the database, irreversibly
```

## Free-tier ceilings

| | Limit | Notes |
|---|---|---|
| Worker requests | 100,000/day | Each event is one request. |
| D1 rows written | 100,000/day | Counted properly, one page view costs about **19 row writes**, so the real ceiling is roughly **5,000 page views/day** — see below. |
| D1 rows read | 5,000,000/day | Dashboard loads read a few hundred rows each. |
| D1 storage | 500 MB | About 700,000 events at ~750 bytes each. |

Exhausting the daily **write** budget also blocks reads, which takes the
dashboard offline until the quota resets at UTC midnight. That is why `/s` is
rate limited to 60 requests per minute per IP.

### Where 19 writes per page view comes from

D1 bills every index entry as a row write, and one page view sends two events.

| | writes |
|---|---|
| `pv` row + 5 full indexes + 1 partial index | 7 |
| `endpoints` upsert | 1 |
| `places` upsert + its index | 2 |
| `visitors` upsert + its index | 2 |
| `end` row (dwell) + 5 full indexes + 1 partial index | 7 |
| **total** | **19** |

Video plays add ~7 each. This is worth knowing before adding an index: each new
index on `events` adds two writes to every page view, permanently.
