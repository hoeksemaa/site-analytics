# site-analytics

First-party analytics for <https://hoeksemaa.github.io>, on one Cloudflare
Worker and one D1 database. Free tier, no third-party service, no cookie
banner, no vendor.

Everything here is public on purpose. The dashboard is an easter egg, not a
secret — the only thing protecting it is that the path is not linked anywhere.

| | |
|---|---|
| Dashboard | <https://hx-7f3a91c4.hoeksemaa.workers.dev/back-room> |
| Collector | `https://hx-7f3a91c4.hoeksemaa.workers.dev/s` |
| Database  | `site-analytics` (D1, region ENAM) |
| Beacon    | inlined in `hoeksemaa.github.io/_layouts/default.html` |

## How it works

GitHub Pages serves static files and can run no code, so it can log nothing.
Instead every page inlines a 1.3 KB (gzipped) beacon. It POSTs one small JSON
body to the Worker, which stamps on the time, the IP, and the city/ISP data
Cloudflare attaches to every request, then writes one row to D1.

The beacon lives in `_layouts/default.html`, and that one layout renders every
page on the site. **This is why new pages need no configuration.** Add a post,
a project or a video and it is tracked on its first visit. Delete one and its
history stays. There is no endpoint list anywhere in this repo, and there never
should be.

## Layout

| Path | What |
|---|---|
| `src/index.js` | Router and the collector. |
| `src/api.js` | Dashboard JSON. ORDER BY comes from an allowlist — see the note there. |
| `src/enrich.js` | Path normalization, New York time bucketing, UA and network parsing. |
| `src/bots.js` | User-agent classifier. |
| `src/dc-asn.js` | 723 datacenter ASNs, generated from `brianhama/bad-asn-list` (MIT). |
| `src/world.js` | Country outlines, decoded from world-atlas 110m. |
| `src/dashboard.html` / `src/app.tpl` | The dashboard page and its script. |
| `beacon/beacon.js` | Beacon source. `beacon/snippet.js` is the built, minified copy that goes in the layout. |
| `schema.sql` | The whole database. |

## Commands

```bash
npm run deploy      # ship the Worker
npm run schema      # apply schema.sql to the REMOTE database
npm run backup      # export the database to backups/
npm run tail        # live errors only
```

See `RUNBOOK.md` for the things that need doing occasionally.
