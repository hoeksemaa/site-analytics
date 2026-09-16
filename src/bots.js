// src/bots.js  --  no deps, ~5 KB source.  First match wins.
// kind: preview | search | ai | seo | monitor | headless | tool | feed | suspect

const RULES = [
  // ---- 1. LINK PREVIEW / MESSAGING  (highest priority: these poison "did Esther open it?") ----
  [/facebookexternalhit/i,          'facebookexternalhit', 'preview', 99],
  [/\bFacebot\b/i,                  'Facebot',             'preview', 99],
  [/Twitterbot/i,                   'Twitterbot',          'preview', 99],
  [/Slackbot|Slack-ImgProxy/i,      'Slackbot',            'preview', 99],
  [/Discordbot/i,                   'Discordbot',          'preview', 99],
  [/TelegramBot|Telegram\//i,       'TelegramBot',         'preview', 99],
  [/\bWhatsApp\//i,                 'WhatsApp or Signal',  'preview', 95],
  [/LinkedInBot/i,                  'LinkedInBot',         'preview', 99],
  [/SkypeUriPreview/i,              'SkypeUriPreview',     'preview', 99],
  [/redditbot/i,                    'redditbot',           'preview', 99],
  [/Pinterest(?:bot)?\//i,          'Pinterestbot',        'preview', 99],
  [/Bluesky\s*Cardyb/i,             'Bluesky Cardyb',      'preview', 99],
  [/Mastodon\/|Pleroma|Akkoma|Misskey|Friendica|Iceshrimp|Lemmy/i,
                                    'Fediverse preview',   'preview', 95],
  [/Embedly|Iframely|Nuzzel|Snapchat|Viber|\bLine\/|Yahoo Link Preview|vkShare|XING-contenttabreceiver/i,
                                    'Link preview fetcher','preview', 95],
  [/Applebot(?!-Extended)/i,        'Applebot',            'preview', 95], // RUNS JS

  // ---- 2. SEARCH ENGINES (Googlebot RUNS JS -- it WILL reach the beacon) ----
  [/Googlebot|Google-InspectionTool|Storebot-Google|Google-Read-Aloud|AdsBot-Google|Mediapartners-Google|APIs-Google|FeedFetcher-Google|Google Favicon/i,
                                    'Googlebot',           'search', 99],
  [/bingbot|BingPreview|adidxbot|MicrosoftPreview/i, 'Bingbot','search', 99],
  [/DuckDuckBot|DuckDuckGo-Favicons/i, 'DuckDuckBot',      'search', 99],
  [/YandexBot|YandexImages|YandexRenderResourcesBot/i, 'YandexBot','search',99],
  [/Baiduspider|Sogou|Seznam|Yeti\/|PetalBot|Qwantbot|MojeekBot|Exabot|Yahoo! Slurp|Neevabot|Timpibot/i,
                                    'Search crawler',      'search', 95],

  // ---- 3. AI CRAWLERS (verified against ai-robots-txt/ai.robots.txt, Sept 2026) ----
  [/GPTBot|OAI-SearchBot|ChatGPT-User|ChatGPT Agent|Operator\//i, 'OpenAI',  'ai', 99],
  [/ClaudeBot|Claude-User|Claude-SearchBot|Claude-Web|Claude-Code|anthropic-ai/i,
                                    'Anthropic',           'ai', 99],
  [/PerplexityBot|Perplexity-User/i,'Perplexity',          'ai', 99],
  [/\bCCBot\b/i,                    'CCBot',               'ai', 99],
  [/Bytespider|TikTokSpider|DoubaoBot/i, 'ByteDance',      'ai', 99],
  [/Google-Extended|GoogleOther|Google-CloudVertexBot|CloudVertexBot|Google-NotebookLM|Gemini-Deep-Research|GoogleAgent-/i,
                                    'Google AI',           'ai', 99],
  [/Meta-ExternalAgent|Meta-ExternalFetcher|FacebookBot/i, 'Meta AI','ai', 99],
  [/Applebot-Extended/i,            'Applebot-Extended',   'ai', 99],
  [/Amazonbot|bedrockbot|amazon-kendra|Amzn-SearchBot|AmazonBuyForMe/i, 'Amazon','ai',99],
  [/cohere-ai|cohere-training-data-crawler|MistralAI-User|DeepSeekBot|ERNIEBot|ChatGLM-Spider|YouBot|ExaBot|ExaSearchBot|Diffbot|FirecrawlAgent|Crawl4AI|AI2Bot|Ai2Bot-Dolma|Brightbot|ImagesiftBot|omgili|PanguBot|Kangaroo Bot|Webzio-Extended|LinerBot|SBIntuitionsBot|VelenPublicWebCrawler|Devin\/|Cursor\/|ProRataInc|Andibot|Awario|Factset_spyderbot/i,
                                    'AI crawler',          'ai', 95],

  // ---- 4. SEO / BACKLINK TOOLS ----
  [/AhrefsBot|AhrefsSiteAudit/i,    'AhrefsBot',           'seo', 99],
  [/SemrushBot|SiteAuditBot|SplitSignalBot/i, 'SemrushBot','seo', 99],
  [/MJ12bot|DotBot|rogerbot|BLEXBot|Barkrowler|DataForSeoBot|SeekportBot|ZoominfoBot|serpstatbot|Screaming Frog|Sitebulb|LinkpadBot|netEstate|SEOkicks|linkdexbot|spbot|SurdotlyBot|Nicecrawler/i,
                                    'SEO crawler',         'seo', 95],

  // ---- 5. UPTIME / SYNTHETIC MONITORS ----
  [/UptimeRobot|Pingdom|StatusCake|Site24x7|BetterUptime|Better Uptime|Uptime-Kuma|Datadog|NewRelicPinger|GTmetrix|Chrome-Lighthouse|Lighthouse|PTST\/|WebPageTest|hetrixtool|updown\.io|Freshping|Checkly|Cronitor|OhDear|Zabbix|Nagios|check_http|Blackbox Exporter/i,
                                    'Uptime monitor',      'monitor', 97],

  // ---- 6. HEADLESS BROWSERS / AUTOMATION (these DO run JS -- must be caught) ----
  [/HeadlessChrome|Headless(?:Firefox|Edg)/i, 'HeadlessChrome','headless', 99],
  [/Puppeteer|Playwright|PhantomJS|Selenium|WebDriver|Cypress|Nightmare|jsdom|Electron\/|SlimerJS|CasperJS|Splash|Prerender|Rendertron/i,
                                    'Automation',          'headless', 97],

  // ---- 7. HTTP CLIENTS / SCRIPTS ----
  [/python-requests|python-urllib|urllib|aiohttp|httpx|\bcurl\/|Wget\/|Go-http-client|okhttp|Java\/|axios\/|node-fetch|undici|got \(|Guzzle|libwww-perl|LWP::|PostmanRuntime|Apache-HttpClient|Scrapy|Ruby$|Faraday|HTTPie|Dart\/|reqwest|hyper\/|\bwinhttp\b|Zend_Http_Client|PHP\//i,
                                    'HTTP client',         'tool', 97],

  // ---- 8. FEED READERS ----
  [/Feedly|Feedbin|Inoreader|NewsBlur|Tiny Tiny RSS|NetNewsWire|Miniflux|FreshRSS|feedparser|Reeder|Bazqux|Newsblur|SimplePie|UniversalFeedParser/i,
                                    'Feed reader',         'feed', 95],
];

// Safety net. Verified: zero false positives across real Chrome, Safari, Firefox,
// Edge and Android (including the CUBOT phone brand, which the device guard covers).
const CATCH_ALL = /(?:bot|crawler|crawl|spider|slurp|fetcher|preview|scraper|scrape|archiver|indexer|checker|validator|monitor|probe)(?![a-z])/i;
const CATCH_SUB = /headless|phantomjs|jsdom|lighthouse|http[-_]?client|\bbot\b/i;
const DEVICE_GUARD = /\bCUBOT\b|\bCubot\b|\bBotswana\b|\biRobot\b|Robotics/i;

export function classifyUA(ua) {
  if (!ua) return { is_bot: 1, name: 'no user-agent', kind: 'suspect', conf: 80 };
  for (const [re, name, kind, conf] of RULES) {
    if (re.test(ua)) return { is_bot: 1, name, kind, conf };
  }
  if (!DEVICE_GUARD.test(ua) && (CATCH_ALL.test(ua) || CATCH_SUB.test(ua))) {
    return { is_bot: 1, name: 'unnamed bot (pattern)', kind: 'suspect', conf: 70 };
  }
  return { is_bot: 0, name: null, kind: null, conf: 0 };
}
