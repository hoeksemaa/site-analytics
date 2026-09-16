/* hoeksemaa.github.io beacon. Inlined into _layouts/default.html, so it covers
   every page the layout renders -- today's and every page added later. There
   is no endpoint list anywhere, by design.
   Inlined rather than served as a file: EasyPrivacy carries blanket rules like
   ||workers.dev/js/script.js that hit every subdomain, and an inline script
   leaves nothing with a URL to match. */
(function () {
  var U = "__COLLECTOR__";
  var K = "hx_";                      // one storage prefix, everywhere
  var t0 = Date.now(), done = 0, sent = {}, dwellSent = 0;   // dwellSent = last ms reported

  // Chrome prerender and iOS "Preload Top Hit" run page JS for a page nobody
  // opened. Without this gate they arrive as real visits.
  if (document.prerendering) {
    document.addEventListener("prerenderingchange", start, { once: true });
  } else { start(); }

  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  function rand() {
    try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  // Visitor id lives in first-party storage on the site, never in a cookie on
  // the collector domain -- Safari ITP and Firefox would partition that away.
  var noStore = 0, cachedVid = null;
  function vid() {
    if (cachedVid) return cachedVid;
    var v = store(K + "vid");
    if (!v) {
      v = rand();
      store(K + "vid", v);
      // If it did not persist, keep it in memory for this page anyway.
      // Re-minting per event would make one visit look like several people.
      if (store(K + "vid") !== v) noStore = 1;
    }
    cachedVid = v;
    return v;
  }
  function sid() {
    try {
      var v = sessionStorage.getItem(K + "sid");
      if (!v) { v = rand(); sessionStorage.setItem(K + "sid", v); }
      return v;
    } catch (e) { return null; }
  }

  var pid = rand();

  function send(o) {
    var body;
    try { body = JSON.stringify(o); } catch (e) { return; }
    var ok = false;
    // text/plain keeps this a no-cors beacon: no preflight, no round trip.
    // Changing this type to application/json makes it a credentialed CORS
    // request and adds an OPTIONS call before every hit.
    try { ok = !!(navigator.sendBeacon && navigator.sendBeacon(U, new Blob([body], { type: "text/plain" }))); } catch (e) { ok = false; }
    if (ok) return;
    try { fetch(U, { method: "POST", body: body, keepalive: true, mode: "cors", headers: { "Content-Type": "text/plain" } }).catch(function () {}); } catch (e) {}
  }

  function base(k) {
    return {
      k: k, pid: pid, sid: sid(), vid: vid(), t: Date.now(),
      p: location.pathname, h: location.hostname,
      ti: document.title, r: document.referrer || null,
      vis: document.visibilityState,
      sw: screen.width, sh: screen.height, dpr: devicePixelRatio,
      lang: navigator.language,
      plat: (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform,
      hc: navigator.hardwareConcurrency,
      x: store(K + "off") ? 1 : 0,
      ns: noStore
    };
  }

  function start() {
    t0 = Date.now();   // reset: a prerender may have parsed this long ago

    // ?noanalytics=1 marks this browser as John's. It is not a secret and it
    // does not drop the data -- the rows are flagged so he can toggle them.
    try {
      var q = new URLSearchParams(location.search);
      if (q.get("noanalytics") === "1") store(K + "off", "1");
      if (q.get("noanalytics") === "0") { try { localStorage.removeItem(K + "off"); } catch (e) {} }
    } catch (e) {}

    // requestIdleCallback's timeout is best-effort, so a visitor who leaves
    // fast could be lost. pagehide/visibilitychange is the safety net, and
    // sendBeacon is built to survive exactly that unload path.
    if (window.requestIdleCallback) requestIdleCallback(fire, { timeout: 1500 });
    else setTimeout(fire, 300);
    addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") { fire(); exit(); } });
    addEventListener("pagehide", function () { fire(); exit(); });

    video();
  }

  function fire() { if (done) return; done = 1; send(base("pv")); }

  function exit() {
    var ms = Date.now() - t0;
    // Only re-send once the number has meaningfully grown. The server keeps
    // max(ms) on the page-view id, so later, larger values simply win.
    if (ms - dwellSent < 5000) return;
    dwellSent = ms;
    var o = base("end"); o.ms = ms; send(o);
  }

  // Any <video> on any page, including ones added later. Nothing per-page.
  function video() {
    // Resolved at EVENT time, not bind time: when the MutationObserver sees the
    // node, the resource selection algorithm has not run, currentSrc is "" and
    // a <source> child may not be parsed yet.
    function vname(v) {
      var u = v.currentSrc || v.src || "";
      if (!u) { var src = v.querySelector && v.querySelector("source[src]"); u = src ? src.getAttribute("src") : ""; }
      if (!u) return v.id || v.getAttribute("data-name") || "video";
      try { u = u.split("?")[0].split("#")[0]; } catch (e) {}
      return u.split("/").pop() || "video";
    }
    function bind(v) {
      if (v.__hx) return; v.__hx = 1;
      v.addEventListener("play", function () {
        var name = vname(v), key = name + ":play";
        // 'play' also fires on every unpause and on replay. Count one play per
        // video per page view; vprog carries the engagement detail.
        if (sent[key]) return; sent[key] = 1;
        var o = base("vplay"); o.tg = name; send(o);
      });
      v.addEventListener("timeupdate", function () {
        if (!v.duration) return;
        var name = vname(v);
        var pct = Math.floor((v.currentTime / v.duration) * 100);
        var mark = pct >= 100 ? 100 : pct >= 75 ? 75 : pct >= 50 ? 50 : pct >= 25 ? 25 : 0;
        if (!mark) return;
        var key = name + ":" + mark;
        if (sent[key]) return; sent[key] = 1;
        var o = base("vprog"); o.tg = name; o.v = mark; send(o);
      });
      v.addEventListener("ended", function () {
        var name = vname(v), key = name + ":done";
        if (sent[key]) return; sent[key] = 1;
        var o = base("vdone"); o.tg = name; o.v = 100; send(o);
      });
    }
    function scan() { var vs = document.getElementsByTagName("video"); for (var i = 0; i < vs.length; i++) bind(vs[i]); }
    scan();
    if (window.MutationObserver) new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  }
})();
