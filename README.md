# site-analytics

A request log for <https://johnhoeksema.com>, on one Cloudflare Worker and one
D1 database. Free tier, no script on the site, no third-party service.

| | |
|---|---|
| Page | <https://johnhoeksema.com/analytics> (public, not linked anywhere) |
| Worker | `site-analytics`, on the route `johnhoeksema.com/*` |
| Database | `site-analytics` (D1), table `requests` |

## How it works

Cloudflare runs the DNS for johnhoeksema.com, and the site's `A` records are
"Proxied" (orange cloud). Thus every request passes through this Worker on its
way to GitHub Pages. The Worker sends each request on unchanged. When GitHub
answers with an HTML page, the Worker writes one row: time, path, IP, location,
and a bot name. It writes the row after the visitor has the response, and an
error in the Worker falls back to serving the site directly.

The Worker skips images, CSS, fonts, video, and redirects. GitHub's 404 page is
HTML, so requests for missing pages, such as scanner probes, are logged.

`/analytics` is served by the Worker itself. It lists the newest 500 rows, in
New York time, with an "older" link. Bot rows are grey.

Bot names come from `src/bots.js`: first the user agent, then a list of
hosting-company networks (`src/dc-asn.js`). A scraper that fakes a normal
browser from a home network looks like a person.

## Layout

| Path | What |
|---|---|
| `src/index.js` | The logger and the `/analytics` page. |
| `src/bots.js` | User agent to bot name. |
| `src/dc-asn.js` | 723 hosting-company networks, from `brianhama/bad-asn-list` (MIT). |
| `schema.sql` | The `requests` table. |

## Commands

```bash
npm run deploy      # ship the Worker
npm run schema      # apply schema.sql to the REMOTE database
npm run backup      # export the database to backups/
npm run tail        # live logs
```

To test locally against the live site, run
`npx wrangler d1 execute site-analytics --local --file=./schema.sql -y`, then
`npx wrangler dev --local --local-protocol https`. Use `https`: over `http`,
GitHub answers every request with a redirect, and the Worker logs nothing.

## Old data

The database also holds the tables of the first version (`events`,
`endpoints`, `places`, `visitors`, `errors`, `rl`). They hold page views from
2026-09-16 to 2026-10-01, sent by a script on each page. Nothing reads them now.

## Turn it off

Set the `A` records in Cloudflare back to "DNS only" (grey cloud). The site
then goes straight to GitHub, and logging stops. To remove the Worker as well,
run `npx wrangler delete`. The data stays in D1.

## Free-tier limits

Each page request is one Worker request and one D1 row write. Asset requests
also count as Worker requests. The limits are 100,000 Worker requests and
100,000 D1 row writes each day.
