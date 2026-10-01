// src/bots.js -- names the bot behind a request, or returns null for a person.
// First match wins.

import { DC_ASN } from './dc-asn.js';

const RULES = [
  // Link previews: someone pasted a link into a chat or a post. iMessage sends
  // a Safari user agent with these three names added, so it must come first.
  [/facebookexternalhit.*Twitterbot/i,                  'link preview (iMessage)'],
  [/facebookexternalhit|\bFacebot\b/i,                  'link preview (Facebook)'],
  [/Twitterbot/i,                                       'link preview (X)'],
  [/Slackbot|Slack-ImgProxy/i,                          'link preview (Slack)'],
  [/Discordbot/i,                                       'link preview (Discord)'],
  [/TelegramBot/i,                                      'link preview (Telegram)'],
  [/\bWhatsApp\//i,                                     'link preview (WhatsApp or Signal)'],
  [/LinkedInBot/i,                                      'link preview (LinkedIn)'],
  [/redditbot/i,                                        'link preview (Reddit)'],
  [/Bluesky\s*Cardyb/i,                                 'link preview (Bluesky)'],
  [/Mastodon\/|Pleroma|Akkoma|Misskey/i,                'link preview (Mastodon)'],
  [/Embedly|Iframely|SkypeUriPreview|Pinterest|Snapchat|Viber/i, 'link preview'],

  // Search engines.
  [/Googlebot|Google-InspectionTool|Storebot-Google|AdsBot-Google/i, 'Googlebot'],
  [/bingbot|BingPreview|adidxbot/i,                     'Bingbot'],
  [/Applebot(?!-Extended)/i,                            'Applebot'],
  [/DuckDuckBot/i,                                      'DuckDuckBot'],
  [/YandexBot|Baiduspider|Sogou|Seznam|PetalBot|Qwantbot|MojeekBot/i, 'search crawler'],

  // AI crawlers and agents.
  [/GPTBot|OAI-SearchBot|ChatGPT-User|ChatGPT Agent/i,  'AI (OpenAI)'],
  [/ClaudeBot|Claude-User|Claude-SearchBot|anthropic-ai/i, 'AI (Anthropic)'],
  [/PerplexityBot|Perplexity-User/i,                    'AI (Perplexity)'],
  [/Google-Extended|GoogleOther|Google-CloudVertexBot/i, 'AI (Google)'],
  [/Meta-ExternalAgent|Meta-ExternalFetcher|FacebookBot/i, 'AI (Meta)'],
  [/Bytespider|TikTokSpider/i,                          'AI (ByteDance)'],
  [/Amazonbot/i,                                        'AI (Amazon)'],
  [/\bCCBot\b|Applebot-Extended|cohere-ai|Diffbot|YouBot|AI2Bot|FirecrawlAgent/i, 'AI crawler'],

  // SEO tools, uptime monitors, headless browsers, scripts.
  [/AhrefsBot|SemrushBot|MJ12bot|DotBot|BLEXBot|DataForSeoBot|Barkrowler|SeekportBot/i, 'SEO crawler'],
  [/UptimeRobot|Pingdom|StatusCake|Site24x7|Uptime-Kuma|Lighthouse|GTmetrix/i, 'uptime monitor'],
  [/HeadlessChrome|Puppeteer|Playwright|PhantomJS|Selenium/i, 'headless browser'],
  [/python-|\bcurl\/|Wget\/|Go-http-client|okhttp|Java\/|axios\/|node-fetch|undici|Scrapy|libwww-perl|PostmanRuntime|Apache-HttpClient/i, 'script'],
];

// Safety net for bots that name themselves but are not in the list above.
const CATCH_ALL = /(?:bot|crawler|crawl|spider|slurp|fetcher|scraper|preview)(?![a-z])/i;
// Real phones and words that the safety net would otherwise catch.
const NOT_A_BOT = /\bCUBOT\b|Botswana|iRobot|Robotics/i;

export function botName(ua, asn) {
  if (!ua) return 'no user agent';
  for (const [re, name] of RULES) if (re.test(ua)) return name;
  if (CATCH_ALL.test(ua) && !NOT_A_BOT.test(ua)) return 'unnamed bot';
  // A normal browser user agent from a hosting company is almost always a
  // script that fakes it. A VPN on a hosting network can also land here.
  if (DC_ASN.has(asn)) return 'datacenter';
  return null;
}
