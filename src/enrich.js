// src/enrich.js -- turns a raw beacon payload + request.cf into storable columns.
// Every geo field on request.cf is optional. Nothing here may return undefined:
// binding undefined to a D1 statement throws D1_TYPE_ERROR.

import { DC_ASN } from './dc-asn.js';

const DC_NAME  = /amazon|\baws\b|google cloud|microsoft|azure|digitalocean|linode|akamai|fastly|\bovh\b|hetzner|vultr|contabo|scaleway|leaseweb|\bm247\b|datacamp|choopa|quadranet|colocrossing|psychz|oracle|alibaba|tencent|\bhost|cloud|server|\bvps\b|datacent|colo\b|dedicated/i;
const VPN_NAME = /mullvad|nordvpn|\bnord\b|protonvpn|proton ag|expressvpn|surfshark|private internet access|\bpia\b|cyberghost|ipvanish|windscribe|tunnelbear|\bvpn\b/i;
const MOBILE   = /t-mobile|verizon|at&t|sprint|vodafone|telefonica|orange|\bo2\b|three\b|ee limited|rogers|bell canada|telus|cellular|wireless|mobile/i;
const RELAY_ASN = new Set([714, 6185, 13335, 20940, 54113, 16625]); // Apple, Cloudflare, Akamai, Fastly

// null, never undefined. Empty strings become null so SQL IS NULL works.
// JSON can carry an object whose toString and valueOf are not callable, which
// makes String(v) and Number(v) THROW rather than return junk. The body is
// attacker-controlled, so every coercion is wrapped.
export const s = (v, max = 512) => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'object') return null;
  try { const t = String(v); return t === '' ? null : t.slice(0, max); } catch { return null; }
};
export const n = (v) => { try { const x = Number(v); return Number.isFinite(x) ? x : null; } catch { return null; } };
export const i = (v) => { try { const x = parseInt(v, 10); return Number.isFinite(x) ? x : null; } catch { return null; } };

// GitHub Pages serves /contact, /contact.html and /contact/ as one page.
// Without this they land as three endpoints and every count splits.
export function normalizePath(raw) {
  let p;
  let input;
  try { input = typeof raw === 'string' ? raw : String(raw ?? '/'); } catch { input = '/'; }
  // Collapse leading slashes FIRST. new URL() would otherwise read '//host/x'
  // as an authority and silently drop the first segment.
  input = input.replace(/^\/+/, '/');
  try { p = new URL(input, 'https://x.invalid').pathname; } catch { p = input; }
  p = p.replace(/\/{2,}/g, '/');
  try { p = decodeURIComponent(p); } catch { /* keep as-is */ }
  p = p.toLowerCase();
  p = p.replace(/\/index\.html?$/, '/');
  p = p.replace(/\/index$/, '/');
  p = p.replace(/\.html?$/, '');
  if (p.length > 1) p = p.replace(/\/+$/, '');
  if (!p || p[0] !== '/') p = '/' + (p || '');
  return p.slice(0, 512) || '/';
}

// SQLite has no timezones. Precompute John's local day and hour at write time
// so every histogram and "today" boundary agrees, including across DST.
const NY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
});
export function nyParts(ts) {
  const p = {};
  for (const part of NY.formatToParts(new Date(ts))) p[part.type] = part.value;
  const hour = parseInt(p.hour, 10);
  return {
    day_local: `${p.year}-${p.month}-${p.day}`,
    hour_local: Number.isFinite(hour) ? hour % 24 : 0,
  };
}

export function parseUA(ua) {
  if (!ua) return { browser: null, os: null, device: null };
  let browser = 'Other';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
  else if (/Firefox\/|FxiOS/.test(ua)) browser = 'Firefox';
  else if (/Chrome\/|CriOS/.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua)) browser = 'Safari';

  let os = 'Other';
  if (/iPhone|iPod/.test(ua)) os = 'iOS';
  else if (/iPad/.test(ua)) os = 'iPadOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
  else if (/Windows NT/.test(ua)) os = 'Windows';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Linux/.test(ua)) os = 'Linux';

  const device = /iPad|Tablet/.test(ua) ? 'tablet'
    : /Mobile|iPhone|iPod|Android/.test(ua) ? 'mobile' : 'desktop';
  return { browser, os, device };
}

// What the IP actually tells you. 'exact' is still only city-level.
export function networkSignals(cf, ua) {
  const asn = i(cf?.asn) || 0;
  const org = cf?.asOrganization || '';
  let net_kind = null;
  let geo_conf = 'exact';

  if (DC_ASN.has(asn) || DC_NAME.test(org)) { net_kind = 'dc'; geo_conf = 'unknown'; }
  if (VPN_NAME.test(org)) { net_kind = 'vpn'; geo_conf = 'relay'; }
  if (RELAY_ASN.has(asn) && /Safari/i.test(ua || '') && !/Chrome|Chromium|Edg/i.test(ua || '')) {
    net_kind = 'relay'; geo_conf = 'relay';
  }
  if (cf?.country === 'T1') { net_kind = 'tor'; geo_conf = 'unknown'; }
  if (!net_kind && MOBILE.test(org)) geo_conf = 'regional';
  return { net_kind, geo_conf };
}

// Grouping hash, not a secret. Salted so it is not a rainbow-table lookup.
export async function fpHash(parts, salt) {
  const data = new TextEncoder().encode(salt + '|' + parts.join('|'));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}
