(function(){
'use strict';
var D = window.__DASH__, WORLD = window.__WORLD__;
var $ = function(s){ return document.querySelector(s); };
var el = function(s){ return document.getElementById(s); };

var state = {
  span: 7, from: null, to: null, path: '', country: '', city: '',
  q: '', bots: 0, self: 0, sort: 'ts', dir: 'desc', view: 'feed', vid: ''
};
var data = { rows: [], places: [], hist: [], facets: null, summary: null };
var timer = null, autoMs = 60000;

/* ── helpers ──────────────────────────────────────────── */
var NYT = new Intl.DateTimeFormat('en-US', { timeZone:'America/New_York',
  month:'short', day:'numeric', hour:'numeric', minute:'2-digit', hour12:true });
var NYFULL = new Intl.DateTimeFormat('en-US', { timeZone:'America/New_York', dateStyle:'medium', timeStyle:'medium' });

function ago(ts){
  if(!ts) return '—';
  var s = Math.max(0,(Date.now()-ts)/1000);
  if(s<60) return Math.floor(s)+'s ago';
  if(s<3600) return Math.floor(s/60)+'m ago';
  if(s<86400) return Math.floor(s/3600)+'h ago';
  if(s<2592000) return Math.floor(s/86400)+'d ago';
  return NYT.format(new Date(ts));
}
var ESCMAP={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
function esc(v){ return v==null?'':String(v).replace(/[&<>"']/g,function(c){return ESCMAP[c];}); }
function flag(cc){
  if(!cc||cc.length!==2||cc==='XX'||cc==='T1') return '';
  return String.fromCodePoint(0x1F1E6+cc.charCodeAt(0)-65, 0x1F1E6+cc.charCodeAt(1)-65)+' ';
}
function vcolor(vid){
  if(!vid) return '#444';
  var h=0; for(var i=0;i<vid.length;i++) h=(h*31+vid.charCodeAt(i))>>>0;
  return 'hsl('+(h%360)+',65%,58%)';
}
// Resolve against the site origin and then VERIFY it. A stored path such as
// '@evil.com/x' would otherwise concatenate into a link to another host.
function siteUrl(p){
  try{
    var u=new URL(String(p||'/'), 'https://hoeksemaa.github.io');
    return u.origin==='https://hoeksemaa.github.io' ? u.href : 'https://hoeksemaa.github.io/';
  }catch(e){ return 'https://hoeksemaa.github.io/'; }
}
function place(r){
  var p = [r.city, r.region_code||r.region, r.country].filter(Boolean).join(', ');
  return p || '—';
}
function td(txt, cls, filterKey, filterVal){
  var d = document.createElement('td');
  if(cls) d.className = cls;
  d.textContent = txt==null?'—':String(txt);
  if(filterKey){ d.className += ' cell'; d.onclick = function(){ setFilter(filterKey, filterVal); }; }
  return d;
}
function qs(extra){
  var p = new URLSearchParams();
  var r = range();
  if(r.from) p.set('from', r.from);
  if(r.to) p.set('to', r.to);
  if(state.path) p.set('path', state.path);
  if(state.country) p.set('country', state.country);
  if(state.city) p.set('city', state.city);
  if(state.vid) p.set('vid', state.vid);
  if(state.q) p.set('q', state.q);
  p.set('bots', state.bots?'1':'0');
  p.set('self', state.self?'1':'0');
  for(var k in (extra||{})) p.set(k, extra[k]);
  return p.toString();
}
function range(){
  if(state.from||state.to) return { from:state.from, to:state.to };
  if(!state.span) return {};
  return { from: Date.now() - state.span*86400000, to: null };
}
function get(route, extra){
  return fetch(D+'/api/'+route+'?'+qs(extra), {cache:'no-store'})
    .then(function(r){ return r.json(); })
    .catch(function(){ return null; });
}

/* ── map ──────────────────────────────────────────────── */
var cv = el('map'), ctx = cv.getContext('2d');
var view = { cx:0.5, cy:0.45, z:0 }, dragging=false, dragged=false, last=null, hot=null;

function proj(lon,lat){
  var x=(lon+180)/360;
  var l=Math.max(-85.05,Math.min(85.05,lat))*Math.PI/180;
  var y=(1-Math.log(Math.tan(l)+1/Math.cos(l))/Math.PI)/2;
  return [x,y];
}
function sx(x){ return (x-view.cx)*view.z + cv.clientWidth/2; }
function sy(y){ return (y-view.cy)*view.z + cv.clientHeight/2; }
function mPerPx(lat){ return 40075017*Math.cos(lat*Math.PI/180)/view.z; }

function sizeCanvas(c){
  var r = window.devicePixelRatio||1;
  c.width = c.clientWidth*r; c.height = c.clientHeight*r;
  c.getContext('2d').setTransform(r,0,0,r,0,0);
}
var minZ = 0;
function fitMap(){
  // Fit the inhabited band (72N..57S) to the box's HEIGHT, and never exceed
  // its width. The projection is square, so fitting width alone to a short
  // box pushes most of the populated world out of view.
  var yN=proj(0,72)[1], yS=proj(0,-57)[1];
  var zH=cv.clientHeight/Math.max(0.01,(yS-yN));
  view.z = Math.min(cv.clientWidth, zH);
  minZ = view.z * 0.9;
  view.cx=0.5; view.cy=(yN+yS)/2;
  drawMap();
}

function drawMap(){
  var W=cv.clientWidth, H=cv.clientHeight;
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#101010'; ctx.fillRect(0,0,W,H);

  // country outlines
  ctx.strokeStyle='#2A2A2A'; ctx.lineWidth=1; ctx.beginPath();
  for(var a=0;a<WORLD.length;a++){
    var arc=WORLD[a], started=false;
    for(var i=0;i<arc.length;i++){
      var p=proj(arc[i][0],arc[i][1]), X=sx(p[0]), Y=sy(p[1]);
      if(X<-2000||X>W+2000||Y<-2000||Y>H+2000){ started=false; continue; }
      if(!started){ ctx.moveTo(X,Y); started=true; } else ctx.lineTo(X,Y);
    }
  }
  ctx.stroke();

  var max=1;
  for(var k=0;k<data.places.length;k++) if(data.places[k].c>max) max=data.places[k].c;

  // accuracy rings: honest about city-centroid precision, ~25km
  for(var j=0;j<data.places.length;j++){
    var pl=data.places[j];
    if(pl.lat==null) continue;
    var q=proj(pl.lon,pl.lat), X2=sx(q[0]), Y2=sy(q[1]);
    var rr = 25000/mPerPx(pl.lat);
    if(rr>6 && X2>-200 && X2<W+200 && Y2>-200 && Y2<H+200){
      ctx.beginPath(); ctx.setLineDash([2,3]);
      ctx.strokeStyle='rgba(255,98,0,0.28)'; ctx.lineWidth=1;
      ctx.arc(X2,Y2,rr,0,6.2832); ctx.stroke(); ctx.setLineDash([]);
    }
  }
  // volume circles, additive so dense areas glow
  ctx.globalCompositeOperation='lighter';
  for(var m=0;m<data.places.length;m++){
    var p2=data.places[m];
    if(p2.lat==null) continue;
    var c2=proj(p2.lon,p2.lat), X3=sx(c2[0]), Y3=sy(c2[1]);
    if(X3<-50||X3>W+50||Y3<-50||Y3>H+50) continue;
    var rad = 4 + 15*Math.sqrt(p2.c/max);
    var g = ctx.createRadialGradient(X3,Y3,0,X3,Y3,rad);
    var solid = p2.geo_conf==='exact';
    g.addColorStop(0, solid?'rgba(255,98,0,0.85)':'rgba(0,212,255,0.7)');
    g.addColorStop(1, 'rgba(255,98,0,0)');
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(X3,Y3,rad,0,6.2832); ctx.fill();
    ctx.fillStyle = solid?'#FF6200':'#00D4FF';
    ctx.beginPath(); ctx.arc(X3,Y3,2.2,0,6.2832); ctx.fill();
  }
  ctx.globalCompositeOperation='source-over';

  var zl = Math.round(Math.log2(view.z/256));
  el('mapinfo').textContent = 'z'+zl+' · city-centre accuracy, not street level'+
    (data.no_geo? ' · '+data.no_geo+' hits with no location':'');
}

function hitTest(mx,my){
  for(var i=0;i<data.places.length;i++){
    var p=data.places[i];
    if(p.lat==null) continue;
    var q=proj(p.lon,p.lat);
    var dx=sx(q[0])-mx, dy=sy(q[1])-my;
    if(dx*dx+dy*dy < 100) return p;
  }
  return null;
}
cv.addEventListener('mousedown', function(e){ dragging=true; dragged=false; last=[e.clientX,e.clientY]; cv.classList.add('drag'); });
window.addEventListener('mouseup', function(){ dragging=false; cv.classList.remove('drag'); });
cv.addEventListener('mousemove', function(e){
  var r=cv.getBoundingClientRect(), mx=e.clientX-r.left, my=e.clientY-r.top;
  if(dragging){
    dragged=true;
    view.cx -= (e.clientX-last[0])/view.z; view.cy -= (e.clientY-last[1])/view.z;
    last=[e.clientX,e.clientY]; drawMap(); el('tip').style.display='none'; return;
  }
  var h=hitTest(mx,my), t=el('tip');
  if(h){
    t.style.display='block'; t.style.left=Math.min(mx+12, cv.clientWidth-190)+'px'; t.style.top=(my+12)+'px';
    t.innerHTML='<b style="color:#FF6200">'+esc(place({city:h.city,region_code:h.region_code,region:h.region,country:h.country}))+'</b><br>'+
      h.c+' views · '+h.v+' visitor'+(h.v===1?'':'s')+'<br><span style="color:#666">last '+ago(h.last_ts)+
      (h.geo_conf!=='exact'?' · '+h.geo_conf+' accuracy':'')+'</span>';
  } else t.style.display='none';
});
cv.addEventListener('mouseleave', function(){ el('tip').style.display='none'; });
cv.addEventListener('click', function(e){
  if(dragged) return;
  var r=cv.getBoundingClientRect(), h=hitTest(e.clientX-r.left, e.clientY-r.top);
  if(h){ state.city=h.city||''; state.country=h.country||''; load(); }
});
cv.addEventListener('wheel', function(e){
  e.preventDefault();
  var r=cv.getBoundingClientRect(), mx=e.clientX-r.left, my=e.clientY-r.top;
  var wx=(mx-cv.clientWidth/2)/view.z+view.cx, wy=(my-cv.clientHeight/2)/view.z+view.cy;
  var z2 = view.z * (e.deltaY<0?1.25:0.8);
  z2 = Math.max(minZ||cv.clientWidth*0.5, Math.min(150000, z2));
  view.z=z2;
  view.cx = wx-(mx-cv.clientWidth/2)/z2; view.cy = wy-(my-cv.clientHeight/2)/z2;
  drawMap();
}, {passive:false});
function zoomBy(f){
  view.z=Math.max(minZ||cv.clientWidth*0.5, Math.min(150000, view.z*f)); drawMap();
}
el('zin').onclick=function(){ zoomBy(1.6); };
el('zout').onclick=function(){ zoomBy(0.625); };
el('fit').onclick=fitMap;

/* ── histogram + brush ────────────────────────────────── */
var hc = el('hist'), hctx = hc.getContext('2d'), brush=null, brushing=false;
// GROUP BY only emits buckets that have traffic. Re-insert the silent ones so
// the x-axis is time-proportional and a quiet stretch reads as quiet.
function fillGaps(b){
  if(b.length<2) return b;
  var out=[], k=b[0].k, byKey={}, guard=0;
  b.forEach(function(x){ byKey[x.k]=x.c; });
  var last=b[b.length-1].k;
  while(guard++ < 4000){
    out.push({k:k, c:byKey[k]||0});
    if(k===last) break;
    var nk=nextKey(k);
    if(nk===k) break;
    k=nk;
  }
  return out;
}
function drawHist(){
  var W=hc.clientWidth, H=hc.clientHeight;
  hctx.clearRect(0,0,W,H);
  var b=data.hist;
  if(!b.length) return;
  var max=1; for(var i=0;i<b.length;i++) if(b[i].c>max) max=b[i].c;
  var bw = W/b.length;
  for(var j=0;j<b.length;j++){
    var h=Math.max(1,(b[j].c/max)*(H-10));
    var inB = brush && j>=Math.min(brush[0],brush[1]) && j<=Math.max(brush[0],brush[1]);
    hctx.fillStyle = inB?'#FF6200':'#3A3A3A';
    hctx.fillRect(j*bw+0.5, H-h-2, Math.max(1,bw-1), h);
  }
  hctx.fillStyle='#666'; hctx.font='9px Geist Mono, monospace';
  hctx.fillText(b[0].k, 3, 9);
  var lastLbl=b[b.length-1].k;
  hctx.fillText(lastLbl, W-hctx.measureText(lastLbl).width-3, 9);
}
function bucketIdx(e){
  var r=hc.getBoundingClientRect();
  return Math.max(0, Math.min(data.hist.length-1, Math.floor((e.clientX-r.left)/(hc.clientWidth/data.hist.length))));
}
var brushHist=null;
hc.addEventListener('mousedown', function(e){ if(!data.hist.length) return; brushing=true; brushHist=data.hist; brush=[bucketIdx(e),bucketIdx(e)]; drawHist(); });
hc.addEventListener('mousemove', function(e){ if(brushing){ brush[1]=bucketIdx(e); drawHist(); } });
window.addEventListener('mouseup', function(){
  if(!brushing) return;
  brushing=false;
  var h2=brushHist||data.hist; brushHist=null;
  if(!h2||!h2.length){ brush=null; drawHist(); return; }
  var a=Math.min(brush[0],brush[1]), b2=Math.max(brush[0],brush[1]);
  a=Math.min(a,h2.length-1); b2=Math.min(b2,h2.length-1);
  var ka=h2[a].k, kb=h2[b2].k;
  state.from = nyStart(ka); state.to = nyEnd(kb); state.span=null;
  el('clearbrush').style.display='';
  document.querySelectorAll('[data-span]').forEach(function(x){ x.classList.remove('on'); });
  load();
});
// Range boundaries are New York days, matching how the Worker bucketed them.
function nyOffsetMs(d){
  var s = new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',timeZoneName:'longOffset'}).format(d);
  var m = /GMT([+-])(\d{2}):(\d{2})/.exec(s);
  if(!m) return -5*3600000;
  return (m[1]==='-'?-1:1)*((+m[2])*3600000+(+m[3])*60000);
}
function nyStart(k){
  var base = Date.parse((k.indexOf('T')>0?k+':00:00':k+'T00:00:00')+'Z');
  return base - nyOffsetMs(new Date(base));
}
// Calendar arithmetic, not fixed milliseconds: Nov 1 in New York is 25 hours
// long, so adding 86400000 would cut the last hour off the selection.
function nextKey(k){
  if(k.indexOf('T')>0){
    var d=new Date(Date.parse(k+':00:00Z')); d.setUTCHours(d.getUTCHours()+1);
    return d.toISOString().slice(0,13).replace('T','T');
  }
  var d2=new Date(Date.parse(k+'T00:00:00Z')); d2.setUTCDate(d2.getUTCDate()+1);
  return d2.toISOString().slice(0,10);
}
function nyEnd(k){ return nyStart(nextKey(k)) - 1; }
el('clearbrush').onclick=function(){
  brush=null; state.from=null; state.to=null; state.span=7;
  el('clearbrush').style.display='none';
  document.querySelectorAll('[data-span]').forEach(function(x){ x.classList.toggle('on', x.dataset.span==='7'); });
  load();
};

/* ── filters ──────────────────────────────────────────── */
function setFilter(k,v){ state[k]= (state[k]===v?'':v); load(); }
function renderChips(){
  var c=el('chips'); c.innerHTML='';
  var active=[['path',state.path],['city',state.city],['country',state.country],['vid',state.vid],['q',state.q]];
  active.forEach(function(p){
    if(!p[1]) return;
    var d=document.createElement('span'); d.className='chip';
    d.appendChild(document.createTextNode(p[0]+': '+p[1]));
    var x=document.createElement('span'); x.textContent='✕';
    x.onclick=function(){ state[p[0]]=''; if(p[0]==='q') el('q').value=''; load(); };
    d.appendChild(x); c.appendChild(d);
  });
}
document.querySelectorAll('[data-span]').forEach(function(b){
  b.onclick=function(){
    document.querySelectorAll('[data-span]').forEach(function(x){ x.classList.remove('on'); });
    b.classList.add('on'); state.span=+b.dataset.span; state.from=null; state.to=null;
    brush=null; el('clearbrush').style.display='none'; load();
  };
});
var qt;
el('q').oninput=function(){ clearTimeout(qt); qt=setTimeout(function(){ state.q=el('q').value.trim(); load(); }, 350); };
el('fpath').onchange=function(){ state.path=el('fpath').value; load(); };
el('fplace').onchange=function(){
  var v=el('fplace').value;
  if(!v){ state.city=''; state.country=''; }
  else { var p=v.split('|'); state.country=p[0]; state.city=p[1]||''; }
  load();
};
el('tbots').onclick=function(){ state.bots=state.bots?0:1; el('tbots').textContent='BOTS: '+(state.bots?'SHOWN':'HIDDEN'); el('tbots').classList.toggle('on',!!state.bots); load(); };
el('tself').onclick=function(){ state.self=state.self?0:1; el('tself').textContent='MINE: '+(state.self?'SHOWN':'HIDDEN'); el('tself').classList.toggle('on',!!state.self); load(); };
el('refresh').onclick=load;
el('autobtn').onclick=function(){
  if(timer){ clearInterval(timer); timer=null; el('autobtn').classList.remove('on'); el('autobtn').textContent='AUTO 60s'; }
  else { timer=setInterval(load, autoMs); el('autobtn').classList.add('on'); el('autobtn').textContent='AUTO ON'; }
};
document.querySelectorAll('.rail-item').forEach(function(b){
  b.onclick=function(){
    document.querySelectorAll('.rail-item').forEach(function(x){ x.classList.remove('active'); });
    b.classList.add('active'); state.view=b.dataset.view;
    document.querySelectorAll('.view').forEach(function(v){ v.classList.remove('on'); });
    el('v-'+state.view).classList.add('on');
    load();
  };
});
el('sx').onclick=function(){ el('sheet').classList.remove('on'); };
el('sheet').onclick=function(e){ if(e.target===el('sheet')) el('sheet').classList.remove('on'); };

/* ── renderers ────────────────────────────────────────── */
function renderStats(s){
  if(!s || s.error || typeof s.views !== 'number'){
    el('stats').innerHTML='';
    el('hage').textContent = s && s.error ? 'API ERROR' : 'NO RESPONSE';
    el('hdot').className='dot bad';
    return;
  }
  var items=[
    ['views', s.views, 0], ['visitors', s.visitors, 1],
    ['latest day', s.today, 0],
    ['top page', s.top_path? s.top_path+' ('+s.top_path_c+')' : '—', 0],
    ['top place', s.top_city? s.top_city+' ('+s.top_city_c+')' : '—', 0]
  ];
  el('stats').innerHTML='';
  items.forEach(function(it){
    var d=document.createElement('div'); d.className='stat'+(it[2]?' accent':'');
    var n=document.createElement('div'); n.className='stat-n';
    n.textContent = String(it[1]); n.style.fontSize = String(it[1]).length>12?'13px':'22px';
    var l=document.createElement('div'); l.className='stat-l'; l.textContent=it[0];
    d.appendChild(n); d.appendChild(l); el('stats').appendChild(d);
  });
  var age = s.last_event? ago(s.last_event) : 'never';
  el('hage').textContent='LAST EVENT: '+age;
  var d2=el('hdot'); d2.className='dot '+(!s.last_event?'bad':(Date.now()-s.last_event<86400000?'ok':'warn'));
  if(s.errors) { el('hage').textContent += ' · '+s.errors+' WRITE ERRORS'; d2.className='dot bad'; }
}
function renderPlaces(){
  var w=el('plist'); w.innerHTML='';
  if(!data.places.length){ w.innerHTML='<div class="note" style="padding:10px">no located visits in this range</div>'; return; }
  data.places.slice(0,60).forEach(function(p){
    var d=document.createElement('div'); d.className='prow'+((state.city&&p.city===state.city)?' sel':'');
    var a=document.createElement('div'); a.textContent=flag(p.country)+place(p);
    var b=document.createElement('b'); b.textContent=p.c;
    d.appendChild(a); d.appendChild(b);
    d.onclick=function(){
      if(state.city===p.city){ state.city=''; state.country=''; }
      else { state.city=p.city||''; state.country=p.country||''; }
      load();
    };
    w.appendChild(d);
  });
}
var COLS=[['ts','when'],['path','endpoint'],['event_type','event'],['city','location'],
          ['as_org','network'],['ip','ip'],['browser','client'],['ms','dwell']];
function renderTable(){
  var w=el('tblwrap');
  if(!data.rows.length){
    w.innerHTML='<div class="empty"><b>No events in this range.</b>'+
      (data.summary&&data.summary.last_event? 'Widen the time span, or clear the filters.' :
       'Nothing has ever been recorded. Open HEALTH and send a test event to check the pipeline end to end.')+'</div>';
    return;
  }
  var t=document.createElement('table'); t.className='tbl';
  var hr=document.createElement('tr');
  COLS.forEach(function(c){
    var th=document.createElement('th'); th.className='s'+(state.sort===c[0]?' act':'');
    th.textContent=c[1]+(state.sort===c[0]?(state.dir==='desc'?' ↓':' ↑'):'');
    th.onclick=function(){
      if(state.sort===c[0]) state.dir = state.dir==='desc'?'asc':'desc';
      else { state.sort=c[0]; state.dir='desc'; }
      load();
    };
    hr.appendChild(th);
  });
  var thead=document.createElement('thead'); thead.appendChild(hr); t.appendChild(thead);
  var tb=document.createElement('tbody');
  data.rows.forEach(function(r){
    var tr=document.createElement('tr');
    // when
    var w1=document.createElement('td'); w1.className='mono';
    w1.textContent=ago(r.ts); w1.title=NYFULL.format(new Date(r.ts))+' (New York)';
    tr.appendChild(w1);
    // endpoint
    var p=document.createElement('td');
    var a=document.createElement('a');
    a.href=siteUrl(r.path_raw||r.path); a.target='_blank'; a.rel='noreferrer';
    a.textContent=r.path;
    var f=document.createElement('span'); f.className='cell'; f.textContent=' ⋯';
    f.title='filter to this endpoint'; f.onclick=function(){ setFilter('path', r.path); };
    p.appendChild(a); p.appendChild(f);
    if(r.title){ var ti=document.createElement('div'); ti.className='mono'; ti.style.fontSize='10px';
      ti.textContent=r.title.slice(0,60); p.appendChild(ti); }
    tr.appendChild(p);
    // event
    var ev=document.createElement('td');
    var lbl={pv:'view',end:'left',vplay:'▶ play',vprog:'watch',vdone:'✓ finished',test:'test'}[r.event_type]||r.event_type;
    var sp=document.createElement('span');
    sp.className='tag '+(r.event_type==='vdone'?'done':'ev');
    sp.textContent=lbl+(r.event_type==='vprog'&&r.value!=null?' '+r.value+'%':'');
    ev.appendChild(sp);
    if(r.target){ var tg=document.createElement('div'); tg.className='mono'; tg.style.fontSize='10px'; tg.textContent=r.target; ev.appendChild(tg); }
    tr.appendChild(ev);
    // location
    var loc=document.createElement('td');
    var ls=document.createElement('span'); ls.className='cell';
    ls.textContent=flag(r.country)+place(r);
    ls.onclick=function(){ state.city=r.city||''; state.country=r.country||''; load(); };
    loc.appendChild(ls);
    if(r.geo_conf&&r.geo_conf!=='exact'){
      var gc=document.createElement('div'); gc.className='mono'; gc.style.fontSize='10px';
      gc.textContent=r.geo_conf==='unknown'?'location unreliable':r.geo_conf+' accuracy';
      loc.appendChild(gc);
    }
    tr.appendChild(loc);
    // network
    var nw=document.createElement('td');
    var ns=document.createElement('span'); ns.className='cell mono';
    ns.textContent=(r.as_org||'—').slice(0,28);
    ns.onclick=function(){ state.q=r.as_org||''; el('q').value=state.q; load(); };
    nw.appendChild(ns);
    if(r.net_kind){ var nk=document.createElement('span'); nk.className='tag net'; nk.style.marginLeft='4px';
      nk.textContent={dc:'datacenter',vpn:'vpn',relay:'relay',tor:'tor'}[r.net_kind]||r.net_kind; nw.appendChild(nk); }
    tr.appendChild(nw);
    // ip
    tr.appendChild(td(r.ip, 'mono'));
    // client + visitor chip
    var cl=document.createElement('td');
    var chip=document.createElement('span'); chip.className='vchip'; chip.style.background=vcolor(r.vid);
    chip.title='visitor '+(r.vid||'unknown')+' — click for their full history';
    chip.style.cursor='pointer'; chip.onclick=function(){ openVisitor(r.vid); };
    cl.appendChild(chip);
    cl.appendChild(document.createTextNode((r.label? r.label+' · ':'')+[r.browser,r.os].filter(Boolean).join('/')));
    if(r.is_bot){ var bt=document.createElement('span'); bt.className='tag bot'; bt.style.marginLeft='4px'; bt.textContent=r.bot_name||'bot'; cl.appendChild(bt); }
    if(r.is_self){ var sf=document.createElement('span'); sf.className='tag self'; sf.style.marginLeft='4px'; sf.textContent='you'; cl.appendChild(sf); }
    if(!r.storage_ok){ var nsx=document.createElement('span'); nsx.className='tag bot'; nsx.style.marginLeft='4px';
      nsx.textContent='no storage'; nsx.title='This browser blocks storage, so it cannot be recognised on a return visit.'; cl.appendChild(nsx); }
    tr.appendChild(cl);
    // dwell
    tr.appendChild(td(r.ms!=null? Math.round(r.ms/1000)+'s':'—','mono'));
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  w.innerHTML=''; w.appendChild(t);
  var note=document.createElement('div'); note.className='note'; note.style.marginTop='10px';
  note.textContent='Showing the first '+data.rows.length+' events for this sort and filter, out of however many match. Sorting and filtering are applied across the whole database, not just these rows.';
  w.appendChild(note);
}
function openVisitor(vid){
  if(!vid) return;
  el('sheet').classList.add('on');
  el('sheetbody').innerHTML='<div class="note">loading…</div>';
  fetch(D+'/api/visitor?vid='+encodeURIComponent(vid)).then(function(r){return r.json();}).then(function(d){
    if(!d || d.error){ el('sheetbody').innerHTML='<div class="note">Could not load this visitor.</div>'; return; }
    var v=d.visitor||{}, b=el('sheetbody');
    b.innerHTML='';
    var h=document.createElement('h2');
    var hc=document.createElement('span'); hc.className='vchip'; hc.style.background=vcolor(vid);
    h.appendChild(hc);
    // textContent, not innerHTML: the label is written by an unauthenticated
    // public POST and must never be parsed as markup.
    h.appendChild(document.createTextNode(v.label || ('Visitor '+String(vid).slice(0,8))));
    b.appendChild(h);
    var meta=document.createElement('div'); meta.className='note'; meta.style.marginBottom='10px';
    meta.textContent=(v.hits||0)+' page views · first seen '+ago(v.first_seen)+' · last '+ago(v.last_seen)+
      ' · '+(v.last_city||'unknown')+' · '+(v.last_as_org||'')+' · '+(v.last_ip||'');
    b.appendChild(meta);
    var nm=document.createElement('div'); nm.style.marginBottom='12px';
    var inp=document.createElement('input'); inp.placeholder='name this visitor (e.g. Esther)';
    inp.value=v.label||''; inp.style.cssText='background:#1E1E1E;border:1px solid #2A2A2A;color:#F0F0F0;padding:5px 8px;font-family:inherit;border-radius:2px';
    var sv=document.createElement('button'); sv.className='btn'; sv.textContent='SAVE'; sv.style.marginLeft='6px';
    sv.onclick=function(){
      fetch(D+'/api/label',{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({vid:vid,label:inp.value.trim()||null})}).then(function(){ load(); sv.textContent='SAVED'; });
    };
    var me=document.createElement('button'); me.className='btn'; me.textContent=v.is_self?'NOT ME':'THIS IS ME'; me.style.marginLeft='6px';
    me.onclick=function(){
      fetch(D+'/api/mark-self',{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({vid:vid,is_self:!v.is_self})}).then(function(){ el('sheet').classList.remove('on'); load(); });
    };
    nm.appendChild(inp); nm.appendChild(sv); nm.appendChild(me); b.appendChild(nm);
    var t=document.createElement('table'); t.className='tbl';
    (d.events||[]).forEach(function(e){
      var tr=document.createElement('tr');
      tr.appendChild(td(ago(e.ts),'mono'));
      tr.appendChild(td(e.path));
      tr.appendChild(td({pv:'view',end:'left',vplay:'▶ play',vprog:(e.value||0)+'% watched',vdone:'✓ finished'}[e.event_type]||e.event_type));
      tr.appendChild(td(e.ms!=null?Math.round(e.ms/1000)+'s':''));
      tr.appendChild(td(place(e),'mono'));
      t.appendChild(tr);
    });
    b.appendChild(t);
  }).catch(function(){
    el('sheetbody').innerHTML='<div class="note">Could not load this visitor. The API did not respond.</div>';
  });
}
function renderWatch(){
  var w=el('watchwrap');
  Promise.all([get('videos'), get('watchers')]).then(function(res){
    var vids=(res[0]&&res[0].videos)||[], wat=(res[1]&&res[1].watchers)||[];
    w.innerHTML='';
    if(!vids.length){
      w.innerHTML='<div class="empty"><b>No video plays recorded yet.</b>Any &lt;video&gt; on any page is tracked automatically — nothing to configure. This fills in once someone presses play.</div>';
      return;
    }
    vids.forEach(function(v){
      var d=document.createElement('div'); d.className='panel';
      var h=document.createElement('h2'); h.textContent=v.target||v.path; d.appendChild(h);
      var m=document.createElement('div'); m.className='note';
      var rate = v.plays? Math.round(100*v.completions/v.plays):0;
      m.textContent=v.plays+' plays · '+v.viewers+' distinct viewers · '+v.completions+' finished ('+rate+'%) · last '+ago(v.last_ts);
      d.appendChild(m);
      var bar=document.createElement('div'); bar.className='bar';
      var fi=document.createElement('i'); fi.style.width=rate+'%'; bar.appendChild(fi); d.appendChild(bar);
      var t=document.createElement('table'); t.className='tbl'; t.style.marginTop='10px';
      wat.filter(function(x){ return x.target===v.target && x.path===v.path; }).forEach(function(x){
        var tr=document.createElement('tr');
        var c=document.createElement('td');
        var ch=document.createElement('span'); ch.className='vchip'; ch.style.background=vcolor(x.vid);
        ch.style.cursor='pointer'; ch.onclick=function(){ openVisitor(x.vid); };
        c.appendChild(ch); c.appendChild(document.createTextNode(x.label||('visitor '+String(x.vid||'?').slice(0,8))));
        tr.appendChild(c);
        tr.appendChild(td((x.pct||0)+'% watched'));
        tr.appendChild(td(flag(x.country)+place(x),'mono'));
        tr.appendChild(td(x.as_org,'mono'));
        tr.appendChild(td(ago(x.last_ts),'mono'));
        t.appendChild(tr);
      });
      d.appendChild(t);
      w.appendChild(d);
    });
  });
}
function renderPeople(){
  // Uses the rows load() already fetched -- no extra query, no extra quota.
  var w=el('peoplewrap');
  var seen={}, list=[];
  data.rows.forEach(function(r){
    if(!r.vid||seen[r.vid]) return;
    seen[r.vid]=1; list.push(r);
  });
  w.innerHTML='';
  if(!list.length){
    var e=document.createElement('div'); e.className='empty';
    var b2=document.createElement('b'); b2.textContent='No visitors in this range.';
    e.appendChild(b2); w.appendChild(e); return;
  }
  var t=document.createElement('table'); t.className='tbl';
  list.forEach(function(r){
    var tr=document.createElement('tr');
    var c=document.createElement('td');
    var ch=document.createElement('span'); ch.className='vchip'; ch.style.background=vcolor(r.vid);
    ch.style.cursor='pointer'; ch.onclick=function(){ openVisitor(r.vid); };
    c.appendChild(ch);
    var nm=document.createElement('span'); nm.className='cell';
    nm.textContent=r.label||('visitor '+String(r.vid).slice(0,8));
    nm.onclick=function(){ openVisitor(r.vid); };
    c.appendChild(nm);
    if(!r.storage_ok){
      var ns=document.createElement('span'); ns.className='tag bot'; ns.style.marginLeft='4px';
      ns.textContent='no storage'; ns.title='This browser blocks storage, so it looks like a new person on every visit.';
      c.appendChild(ns);
    }
    tr.appendChild(c);
    tr.appendChild(td(flag(r.country)+place(r),'mono'));
    tr.appendChild(td(r.as_org,'mono'));
    tr.appendChild(td(r.ip,'mono'));
    tr.appendChild(td([r.browser,r.os,r.device].filter(Boolean).join(' / '),'mono'));
    tr.appendChild(td(ago(r.ts),'mono'));
    t.appendChild(tr);
  });
  w.appendChild(t);
  var n=document.createElement('div'); n.className='note'; n.style.marginTop='10px';
  n.textContent='Distinct visitors among the last '+data.rows.length+' events. Click a name to open their history, or to label them.';
  w.appendChild(n);
}

function renderHealth(){
  var w=el('healthwrap');
  w.innerHTML='';
  var p=document.createElement('div'); p.className='panel';
  p.innerHTML='<h2>PIPELINE</h2>';
  var s=data.summary||{};
  var note=document.createElement('div'); note.className='note';
  note.innerHTML='Last event recorded: <b style="color:#FF6200">'+(s.last_event?ago(s.last_event):'never')+'</b><br>'+
    'Write errors logged: <b style="color:'+(s.errors?'#FF4444':'#00FF88')+'">'+(s.errors||0)+'</b>'+
    (s.error_last? ' (last '+ago(s.error_last)+')':'')+'<br><br>'+
    'An empty feed means one of two things: nobody visited, or the pipeline is broken. '+
    'The age above tells them apart. Send a test event to prove the round trip works.';
  p.appendChild(note);
  var row=document.createElement('div'); row.style.marginTop='10px';
  var b1=document.createElement('button'); b1.className='btn'; b1.textContent='SEND TEST EVENT';
  b1.onclick=function(){
    b1.textContent='SENDING…';
    // Posts to the REAL collector, exactly as the beacon does, so this
    // exercises the collector URL, the /s route, CORS and the D1 write.
    // Writing straight to the database would prove none of those.
    var collector;
    try{ collector=new URL('/s', D).href; }catch(e){ b1.textContent='BAD URL'; return; }
    var payload=JSON.stringify({k:'pv',e:'test',pid:'dash-'+Date.now(),sid:'dash',vid:'dashboard-test',
      t:Date.now(),p:'/dashboard-test',h:'hoeksemaa.github.io',ti:'dashboard test event',vis:'visible'});
    fetch(collector,{method:'POST',body:payload,headers:{'Content-Type':'text/plain'}})
      .then(function(r){
        if(r.status!==204){ b1.textContent='HTTP '+r.status+' ✗'; return; }
        b1.textContent='SENT — checking…';
        setTimeout(function(){
          fetch(D+'/api/summary?env=test&bots=1&self=1').then(function(x){return x.json();}).then(function(d){
            b1.textContent = (d && d.views>0) ? 'ROUND TRIP OK ✓' : 'ACCEPTED BUT NOT STORED ✗';
            load();
          }).catch(function(){ b1.textContent='CHECK FAILED'; });
        }, 2500);
      })
      .catch(function(){ b1.textContent='COLLECTOR UNREACHABLE ✗'; });
  };
  var b2=document.createElement('button'); b2.className='btn'; b2.textContent='DELETE TEST EVENTS'; b2.style.marginLeft='6px';
  b2.onclick=function(){ fetch(D+'/api/purge-test',{method:'POST'}).then(function(r){return r.json();}).then(function(d){ b2.textContent='DELETED '+d.deleted; load(); }); };
  row.appendChild(b1); row.appendChild(b2); p.appendChild(row);
  w.appendChild(p);

  fetch(D+'/api/errors').then(function(r){return r.json();}).then(function(d){
    if(!d||!d.errors||!d.errors.length) return;
    var e=document.createElement('div'); e.className='panel';
    e.innerHTML='<h2 style="color:#FF4444">WRITE ERRORS</h2>';
    var t=document.createElement('table'); t.className='tbl';
    d.errors.forEach(function(x){
      var tr=document.createElement('tr');
      tr.appendChild(td(ago(x.ts),'mono')); tr.appendChild(td(x.msg));
      t.appendChild(tr);
    });
    e.appendChild(t); w.appendChild(e);
  }).catch(function(){});

  var c=document.createElement('div'); c.className='panel';
  c.innerHTML='<h2>WHAT THESE NUMBERS CANNOT TELL YOU</h2><div class="note">'+
    '· Locations come from the IP address and are accurate to a city centre at best. On a phone network the true location can be 50+ miles away.<br>'+
    '· Apple iCloud Private Relay hides the real address for many Safari and iPhone visitors. Those rows show a shared relay IP, tagged <span class="tag net">relay</span>.<br>'+
    '· A visitor using a VPN shows the VPN exit location, not their own.<br>'+
    '· Some visitors with ad blockers are never recorded at all. There is no way to count them from inside this system.<br>'+
    '· A visitor is remembered by a browser ID. Clearing site data, or a different browser or device, makes the same person look new. Safari drops it after 7 quiet days.<br>'+
    '· Most link previews (Slack, Discord, WhatsApp, Telegram, Facebook, LinkedIn) fetch the page without running JavaScript, so they never reach this tracker at all.<br>'+
    '· Apple\'s Applebot, Googlebot and Bingbot DO run JavaScript and do arrive. They are matched by name and tagged as bots, and hidden unless you turn on BOTS.<br>'+
    '· A page opened in a background tab, or preloaded by the browser before anyone clicked, is recorded but marked so it is not mistaken for someone reading.</div>';
  w.appendChild(c);
}

/* ── load ─────────────────────────────────────────────── */
function fillFacets(f){
  if(!f) return;
  data.facets=f;
  var sp=el('fpath'), cur=state.path;
  if(sp.options.length-1 !== (f.endpoints||[]).length){
    sp.innerHTML='<option value="">all endpoints</option>';
    (f.endpoints||[]).forEach(function(e){
      var o=document.createElement('option'); o.value=e.path;
      o.textContent=e.path+' ('+e.hits+')'+(e.has_video?' ▶':'');
      sp.appendChild(o);
    });
  }
  sp.value=cur;
  var pl=el('fplace'), curp=state.country?(state.country+'|'+state.city):'';
  if(pl.options.length-1 !== (f.places||[]).length){
    pl.innerHTML='<option value="">all locations</option>';
    (f.places||[]).forEach(function(p){
      var o=document.createElement('option'); o.value=(p.country||'')+'|'+(p.city||'');
      o.textContent=flag(p.country)+[p.city,p.region,p.country].filter(Boolean).join(', ')+' ('+p.hits+')';
      pl.appendChild(o);
    });
  }
  pl.value=curp;
}
function load(){
  renderChips();
  var span = state.span===1?'hour':'day';
  Promise.all([
    get('summary'),
    get('recent',{sort:state.sort,dir:state.dir,limit:200}),
    get('places'),
    get('histogram',{by:span}),
    fetch(D+'/api/facets').then(function(r){return r.json();}).catch(function(){return null;})
  ]).then(function(r){
    data.summary=r[0];
    data.rows=(r[1]&&r[1].rows)||[];
    data.places=(r[2]&&r[2].places)||[];
    data.no_geo=(r[2]&&r[2].no_geo)||0;
    data.hist=fillGaps((r[3]&&r[3].buckets)||[]);
    fillFacets(r[4]);
    renderStats(data.summary);
    renderPlaces();
    drawMap();
    drawHist();
    var liveN=0, cut=Date.now()-300000;
    data.rows.forEach(function(x){ if(x.ts>cut&&x.event_type==='pv') liveN++; });
    el('live').textContent=liveN? liveN+' ON SITE (5m)' : 'quiet';
    el('ldot').className='dot '+(liveN?'ok':'');
    if(state.view==='feed') renderTable();
    else if(state.view==='watch') renderWatch();
    else if(state.view==='people') renderPeople();
    else renderHealth();
  });
}
function resize(){ sizeCanvas(cv); sizeCanvas(hc); if(!view.z) fitMap(); else drawMap(); drawHist(); }
window.addEventListener('resize', resize);
resize(); fitMap(); load();
})();
