let playCtx = null, pendingResume = null;   // سياق الحلقة الجارية + وقت الاستئناف
const DEFAULT_ADDON = 'https://anime-kitsu.strem.fun';
const DEFAULT_STREAM = 'https://torrentio.strem.fun/providers=nyaasi,tokyotosho,anidex,horriblesubs'; // إضافة المصادر (Torrentio)
const errMsg = (e) => String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const $ = (s) => document.querySelector(s);
const svg = (b, f) => `<svg class="i${f ? ' f' : ''}" viewBox="0 0 24 24">${b}</svg>`;
const HP = '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>';
const SP = '<polygon points="3 9 8 9 13 5 13 19 8 15 3 15"/>';
const I = {
  play: svg('<polygon points="6 4 20 12 6 20"/>', 1),
  pause: svg('<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>', 1),
  next: svg('<polygon points="5 4 15 12 5 20"/><line x1="19" y1="5" x2="19" y2="19"/>', 1),
  vol: svg(SP + '<path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>'),
  mute: svg(SP + '<line x1="17" y1="9" x2="22" y2="15"/><line x1="22" y1="9" x2="17" y2="15"/>'),
  full: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  back: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  sync: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  cc: svg('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 10.5a2 2 0 1 0 0 3M16 10.5a2 2 0 1 0 0 3"/>'),
  heart: svg(HP), heartF: svg(HP, 1),
  trash: svg('<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/>'),
  hd: svg('<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M6.5 9v6M6.5 12h3M9.5 9v6M13 9h1.2a3 3 0 0 1 0 6H13z"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>')
};
const view = $('#view');
const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem('way:' + k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('way:' + k, JSON.stringify(v)); } catch {} if ((k === 'fav' || k === 'hist') && window.syncDirty) window.syncDirty(); }
};
const norm = (u) => (u || '').trim().replace(/\/manifest\.json$/i, '').replace(/\/$/, '');
let catalogAddon = norm(store.get('catalogAddon', DEFAULT_ADDON));
let streamAddon = norm(store.get('streamAddon', '')) || DEFAULT_STREAM;
let subAddon = norm(store.get('subAddon', 'https://opensubtitles-v3.strem.io'));
let translateOn = store.get('translateOn', true);
let notifyOn = store.get('notifyOn', true);
const pushBg = () => window.api.bg && window.api.bg({ keep: store.get('bgOn', true), autostart: store.get('autoStart', false) }).catch(() => {});
let cur = { type: '', vid: '' };
let catalogs = [];

const get = (base, path) => window.api.get(base + path);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const say = (t) => (view.innerHTML = `<p class="mute">${esc(t)}</p>`);
const setNav = (id) => { dlViewOn = (id === 'nDl'); document.querySelectorAll('header [id^="n"]').forEach(b => b.classList.toggle('on', b.id === id)); $('.wrap').classList.remove('hh'); $('header').classList.remove('solid'); };

async function init() {
  say('جارٍ التحميل…');
  try {
    const manifest = await get(catalogAddon, '/manifest.json');
    catalogs = manifest.catalogs.filter(c => !(c.extra || []).some(e => e.isRequired && e.name !== 'search'));
    $('#catalog').innerHTML = catalogs.map((c, i) => `<option value="${i}">${esc(c.name || c.id)}</option>`).join('');
    loadCatalog();
  } catch (e) { say('تعذّر الاتصال بالإضافة: ' + errMsg(e)); }
}

async function loadCatalog(search) {
  setNav('nHome');
  const c = catalogs[$('#catalog').value];
  if (!c) return;
  say('جارٍ التحميل…');
  try {
    const extra = search ? `/search=${encodeURIComponent(search)}` : '';
    const data = await get(catalogAddon, `/catalog/${c.type}/${c.id}${extra}.json`);
    const metas = data.metas || [];
    if (!metas.length) return say('لا توجد نتائج.');
    const hero = !search && metas[0];
    view.innerHTML = (hero ? `<div class="hero" tabindex="0" data-id="${esc(hero.id)}" data-type="${esc(hero.type || c.type)}" style="background-image:url('${esc(hero.background || hero.poster)}')"><div><h2>${esc(hero.name)}</h2><p>${esc(hero.description || '')}</p></div></div>` : '')
      + `<h3>${search ? 'نتائج: ' + esc(search) : esc(c.name || c.id)}</h3>` + grid(hero ? metas.slice(1) : metas, c.type);
    bindCards();
  } catch (e) { say('خطأ: ' + errMsg(e)); }
}

function grid(metas, type) {
  return '<div class="grid">' + metas.map(m =>
    `<div class="card" tabindex="0" data-id="${esc(m.id)}" data-type="${esc(m.type || type)}">
       <img loading="lazy" src="${esc(m.poster || phSvg(m.name))}"${m.poster ? '' : ' data-need="1"'} alt=""><p>${esc(m.name)}</p></div>`).join('') + '</div>';
}
function bindCards() {
  view.querySelectorAll('.card,.hero').forEach(el => {
    const open = () => openMeta(el.dataset.type, el.dataset.id);
    el.onclick = open; el.onkeydown = (e) => e.key === 'Enter' && open();
  });
}

async function openMeta(type, id) {
  say('جارٍ التحميل…');
  try {
    const { meta } = await get(catalogAddon, `/meta/${type}/${encodeURIComponent(id)}.json`);
    const vids = meta.videos && meta.videos.length ? meta.videos : [{ id: meta.id, title: 'مشاهدة' }];
    const seen = new Set(store.get('seen', {})[meta.id] || []);
    const isFav = () => store.get('fav', []).some(f => f.id === meta.id);
    view.innerHTML = `<div class="detail">
      <img src="${esc(meta.poster)}" alt="">
      <div><h2>${esc(meta.name)}</h2>
        <div class="row"><button class="primary" id="fav"></button></div>
        <p class="mute" id="desc">${esc(meta.description)}</p>
        <h3>الحلقات</h3>
        <div class="eps">${vids.map((v, i) => `<button data-i="${i}" class="${seen.has(v.id) ? 'seen' : ''}">${esc(v.episode ?? v.title ?? i + 1)}</button>`).join('')}</div>
        <div id="out"></div></div></div>`;
    if (translateOn && meta.description) translateDesc(meta);
    const favBtn = $('#fav'), paint = () => (favBtn.innerHTML = isFav() ? I.heartF + ' في المفضلة' : I.heart + ' أضف للمفضلة');
    paint();
    favBtn.onclick = () => {
      let f = store.get('fav', []);
      f = isFav() ? f.filter(x => x.id !== meta.id) : [{ id: meta.id, type, name: meta.name, poster: meta.poster }, ...f];
      store.set('fav', f); paint();
    };
    view.querySelectorAll('.eps button').forEach(b => b.onclick = () => {
      view.querySelectorAll('.eps button').forEach(x => x.classList.remove('on'));
      b.classList.add('on'); b.classList.add('seen');
      const v = vids[b.dataset.i];
      const s = store.get('seen', {}); s[meta.id] = [...new Set([...(s[meta.id] || []), v.id])]; store.set('seen', s);
      let h = store.get('hist', []).filter(x => x.id !== meta.id);
      store.set('hist', [{ id: meta.id, type, name: meta.name, poster: meta.poster }, ...h].slice(0, 40));
      loadStreams(type, v.id);
    });
  } catch (e) { say('خطأ: ' + errMsg(e)); }
}

async function translateDesc(meta) {
  const cache = store.get('tr', {});
  try {
    if (!cache[meta.id]) {
      cache[meta.id] = await window.api.translate(meta.description);
      const keys = Object.keys(cache); if (keys.length > 150) delete cache[keys[0]];
      store.set('tr', cache);
    }
    const el = $('#desc'); if (el) el.textContent = cache[meta.id];
  } catch (e) {
    const el = $('#desc'); if (el) el.insertAdjacentHTML('afterend', `<p class="mute" style="font-size:12px">تعذّرت الترجمة: ${esc(errMsg(e))}</p>`);
  }
}

async function loadStreams(type, vid) {
  const out = $('#out');
  cur = { type, vid };
  out.innerHTML = '<p class="mute">جارٍ البحث عن مصادر…</p>';
  try {
    const { streams = [] } = await get(streamAddon, `/stream/${type}/${encodeURIComponent(vid)}.json`);
    if (!streams.length) return (out.innerHTML = '<p class="mute">لا توجد مصادر لهذه الحلقة. أضف رابط إضافة ستريم من الإعدادات.</p>');
    out.innerHTML = '<div class="streams">' + streams.map((s, i) =>
      `<button data-i="${i}">${I.play} سيرفر ${i + 1}</button>`).join('') + '</div><div id="player"></div>';
    out.querySelectorAll('.streams button').forEach(b => b.onclick = () => play(streams[b.dataset.i]));
  } catch (e) { out.innerHTML = `<p class="mute">${/404/.test(errMsg(e)) ? 'إضافة المصادر لا تتعرّف على هذه الحلقة، أو الرابط في الإعدادات خاطئ.' : 'خطأ: ' + esc(errMsg(e))}</p>`; }
}

const srtToVtt = (t) => 'WEBVTT\n\n' + t.replace(/\r/g, '').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');

async function addArabicSubs(v) {
  if (!subAddon) return;
  try {
    const { subtitles = [] } = await get(subAddon, `/subtitles/${cur.type}/${encodeURIComponent(cur.vid)}.json`);
    const sub = subtitles.find(x => /^(ara|ar)/i.test(x.lang || ''));
    if (!sub) return;
    const txt = await window.api.text(sub.url);
    const tr = document.createElement('track');
    tr.kind = 'subtitles'; tr.label = 'العربية'; tr.srclang = 'ar'; tr.default = true;
    tr.src = URL.createObjectURL(new Blob([txt.trim().startsWith('WEBVTT') ? txt : srtToVtt(txt)], { type: 'text/vtt' }));
    v.appendChild(tr);
  } catch {}
}

function attach(url) {
  const box = $('#player');
  box.innerHTML = '<video controls autoplay></video>';
  const v = box.firstChild;
  if (/\.m3u8|\/hls\/|master\.txt|\/playlist/i.test(url) && window.Hls && Hls.isSupported()) { const h = new Hls(); h.loadSource(url); h.attachMedia(v); }
  else v.src = url;
  v.onerror = () => box.insertAdjacentHTML('beforeend', '<p class="mute">تعذّر تشغيل هذا الملف داخل التطبيق (ربما صيغة غير مدعومة). جرّب مصدراً آخر.</p>');
  addArabicSubs(v);
}

async function play(s) {
  const box = $('#player');
  if (s.url) attach(s.url);
  else if (s.externalUrl) window.api.openExternal(s.externalUrl);
  else if (s.infoHash) {
    box.innerHTML = '<p class="mute">جارٍ الاتصال بالتورنت… قد يستغرق دقيقة.</p>';
    try { attach((await window.api.torrent({ infoHash: s.infoHash, fileIdx: s.fileIdx, sources: s.sources })).url); }
    catch (e) { box.innerHTML = `<p class="mute">فشل التورنت: ${esc(errMsg(e))}</p>`; }
  }
}

/* ===== التحميلات: تحميل الحلقات والمشاهدة بلا إنترنت ===== */
const DL_ICON = svg('<path d="M12 4v10M8 10.5l4 4 4-4"/><path d="M5 15v2.5A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5V15"/>');
const fmtSize = (n) => (n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : (n / 1048576).toFixed(0) + ' MB');
async function startDl(bt, m, num) {
  toast('جارٍ التحضير للتحميل…');
  try {
    const r = await bt.dl();
    if (!r || !r.url) return toast('تعذّر تحميل هذا السيرفر — جرّب سيرفراً آخر.');
    const res = await window.api.dl.start({ animeId: m.id, name: m.name, poster: m.poster, num: e_num(num), url: r.url, type: r.type || '' });
    toast(res && res.ok ? 'بدأ التحميل — ستجده في «التحميلات»' : 'لم يبدأ التحميل: ' + ((res && res.error) || ''));
  } catch (err) { toast('فشل التحميل: ' + errMsg(err)); }
}
const e_num = (n) => String(n);

// نافذة تأكيد مخصصة بنفس ستايل التطبيق (بدل confirm الأصلي ديال ويندوز)
function askConfirm(msg, okText = 'تأكيد', cancelText = 'إلغاء') {
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.className = 'cfov';
    ov.innerHTML = `<div class="cfbox" role="dialog" aria-modal="true"><div class="cfic">${I.trash}</div><p>${esc(msg)}</p><div class="cfact"><button class="ghostb" data-r="0">${esc(cancelText)}</button><button class="danger" data-r="1">${esc(okText)}</button></div></div>`;
    const done = (v) => { document.removeEventListener('keydown', onKey, true); ov.classList.add('out'); setTimeout(() => ov.remove(), 150); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); } else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(true); } };
    ov.addEventListener('click', (e) => { if (e.target === ov) return done(false); const b = e.target.closest('button[data-r]'); if (b) done(b.dataset.r === '1'); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(ov);
    ov.querySelector('.danger').focus();
  });
}

// ===== فحص السيرفرات: اللي ما خدمش كيتحيّد من اللائحة =====
const chkQ = []; let chkRun = 0;
function queueCheck(o, done) { chkQ.push([o, done]); pumpChecks(); }
function pumpChecks() {
  while (chkRun < 4 && chkQ.length) {
    const [o, done] = chkQ.shift(); chkRun++;
    window.api.host.check(o.chk)
      .then((x) => { o.st = x && x.ok ? 'ok' : (x && x.embed ? 'embed' : 'bad'); })
      .catch(() => { o.st = 'bad'; })
      .finally(() => { chkRun--; done(); pumpChecks(); });
  }
}
let dlViewOn = false;
function dlRow(d) {
  const busy = d.status === 'downloading';
  const sub = busy ? `جارٍ التحميل… ${d.pct || 0}%` : d.status === 'error' ? 'فشل: ' + esc(d.error || '') : d.status === 'cancelled' ? 'تم الإلغاء' : fmtSize(d.size || 0);
  return `<div class="dlitem" data-key="${esc(d.key)}"><img src="${esc(d.posterUrl || d.poster || phSvg(d.name))}"${d.posterUrl || d.poster ? '' : ' data-need="1"'} alt=""><div class="dlm"><b>${esc(d.name)}</b><span class="mute">الحلقة ${esc(d.num)} · <span class="dls">${sub}</span></span>${busy ? `<div class="dlbar"><i style="width:${d.pct || 0}%"></i></div>` : ''}</div>`
    + (busy ? `<button class="ghost" data-a="cancel">إلغاء</button>` : d.status === 'done' || d.fileUrl ? `<button class="primary" data-a="play">${I.play} شاهد</button><button class="dlx" data-a="del" title="حذف" aria-label="حذف">${I.trash}</button>` : '')
    + '</div>';
}
async function showDownloads() {
  setNav('nDl'); dlViewOn = true;
  const list = (await window.api.dl.list().catch(() => [])) || [];
  view.innerHTML = `<h3>${DL_ICON} التحميلات <span class="mute" style="font-size:13px">(تُشاهَد بدون إنترنت)</span></h3><div id="player"></div><div id="dllist">${list.length ? list.map(dlRow).join('') : '<p class="mute">لا توجد حلقات محمّلة. في صفحة الحلقة اضغط على زر التحميل بجانب السيرفر.</p>'}</div>`;
  const box = $('#dllist');
  box.onclick = async (ev) => {
    const b = ev.target.closest('button[data-a]'); if (!b) return;
    const row = b.closest('.dlitem'), key = row.dataset.key, d = list.find(x => x.key === key) || {};
    if (b.dataset.a === 'cancel') return window.api.dl.cancel(key);
    if (b.dataset.a === 'del') { if (!await askConfirm('حذف هذه الحلقة من الجهاز؟', 'حذف')) return; await window.api.dl.remove(key); return showDownloads(); }
    if (b.dataset.a === 'play' && d.fileUrl) {
      cur = { type: 'ar', vid: '' };
      playCtx = { id: d.animeId, name: d.name, poster: d.poster, num: d.num, label: 'Offline' };
      const r = resumeGet(d.animeId); if (r && r.num === d.num && r.t > 10) pendingResume = r.t;
      attach(d.fileUrl); $('#player').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };
}
if (window.api.dl) window.api.dl.onProgress((p) => {
  if (!dlViewOn || !$('#dllist')) return;
  const row = $(`.dlitem[data-key="${CSS.escape(p.key)}"]`);
  if (p.status && p.status !== 'downloading') { showDownloads(); if (p.status === 'done') toast('تم تحميل الحلقة — يمكنك مشاهدتها بدون إنترنت'); return; }
  if (!row) return showDownloads();
  const bar = row.querySelector('.dlbar i'), t = row.querySelector('.dls');
  if (bar) bar.style.width = (p.pct || 0) + '%'; if (t) t.textContent = 'جارٍ التحميل… ' + (p.pct || 0) + '%';
});
window.addEventListener('offline', () => toast('لا يوجد اتصال بالإنترنت — يمكنك المشاهدة من «التحميلات»'));

function showList(title, key, navId) {
  setNav(navId);
  const items = store.get(key, []);
  view.innerHTML = `<h3>${title}</h3>` + (items.length ? grid(items) : '<p class="mute">لا شيء هنا بعد.</p>');
  bindCards();
}

function showSettings() {
  setNav('nSet');
  view.innerHTML = `<h3>الإعدادات</h3><div class="set">
    <label class="mute">إضافة الكتالوج</label><input id="sc" dir="ltr" value="${esc(catalogAddon)}">
    <label class="mute">إضافة الستريم (اتركها فارغة لاستعمال Torrentio)</label><input id="ss" dir="ltr" value="${esc(store.get('streamAddon', ''))}">
    <label class="mute">إضافة الترجمة (Subtitles)</label><input id="sb" dir="ltr" value="${esc(subAddon)}">
    <label class="mute"><input type="checkbox" id="tr" ${translateOn ? 'checked' : ''} style="width:auto"> ترجمة وصف الأنمي إلى العربية</label>
    <label class="mute"><input type="checkbox" id="nt" ${notifyOn ? 'checked' : ''} style="width:auto"> إشعار عند نزول حلقة جديدة (للمفضلة وآخر ما شاهدته)</label>
    <label class="mute"><input type="checkbox" id="bgk" ${store.get('bgOn', true) ? 'checked' : ''} style="width:auto"> يبقى يعمل في الخلفية عند إغلاق النافذة (أيقونة في الـ tray)</label>
    <label class="mute"><input type="checkbox" id="aut" ${store.get('autoStart', false) ? 'checked' : ''} style="width:auto"> يشتغل تلقائياً مع ويندوز (بالخلفية)</label>
    <label class="mute"><input type="checkbox" id="dc" ${rpcOn() ? 'checked' : ''} style="width:auto"> إظهار ما تشاهده على Discord (Rich Presence)</label>
    <button class="primary" id="save">حفظ</button></div>`;
  $('#save').onclick = () => {
    store.set('catalogAddon', norm($('#sc').value) || DEFAULT_ADDON);
    store.set('streamAddon', norm($('#ss').value));
    store.set('subAddon', norm($('#sb').value)); store.set('translateOn', $('#tr').checked); store.set('notifyOn', $('#nt').checked); notifyOn = $('#nt').checked; store.set('bgOn', $('#bgk').checked); store.set('autoStart', $('#aut').checked); pushBg();
    store.set('discordOn', $('#dc').checked); window.api.rpc.enable($('#dc').checked); if ($('#dc').checked) rpcBrowse();
    subAddon = norm(store.get('subAddon')); translateOn = $('#tr').checked;
    catalogAddon = norm(store.get('catalogAddon')); streamAddon = norm(store.get('streamAddon')) || DEFAULT_STREAM;
    init();
  };
}

$('#nHome').onclick = () => { $('#q').value = ''; loadCatalog(); };
$('#nFav').onclick = () => showList(I.heartF + ' المفضلة', 'fav', 'nFav');
$('#nHist').onclick = () => showList(I.clock + ' آخر ما شاهدته', 'hist', 'nHist'); $('#nDl').onclick = () => showDownloads();
$('#q').onkeydown = (e) => { if (e.key === 'Enter' && e.target.value.trim()) loadCatalog(e.target.value.trim()); };

/* ===== التصميم الجديد (تُعيد تعريف الدوال القديمة) ===== */

async function init() {
  say('جارٍ التحميل…');
  try {
    const m = await get(catalogAddon, '/manifest.json');
    catalogs = m.catalogs.filter(c => !(c.extra || []).some(e => e.isRequired && e.name !== 'search'));
    loadCatalog();
  } catch (e) { say('تعذّر الاتصال بالإضافة: ' + errMsg(e)); }
}

const starSvg = (on) => svg('<polygon ' + (on ? 'fill="currentColor" ' : '') + 'points="12 3 14.9 9 21.5 9.8 16.6 14.3 17.9 21 12 17.7 6.1 21 7.4 14.3 2.5 9.8 9.1 9"/>');
I.plus = svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>');
I.playc = svg('<circle cx="12" cy="12" r="9"/><polygon fill="currentColor" points="10 8 16 12 10 16"/>');
const isFavId = (id) => store.get('fav', []).some(f => f.id === id);
const toggleFav = (o) => { const f = store.get('fav', []); store.set('fav', f.some(x => x.id === o.id) ? f.filter(x => x.id !== o.id) : [o, ...f]); };
const metaRow = (m) => {
  const r = parseFloat(m.imdbRating);
  const h = (r ? `<span class="stars">${[1, 2, 3, 4, 5].map(i => `<span class="ys">${starSvg(i <= Math.round(r / 2))}</span>`).join('')}</span><b>${r}</b>` : '') + (m.releaseInfo ? `<span>${esc(m.releaseInfo)}</span>` : '');
  return h ? `<div class="hmeta">${h}</div>` : '';
};
const cardHtml = (m, type) => `<div class="card" tabindex="0" data-id="${esc(m.id)}" data-type="${esc(m.type || type)}"><img loading="lazy" src="${esc(m.poster || phSvg(m.name))}"${m.poster ? '' : ' data-need="1"'} alt=""><p>${esc(m.name)}</p><div class="cm"><span>${esc(m.releaseInfo || '')}</span></div><div class="cm"><b class="rt">${m.imdbRating ? esc(m.imdbRating) : ''}</b><button class="star" data-id="${esc(m.id)}" data-type="${esc(m.type || type)}" data-name="${esc(m.name)}" data-poster="${esc(m.poster)}">${starSvg(isFavId(m.id))}</button></div></div>`;
function grid(metas, type) { return '<div class="grid">' + metas.map(m => cardHtml(m, type)).join('') + '</div>'; }
function bindCards() {
  view.querySelectorAll('.card,.hero').forEach(el => {
    const open = () => openMeta(el.dataset.type, el.dataset.id);
    el.onclick = open; el.onkeydown = (e) => e.key === 'Enter' && open();
  });
  view.querySelectorAll('.star').forEach(b => b.onclick = (e) => {
    e.stopPropagation(); const d = b.dataset;
    toggleFav({ id: d.id, type: d.type, name: d.name, poster: d.poster }); b.innerHTML = starSvg(isFavId(d.id));
  });
}

async function loadCatalog(search) {
  setNav('nHome'); say('جارٍ التحميل…');
  const fetchCat = async (c, s) => (await get(catalogAddon, `/catalog/${c.type}/${c.id}${s ? '/search=' + encodeURIComponent(s) : ''}.json`)).metas || [];
  try {
    if (search) {
      const m = await fetchCat(catalogs[0], search);
      view.innerHTML = `<h3>نتائج: ${esc(search)}</h3>` + (m.length ? grid(m, catalogs[0].type) : '<p class="mute">لا توجد نتائج.</p>');
      return bindCards();
    }
    const cats = catalogs.slice(0, 6), cache = {};
    cache[0] = await fetchCat(cats[0]);
    if (!cache[0].length) return say('لا توجد نتائج.');
    const h = cache[0][0];
    view.innerHTML = `<div class="hero" tabindex="0" data-id="${esc(h.id)}" data-type="${esc(h.type || cats[0].type)}" style="background-image:url('${esc(h.background || h.poster)}')"><div><h2>${esc(h.name)}</h2><p class="sub">${esc((h.genres || []).slice(0, 3).join(' · ') || h.releaseInfo || '')}</p><div class="acts"><span class="ghost">${I.playc} شاهد الآن</span><button class="ghost" id="hfav"></button></div>${metaRow(h)}</div><span class="bigplay">${I.playc}</span></div>`
      + `<div class="sec"><div class="tabs">${cats.map((c, i) => `<button data-i="${i}" class="${i ? '' : 'on'}">${esc(c.name || c.id)}</button>`).join('')}</div><div id="tabc"></div></div>`;
    $('.wrap').classList.add('hh'); view.scrollTop = 0; $('header').classList.remove('solid');
    const hp = () => ($('#hfav').innerHTML = isFavId(h.id) ? starSvg(true) + ' في المفضلة' : I.plus + ' أضف للمفضلة');
    hp();
    $('#hfav').onclick = (e) => { e.stopPropagation(); toggleFav({ id: h.id, type: h.type || cats[0].type, name: h.name, poster: h.poster }); hp(); };
    const show = async (i) => {
      const box = $('#tabc');
      try {
        if (!cache[i]) { box.innerHTML = '<p class="mute">جارٍ التحميل…</p>'; cache[i] = await fetchCat(cats[i]); }
        box.innerHTML = cache[i].length ? grid(cache[i], cats[i].type) : '<p class="mute">لا توجد نتائج.</p>'; bindCards();
      } catch (e) { box.innerHTML = '<p class="mute">خطأ: ' + esc(errMsg(e)) + '</p>'; }
    };
    view.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { view.querySelectorAll('.tabs button').forEach(x => x.classList.remove('on')); b.classList.add('on'); show(+b.dataset.i); });
    show(0);
  } catch (e) { say('تعذّر تحميل الأنمي: ' + errMsg(e)); }
}

async function openMeta(type, id) {
  say('جارٍ التحميل…');
  try {
    const { meta } = await get(catalogAddon, `/meta/${type}/${encodeURIComponent(id)}.json`);
    const vids = meta.videos && meta.videos.length ? meta.videos : [{ id: meta.id, title: 'مشاهدة' }];
    const seen = new Set(store.get('seen', {})[meta.id] || []);
    view.innerHTML = `<div class="hero" style="background-image:url('${esc(meta.background || meta.poster)}')"><div><h2>${esc(meta.name)}</h2><p class="sub">${esc((meta.genres || []).slice(0, 4).join(' · ') || meta.releaseInfo || '')}</p><div class="acts"><button class="ghost" id="watch">${I.playc} شاهد الآن</button><button class="ghost" id="fav"></button></div>${metaRow(meta)}</div></div>`
      + `<div class="sec"><div class="tabs"><button class="on" data-t="eps">الحلقات</button><button data-t="ds">الوصف</button></div>`
      + `<div id="t_eps"><div class="eps">${vids.map((v, i) => `<button data-i="${i}" class="${seen.has(v.id) ? 'seen' : ''}">${esc(v.episode ?? v.title ?? i + 1)}</button>`).join('')}</div><div id="out"></div></div>`
      + `<div id="t_ds" class="hide"><p class="mute" id="desc">${esc(meta.description)}</p></div></div>`;
    $('.wrap').classList.add('hh'); view.scrollTop = 0; $('header').classList.remove('solid');
    if (translateOn && meta.description) translateDesc(meta);
    const fp = () => ($('#fav').innerHTML = isFavId(meta.id) ? starSvg(true) + ' في المفضلة' : I.plus + ' أضف للمفضلة');
    fp();
    $('#fav').onclick = () => { toggleFav({ id: meta.id, type, name: meta.name, poster: meta.poster }); fp(); };
    view.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
      view.querySelectorAll('.tabs button').forEach(x => x.classList.remove('on')); b.classList.add('on');
      $('#t_eps').classList.toggle('hide', b.dataset.t !== 'eps'); $('#t_ds').classList.toggle('hide', b.dataset.t !== 'ds');
    });
    view.querySelectorAll('.eps button').forEach(b => b.onclick = () => {
      view.querySelectorAll('.eps button').forEach(x => x.classList.remove('on'));
      b.classList.add('on'); b.classList.add('seen');
      const v = vids[b.dataset.i];
      const s = store.get('seen', {}); s[meta.id] = [...new Set([...(s[meta.id] || []), v.id])]; store.set('seen', s);
      const h = store.get('hist', []).filter(x => x.id !== meta.id);
      store.set('hist', [{ id: meta.id, type, name: meta.name, poster: meta.poster }, ...h].slice(0, 40));
      loadStreams(type, v.id);
    });
    $('#watch').onclick = () => { const b = view.querySelector('.eps button:not(.seen)') || view.querySelector('.eps button'); b && b.click(); };
  } catch (e) { say('خطأ: ' + errMsg(e)); }
}

/* ===== Discord Rich Presence ===== */
const rpcOn = () => store.get('discordOn', true);
const rpcSet = (a) => { if (!rpcOn()) return; try { window.api.rpc.set(a); } catch {} };
const rpcBrowse = () => rpcSet({ type: 0, details: 'يتصفح الأنمي', state: 'WayAnime' });
function rpcCover() {   // نحاولو نجيبو صورة الأنمي (لازم رابط https، وإلا نستعملو اللوغو)
  let u = (typeof playCtx !== 'undefined' && playCtx && playCtx.poster) || '';
  if (!u) { const h = document.querySelector('.hero'); const m = h && /url\(["']?([^"')]+)/.exec(h.style.backgroundImage || ''); u = m ? m[1] : ''; }
  return /^https:\/\//i.test(u) && u.length < 256 ? u : '';
}
const rpcEp = (ep) => { ep = String(ep || '').trim(); return /^\d+$/.test(ep) ? 'الحلقة ' + ep : ep; };
function rpcBind(v, title, ep) {
  const cover = rpcCover(), epTxt = rpcEp(ep); let t = null;
  const upd = () => {
    const base = { type: 3, details: (title || 'WayAnime').trim(), image: cover, imageText: (title || 'WayAnime').trim() };
    if (v.ended) return rpcSet({ ...base, state: (epTxt ? epTxt + ' · ' : '') + 'انتهت' });
    if (v.paused) return rpcSet({ ...base, state: (epTxt ? epTxt + ' · ' : '') + '⏸ متوقف' });
    const start = Date.now() - (v.currentTime || 0) * 1000;
    rpcSet({ ...base, state: epTxt || 'يشاهد الآن', start, end: isFinite(v.duration) && v.duration > 0 ? start + v.duration * 1000 : undefined });
  };
  const soon = () => { clearTimeout(t); t = setTimeout(upd, 700); };
  ['playing', 'pause', 'seeked', 'ended', 'loadedmetadata'].forEach(e => v.addEventListener(e, soon));
}

let plKey = null;
function closePlayer() {
  const pl = $('#pl');
  if (pl) { pl._hls && pl._hls.destroy(); const v = pl.querySelector('video'); if (v) { v.pause(); v.removeAttribute('src'); v.load(); } const fr = pl.querySelector('iframe'); if (fr) fr.src = 'about:blank'; pl.remove(); }
  if (plKey) { document.removeEventListener('keydown', plKey); plKey = null; }
  if (document.fullscreenElement) document.exitFullscreen();
  rpcBrowse();
}

function attach(url, s = {}) {
  closePlayer();
  const title = ($('.hero h2') || {}).textContent || '';
  const ep = ($('.eps button.on') || {}).textContent || '';
  const pl = document.createElement('div');
  pl.id = 'pl';
  pl.innerHTML = `<div class="pbox"><video autoplay></video>
    <div class="ptop"><button id="pcc" title="الترجمة">${I.cc}</button><b>${esc(title)} ${esc(ep)}</b><span class="sp"></span><button id="pfs" title="ملء الشاشة">${I.full}</button><button id="pb" title="إغلاق">${I.close}</button></div>
    <button class="pcen" id="pcn">${I.pause}</button>
    <div class="pbot"><button id="pp">${I.pause}</button><span id="pt">0:00 / 0:00</span><input type="range" id="ps" min="0" max="1000" value="0"><button id="pq" title="الجودة">${I.hd}</button><button id="pn" title="الحلقة التالية">${I.next}</button><div class="pvol"><input type="range" id="pv" min="0" max="1" step="0.05" value="1"><button id="pm">${I.vol}</button></div></div>
    <div class="qmenu" id="qm" hidden></div>
    <div class="smenu"><button id="pc" title="وضع التوافق (تحويل الفيديو)">${I.sync} وضع التوافق</button></div></div>`;
  document.body.appendChild(pl);
  const v = pl.querySelector('video'), $$ = (i) => pl.querySelector(i);
  rpcBind(v, title, ep);
  if (/\.m3u8|\/hls\/|master\.txt|\/playlist/i.test(url) && window.Hls && Hls.isSupported()) {
    const h = new Hls({ maxBufferLength: 40, manifestLoadingMaxRetry: 3, levelLoadingMaxRetry: 3, fragLoadingMaxRetry: 4 }); pl._hls = h; h.loadSource(url); h.attachMedia(v);
    let hlsTry = 0;   // نحاولو نصلحو الأخطاء قبل ما نستسلمو
    h.on(Hls.Events.ERROR, (_e, d) => {
      if (!d || !d.fatal) return;
      if (++hlsTry > 4) return (pl._hls === h) && v.onerror && v.onerror();
      if (d.type === Hls.ErrorTypes.NETWORK_ERROR) h.startLoad();
      else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) h.recoverMediaError();
      else (pl._hls === h) && v.onerror && v.onerror();
    });
  }
  else v.src = url;
  if (pendingResume != null) { const t0 = pendingResume; pendingResume = null; v.addEventListener('loadedmetadata', () => { try { if (isFinite(v.duration) && t0 < v.duration - 20) v.currentTime = t0; } catch {} }, { once: true }); }
  { const ctx = playCtx; let lastSave = 0;
    const save = () => { if (ctx) resumeSave(ctx, v); };
    v.addEventListener('timeupdate', () => { if (Date.now() - lastSave > 5000) { lastSave = Date.now(); save(); } });
    v.addEventListener('pause', save); v.addEventListener('ended', save); }
  let tcOn = false;
  const msg = (t) => { const o = pl.querySelector('.perr'); o ? (o.textContent = t) : pl.querySelector('.pbox').insertAdjacentHTML('beforeend', `<p class="perr">${esc(t)}</p>`); };
  const tc = async () => {
    if (tcOn) return; tcOn = true; msg('جارٍ تحويل الفيديو لصيغة متوافقة…');
    try { if (pl._hls) { pl._hls.destroy(); pl._hls = null; } v.src = await window.api.transcode(url); await v.play(); const o = pl.querySelector('.perr'); o && o.remove(); }
    catch (e) { msg('تعذّر التحويل: ' + errMsg(e)); }
  };
  v.onerror = () => (tcOn ? msg('تعذّر تشغيل هذا المصدر. جرّب مصدراً آخر.') : tc());
  v.onloadedmetadata = () => { if (!tcOn && v.videoWidth === 0) tc(); };
  v.addEventListener('playing', () => setTimeout(() => { if (!tcOn && !v.paused && !v.muted && v.webkitAudioDecodedByteCount === 0) tc(); }, 2500), { once: true });
  $$('#pc').onclick = tc;
  // ===== قائمة الجودة: مستويات HLS + السيرفرات/الجودات الأخرى الخدامة =====
  { const qm = $$('#qm'), pq = $$('#pq');
    const build = () => {
      const h = pl._hls, rows = [];
      if (h && h.levels && h.levels.length > 1) {
        rows.push('<b>الجودة</b>', `<button data-l="-1" class="${h.autoLevelEnabled ? 'on' : ''}">تلقائي</button>`);
        h.levels.map((l, i) => ({ i, h: l.height || 0, b: l.bitrate || 0 })).sort((x, y) => (y.h - x.h) || (y.b - x.b))
          .forEach(l => rows.push(`<button data-l="${l.i}" class="${!h.autoLevelEnabled && h.currentLevel === l.i ? 'on' : ''}">${l.h ? l.h + 'p' : Math.round(l.b / 1000) + ' kbps'}</button>`));
      }
      const alts = (playCtx && playCtx.alts) || [];
      if (alts.length) {
        rows.push('<b>سيرفرات / جودات أخرى</b>');
        alts.forEach((a, i) => rows.push(`<button data-a="${i}">${esc(a.t)}</button>`));
      }
      qm.innerHTML = rows.length ? rows.join('') : '<span class="mute">جودة واحدة فقط لهذا المصدر</span>';
    };
    pq.onclick = (ev) => { ev.stopPropagation(); if (qm.hidden) build(); qm.hidden = !qm.hidden; };
    qm.onclick = (ev) => {
      ev.stopPropagation();
      const b = ev.target.closest('button'); if (!b) return;
      if (b.dataset.l !== undefined) { const h = pl._hls; if (h) h.currentLevel = +b.dataset.l; qm.hidden = true; toast(b.textContent); }
      else if (b.dataset.a !== undefined) {
        const a = playCtx.alts[+b.dataset.a], t = v.currentTime; qm.hidden = true;
        if (t > 5) pendingResume = t;
        playCtx.alts[+b.dataset.a] = { t: playCtx.cur, f: playCtx.curF }; playCtx.cur = a.t; playCtx.curF = a.f; Promise.resolve(a.f()).then(ok => { if (ok === false) { pendingResume = null; toast('هذه الجودة لا تعمل'); } });
      }
    };
    pl.addEventListener('click', () => { qm.hidden = true; });
  }
  const f = (t) => isFinite(t) ? Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0') : '0:00';
  const toggle = () => (v.paused ? v.play() : v.pause());
  v.onclick = toggle; $$('#pp').onclick = toggle; $$('#pcn').onclick = toggle;
  v.onplay = () => { $$('#pp').innerHTML = I.pause; $$('#pcn').innerHTML = I.pause; pl.classList.remove('paused'); };
  v.onpause = () => { $$('#pp').innerHTML = I.play; $$('#pcn').innerHTML = I.play; pl.classList.add('paused'); };
  v.ontimeupdate = () => { $$('#pt').textContent = f(v.currentTime) + ' / ' + f(v.duration); if (isFinite(v.duration)) { const p = (v.currentTime / v.duration) * 1000; $$('#ps').value = p; $$('#ps').style.setProperty('--p', (p / 10) + '%'); } };
  $$('#ps').oninput = (e) => { if (isFinite(v.duration)) v.currentTime = (e.target.value / 1000) * v.duration; e.target.style.setProperty('--p', (e.target.value / 10) + '%'); };
  $$('#pv').oninput = (e) => { v.volume = e.target.value; v.muted = false; e.target.style.setProperty('--p', (e.target.value * 100) + '%'); };
  $$('#pm').onclick = () => { v.muted = !v.muted; $$('#pm').innerHTML = v.muted ? I.mute : I.vol; };
  $$('#pfs').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : pl.querySelector('.pbox').requestFullscreen());
  $$('#pb').onclick = closePlayer;
  $$('#pn').onclick = async () => {   // الحلقة التالية مباشرة: نفس السيرفر/الجودة بلا ما تختار من جديد
    const label = playCtx && playCtx.label, n = $('.eps button.on');
    let nx = n && n.nextElementSibling; while (nx && nx.classList.contains('miss')) nx = nx.nextElementSibling;
    if (!nx) return toast('هذي آخر حلقة');
    closePlayer(); nx.click();
    const sb = await waitFor(() => { const l = [...view.querySelectorAll('.streams button')]; return l.length ? (l.find(x => label && x.textContent.includes(label)) || l[0]) : null; });
    if (sb) sb.click();
  };
  let tm; const wake = () => { pl.classList.remove('idle'); clearTimeout(tm); tm = setTimeout(() => pl.classList.add('idle'), 3000); };
  pl.onmousemove = wake; wake();
  pl.onclick = (e) => { if (e.target === pl) closePlayer(); };
  plKey = (e) => { if (e.key === 'Escape') closePlayer(); else if (e.key === ' ') { e.preventDefault(); toggle(); } else if (e.key === 'ArrowRight') v.currentTime += 10; else if (e.key === 'ArrowLeft') v.currentTime -= 10; };
  document.addEventListener('keydown', plKey);
  subsUI(v, pl);
}

async function play(s) {
  const box = $('#player');
  if (s.url) attach(s.url, s);
  else if (s.externalUrl) window.api.openExternal(s.externalUrl);
  else if (s.infoHash) {
    box.innerHTML = '<p class="mute">جارٍ الاتصال بالتورنت… قد يستغرق دقيقة.</p>';
    try { const r = await window.api.torrent({ infoHash: s.infoHash, fileIdx: s.fileIdx, sources: s.sources }); box.innerHTML = ''; attach(r.url, s); }
    catch (e) { box.innerHTML = `<p class="mute">فشل التورنت: ${esc(errMsg(e))}</p>`; }
  }
}


async function trSub(txt, prog) {
  const vtt = txt.trim().startsWith('WEBVTT') ? txt : srtToVtt(txt);
  const bl = vtt.replace(/\r/g, '').split(/\n\n+/).slice(1).map(b => b.split('\n')).map(l => {
    const i = l.findIndex(x => x.includes('-->'));
    return i < 0 ? null : { t: l[i], s: l.slice(i + 1).join(' ').replace(/<[^>]+>|\{[^}]*\}/g, '').trim() };
  }).filter(Boolean);
  for (let i = 0; i < bl.length;) {
    let j = i, n = 0;
    while (j < bl.length && n + bl[j].s.length < 1400) { n += bl[j].s.length + 1; j++; }
    if (j === i) j++;
    const g = bl.slice(i, j);
    try { const o = (await window.api.translate(g.map(b => b.s).join('\n'))).split('\n'); if (o.length === g.length) g.forEach((b, k) => (b.s = o[k])); } catch {}
    i = j; prog && prog(Math.round(i / bl.length * 100));
  }
  return 'WEBVTT\n\n' + bl.map(b => b.t + '\n' + b.s).join('\n\n');
}

async function subsUI(v, pl) {
  const menu = pl.querySelector('.smenu');
  pl.querySelector('#pcc').onclick = () => menu.classList.toggle('show');
  const toVtt = (t) => (t.trim().startsWith('WEBVTT') ? t : srtToVtt(t));
  const setTrack = (vtt) => {
    v.querySelectorAll('track').forEach(t => t.remove());
    if (!vtt) return;
    const tr = document.createElement('track');
    tr.kind = 'subtitles'; tr.default = true;
    tr.src = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
    v.appendChild(tr); tr.track.mode = 'showing';
  };
  const item = (label, fn) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = async () => {
      menu.querySelectorAll('button').forEach(x => x.classList.remove('on')); b.classList.add('on');
      try { await fn(b); } catch { b.textContent = label + ' — تعذّر'; }
    };
    menu.appendChild(b); return b;
  };
  item('بدون ترجمة', () => setTrack(null)).classList.add('on');
  if (!subAddon) return;
  let subs = [];
  try { subs = (await get(subAddon, `/subtitles/${cur.type}/${encodeURIComponent(cur.vid)}.json`)).subtitles || []; } catch {}
  const nm = (c) => { try { return new Intl.DisplayNames(['ar'], { type: 'language' }).of(c); } catch { return c; } };
  const by = {};
  subs.forEach(s => { const l = (s.lang || '?').toLowerCase(); (by[l] = by[l] || []).push(s); });
  const isAr = (l) => /^ar/.test(l);
  let first = null;
  Object.keys(by).sort((a, b) => (isAr(b) - isAr(a)) || a.localeCompare(b)).slice(0, 12).forEach(l =>
    by[l].slice(0, 2).forEach((s, k) => {
      const b = item(nm(l) + (k ? ' ' + (k + 1) : ''), async () => setTrack(toVtt(await window.api.text(s.url))));
      if (!first && isAr(l)) first = b;
    }));
  const en = by.eng || by.en;
  if (en) item('ترجمة تلقائية إلى العربية', async (b) => {
    const o = b.textContent;
    const vtt = await trSub(await window.api.text(en[0].url), p => (b.textContent = 'جارٍ الترجمة ' + p + '%'));
    b.textContent = o; setTrack(vtt);
  });
  first && first.click();
}

$('#wMin').onclick = () => window.api.win.min();
$('#wClose').onclick = () => window.api.win.close();
$('#wMax').onclick = async () => {
  const m = await window.api.win.max();
  $('#wMax').innerHTML = m ? svg('<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M5 15V7a2 2 0 0 1 2-2h8"/>') : svg('<rect x="5" y="5" width="14" height="14" rx="2"/>');
};
$('#qb').onclick = () => { const v = $('#q').value.trim(); v && loadCatalog(v); };
view.onscroll = () => $('header').classList.toggle('solid', view.scrollTop > 40);
window.addEventListener('error', (e) => say('خطأ في البرنامج: ' + e.message));
window.addEventListener('unhandledrejection', (e) => say('خطأ: ' + errMsg(e.reason)));

/* ===== معلومات التطبيق: كليك على اللوغو فوق ===== */
async function showAbout() {
  if (document.querySelector('.abov')) return;
  let ver = '—'; try { ver = await window.api.update.version(); } catch {}
  const ic = {
    build: svg('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>'),
    app: svg('<rect x="3" y="4" width="18" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="18" x2="12" y2="21"/>'),
    dev: svg('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>'),
    x: svg('<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>')
  };
  const row = (i, l, v) => `<div class="abr"><span class="abi">${i}</span><div><small>${l}</small><b>${esc(v)}</b></div></div>`;
  const ov = document.createElement('div'); ov.className = 'abov';
  ov.innerHTML = `<div class="abbox" role="dialog" aria-modal="true"><button class="abx" aria-label="إغلاق">${ic.x}</button><img class="ablogo" src="assets/logo.png" alt=""><h3 class="abname">WayAnime</h3><div class="abl">${row(ic.build, 'رقم البيلد', 'Build ' + ver)}${row(ic.app, 'اسم التطبيق', 'WayAnime')}<div class="abr abdev"><img class="abav" src="assets/dev.png" alt=""><div><small>المطوّر</small><b>carlodz</b></div><span class="abtag">${ic.dev}</span></div></div></div>`;
  const done = () => { document.removeEventListener('keydown', onKey, true); ov.classList.add('out'); setTimeout(() => ov.remove(), 150); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(); } };
  ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('.abx')) done(); });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(ov);
  ov.querySelector('.abx').focus();
}
document.querySelector('.brand').onclick = showAbout;

/* ===== المصدر العربي (Animeify): أنمي مترجم/مدبلج بالعربية، روابط مباشرة ===== */
const arCache = new Map();
const arOk = (v) => v && v !== 'N/A' && v !== '0';
/* ===== «جديد»: الأنمي اللي ما شفناهش في المرات السابقة ===== */
const knownAtStart = new Set(store.get('known', []));
const firstRun = knownAtStart.size === 0;
const newIds = new Set();
function markKnown(list) {
  const k = store.get('known', []); const set = new Set(k);
  list.forEach(m => set.add(m.id));
  store.set('known', [...set].slice(-4000));
}
function flagNew(list) { if (!firstRun) list.forEach(m => { if (!knownAtStart.has(m.id)) newIds.add(m.id); }); }
const toast = (t) => { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 4000); };

/* ===== بوستر بديل: إلا الصورة ما تحمّلاتش (أو فارغة) نجيبو غلاف بالاسم (AniList/Kitsu/Jikan)، وإلا ما لقينا نرسمو بوستر بالاسم ===== */
const posterFb = {};
const phSvg = (name) => {
  const t = String(name || '?').trim(), ch = [...t].slice(0, 2).join('').toUpperCase(), h = [...t].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  const x = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="430"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},45%,32%)"/><stop offset="1" stop-color="hsl(${(h + 50) % 360},50%,16%)"/></linearGradient></defs><rect width="300" height="430" fill="url(#g)"/><text x="150" y="235" font-size="90" text-anchor="middle" fill="#fff" fill-opacity=".85" font-family="sans-serif">${ch.replace(/[<>&]/g, '')}</text></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(x);
};
const nameOfImg = (img) => { const h = img.closest('.card, .dlitem'); const n = h && (h.querySelector('p') || h.querySelector('.dlm b')); return n ? n.textContent.trim() : ''; };
async function fixPoster(img) {
  if (!img || img.dataset.fb) return; img.dataset.fb = '1';
  const name = nameOfImg(img); if (!name) return;
  try {
    const cache = store.get('pfb', {});
    let u = cache[name] || posterFb[name];
    if (!u) { u = await window.api.anilistCover(name); if (u) { cache[name] = u; const ks = Object.keys(cache); if (ks.length > 400) delete cache[ks[0]]; store.set('pfb', cache); } }
    img.src = u || phSvg(name);
    if (u) posterFb[name] = u;
  } catch { img.src = phSvg(name); }
}
document.addEventListener('error', (ev) => { const img = ev.target; if (img instanceof HTMLImageElement && img.closest('.card, .dlitem')) { if (img.dataset.fb) { if (!img.src.startsWith('data:')) img.src = phSvg(nameOfImg(img)); } else fixPoster(img); } }, true);
new MutationObserver(() => document.querySelectorAll('img[data-need]:not([data-fb])').forEach(fixPoster)).observe(document.body, { childList: true, subtree: true });

/* ===== سرعة البوسترات: أول 30 كارط كيتحملو مباشرة (من الكاش)، والباقي lazy، مع fade-in باش ما يبانوش بطاح ===== */
const posterReady = (img) => img.classList.add('ld');
document.addEventListener('load', (ev) => { const i = ev.target; if (i instanceof HTMLImageElement && i.closest('.card, .dlitem, .smrow')) posterReady(i); }, true);
new MutationObserver(() => {
  let n = 0;
  document.querySelectorAll('.card img:not([data-sp])').forEach((img) => {
    img.dataset.sp = '1'; img.decoding = 'async';
    if (n++ < 30) img.loading = 'eager';
    if (img.complete && img.naturalWidth) posterReady(img);
  });
}).observe(document.body, { childList: true, subtree: true });
/* تسخين الروابط: ملي كيوقف الماوس على كارط كنجبدو الحلقات مسبقاً باش يتحل الأنمي فورا */
let warmT = 0;
document.addEventListener('mouseover', (ev) => {
  const c = ev.target.closest && ev.target.closest('.card[data-type="ar"]'); if (!c) return;
  clearTimeout(warmT);
  warmT = setTimeout(() => { const id = c.dataset.id; if (/^\d+$/.test(id)) window.api.ar.episodes(id).catch(() => {}); }, 150);
});
setTimeout(() => document.querySelectorAll('.card img:not(.ld)').forEach((i) => { if (i.complete) posterReady(i); }), 4000);

const arCard = (m) => {
  arCache.set(m.id, m);
  return `<div class="card" tabindex="0" data-id="${esc(m.id)}" data-type="ar">${m.lastEp ? '<span class="epb">الحلقة ' + esc(m.lastEp) + '</span>' : ''}${newIds.has(m.id) ? '<span class="badge">جديد</span>' : ''}<img loading="lazy" src="${esc(m.poster || phSvg(m.name))}"${m.poster ? '' : ' data-need="1"'} alt=""><p>${esc(m.name)}</p><div class="cm"><span>${esc(arOk(m.type) ? m.type : '')}</span></div><div class="cm"><b class="rt">${arOk(m.score) ? esc(m.score) : ''}</b><button class="star" data-id="${esc(m.id)}" data-type="ar" data-name="${esc(m.name)}" data-poster="${esc(m.poster)}">${starSvg(isFavId(m.id))}</button></div></div>`;
};
const arGrid = (list) => '<div class="grid">' + list.map(arCard).join('') + '</div>';

/* ===== منع التكرار: نفس الأنمي ما يظهر مرتين (حتى لو جا من مصدرين أو بـ id مختلف) ===== */
const normT = (t) => String(t || '').toLowerCase()
  .replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/[^a-z0-9\u0600-\u06FF]+/g, '');
const keysOf = (m) => [...new Set([m.name, m.nameEn].map(normT).filter(k => k.length > 1))];
const newSeen = () => ({ ids: new Set(), keys: new Set() });
function dedupe(list, seen) {
  const out = [];
  for (const m of list) {
    if (!m || !m.id || seen.ids.has(m.id)) continue;
    const ks = keysOf(m);
    if (ks.some(k => seen.keys.has(k))) continue;
    seen.ids.add(m.id); ks.forEach(k => seen.keys.add(k)); out.push(m);
  }
  return out;
}

/* ===== أنمي من custom.json ===== */
const customMap = (c, i) => ({
  id: 'custom:' + (c.id || normT(c.nameEn || c.name) || i), name: c.name || c.nameEn || 'بدون اسم', nameEn: c.nameEn || '',
  poster: c.poster || '', genres: c.genres || '', score: c.score ? String(c.score) : '', synopsis: c.synopsis || '',
  type: c.type || '', status: c.status || '', season: '', src: 'custom', episodes: Array.isArray(c.episodes) ? c.episodes : []
});
async function customList() { return []; }

/* ===== WitAnime (منقول من anime_scraper) — التحليل بـ DOMParser ===== */
const WIT = 'https://witanime.art/';
const witHtml = async (u) => new DOMParser().parseFromString(await window.api.html(/^https?:/i.test(u) ? u : WIT + u), 'text/html');
const abs = (h) => { try { return new URL(h, WIT).href; } catch { return ''; } };
const witSlug = (href) => {
  try { const p = new URL(href, WIT).pathname.split('/').filter(Boolean); const i = p.indexOf('anime'); return p[i >= 0 ? i + 1 : p.length - 1] || ''; } catch { return ''; }
};
const imgOf = (el) => { const i = el && el.querySelector('img'); if (!i) return ''; const s = i.getAttribute('src') || ''; return abs(s.startsWith('data:') ? (i.getAttribute('data-src') || '') : (s || i.getAttribute('data-src') || '')); };
const witCard = (c) => {
  const a = c.querySelector('.anime-card-title h3 > a') || c.querySelector('h3 > a');
  if (!a) return null;
  const url = abs(a.getAttribute('href')), slug = witSlug(url);
  if (!slug) return null;
  const story = (c.querySelector('.anime-card-title') || {}).getAttribute ? c.querySelector('.anime-card-title').getAttribute('data-content') : '';
  const t = c.querySelector('.anime-card-type a'), st = c.querySelector('.anime-card-status a');
  const m = { id: 'wit:' + slug, name: a.textContent.trim(), nameEn: '', poster: imgOf(c), genres: '', score: '', synopsis: story || '',
    type: t ? t.textContent.trim() : '', status: st ? st.textContent.trim() : '', url, src: 'wit' };
  { const em = ((c.textContent || '') + ' ' + (c.querySelector('a[href*="/episode/"]') ? decodeURIComponent(c.querySelector('a[href*="/episode/"]').getAttribute('href') || '') : '')).match(/(?:الحلقة|حلقة)[\s-]*(\d+(?:\.\d+)?)/); if (em) m.lastEp = em[1]; }
  arCache.set(m.id, m); return m;
};
const witCards = (doc) => [...doc.querySelectorAll('.anime-card-container')].map(witCard).filter(Boolean);
const witCache = new Map();
async function witSearch(q) {
  q = String(q || '').trim(); if (!q) return [];
  if (!witCache.has(q)) witCache.set(q, witHtml(`?search_param=animes&s=${encodeURIComponent(q)}`).then(witCards).catch(() => { witCache.delete(q); return []; }));
  return witCache.get(q);
}
async function witLatest() { try { return witCards(await witHtml('episode')); } catch { return []; } }
async function witSeason() {
  try {
    const home = await witHtml(WIT);
    const a = home.querySelector('#menu-item-107 a'); if (!a) return [];
    return witCards(await witHtml(abs(a.getAttribute('href'))));
  } catch { return []; }
}
async function witDub() {
  // مدبلج: نلقاو رابط «مدبلج» فـ قوائم WitAnime (تصنيف/نوع/قائمة)، ونقرا كذا صفحة؛ وإلا نرجعو للبحث
  const out = [];
  try {
    const home = await witHtml(WIT);
    const links = [...home.querySelectorAll('a')].filter(a => /مدبلج/.test(a.textContent || '') && a.getAttribute('href') && !/^#|javascript:/i.test(a.getAttribute('href')));
    const href = links.length ? abs(links[0].getAttribute('href')) : '';
    if (href) {
      const base = href.replace(/\/+$/, '').replace(/\/page\/\d+$/, '');
      for (let p = 1; p <= 4; p++) {
        let cards = [];
        try { cards = witCards(await witHtml(p === 1 ? href : base + '/page/' + p + '/')); } catch { break; }
        if (!cards.length) break;
        out.push(...cards);
      }
    }
  } catch {}
  if (!out.length) { try { out.push(...await witSearch('مدبلج')); } catch {} }
  return out;
}
/* ===== Stardima (مدبلج) — عبر main.js (كود addon الأصلي) ===== */
const sdToM = (it) => {
  const m = { id: 'sd:' + it.id, name: it.title || it.slug, nameEn: '', poster: it.poster || '', genres: '', score: '', synopsis: it.description || '', type: it.type === 'movie' ? 'فيلم' : 'مسلسل', status: '', season: '', src: 'sd' };
  arCache.set(m.id, m); return m;
};
async function sdBatch(skip, limit) {
  const type = AF.type === 'MOVIE' ? 'movie' : (AF.type === 'SERIES' ? 'series' : '');
  if (!type) return [];
  return ((await window.api.sd.catalog({ type, skip, limit })) || []).map(sdToM);
}
async function sdDetails(id) {
  if (arCache.has(id) && arCache.get(id).sdMeta) return arCache.get(id);
  const meta = await window.api.sd.meta(id.replace(/^sd:/, ''));
  const old = arCache.get(id) || {};
  const m = { ...old, id, name: meta.name || old.name || id, nameEn: '', poster: meta.poster || old.poster || '', genres: '', score: '', synopsis: meta.description || old.synopsis || '', type: old.type || '', src: 'sd', sdMeta: meta };
  arCache.set(id, m); return m;
}
function sdEpisodes(m) {
  const meta = m.sdMeta || {};
  if (meta.type === 'movie') return [{ num: 'الفيلم', sd: { type: 'movie', slug: meta.slug } }];
  const vids = meta.videos || [], multi = new Set(vids.map(v => v.season)).size > 1;
  return vids.map(v => ({ num: multi ? `${v.season}-${v.episode}` : String(v.episode), sd: { type: 'series', episodeId: v.episodeId, slug: meta.slug } }));
}
/* ===== Anime4up (آخر الحلقات) — الدومين كيتبدّل، كنجربو لائحة ===== */
const A4_DOMAINS = ['https://w1.anime4up.rest/', 'https://anime4up.rest/', 'https://anime4up.uno/', 'https://aniime4up.com/'];
let a4Base = '';
async function a4Html(url) {
  const path = url ? (() => { try { const u = new URL(url); return u.pathname + u.search; } catch { return String(url); } })() : '';
  const bases = a4Base ? [a4Base, ...A4_DOMAINS.filter(b => b !== a4Base)] : A4_DOMAINS;
  let last;
  for (const b of bases) {
    try {
      const doc = new DOMParser().parseFromString(await window.api.html(new URL(path, b).href), 'text/html');
      if (doc.querySelectorAll('a[href]').length > 5) { a4Base = b; return doc; }
    } catch (e) { last = e; }
  }
  throw last || new Error('Anime4up غير متاح');
}
const a4Abs = (h) => { try { return new URL(h, a4Base || A4_DOMAINS[0]).href; } catch { return ''; } };
const a4Img = (el) => {
  const i = el && el.querySelector && el.querySelector('img'); if (!i) return '';
  const ok = (v) => v && !v.startsWith('data:');
  let v = ['data-src', 'data-lazy-src', 'data-original', 'src'].map(k => i.getAttribute(k) || '').find(ok) || '';
  if (!v) { const ss = (i.getAttribute('data-srcset') || i.getAttribute('srcset') || '').split(',')[0].trim().split(' ')[0]; if (ok(ss)) v = ss; }
  return v ? a4Abs(v) : '';
};
const a4Clean = (t) => String(t || '').replace(/\s+/g, ' ').replace(/^\s*(انمي|أنمي)\s+/, '').replace(/\s*(الحلقة|حلقة|الأونا|الاونا)\s*\d+.*$/, '').replace(/\s*مترجم[ةه]?\s*$/, '').trim();
function a4Cards(doc) {
  const out = [], seen = new Set();
  doc.querySelectorAll('a[href*="/episode/"]').forEach(a => {
    const href = a4Abs(a.getAttribute('href')); if (!href) return;
    const box = a.closest('article, .anime-card-container, .episodes-card-container, .episode-card, li, div') || a;
    const h = box.querySelector('h1,h2,h3,h4') || a.querySelector('h1,h2,h3,h4');
    const img = a.querySelector('img') || box.querySelector('img');
    let name = a4Clean((h && h.textContent) || (img && img.getAttribute('alt')) || a.getAttribute('title') || a.textContent);
    if (!name) { try { name = a4Clean(decodeURIComponent(href.split('/episode/')[1] || '').replace(/-/g, ' ')); } catch {} }
    if (!name) return;
    const key = normT(name); if (seen.has(key)) return; seen.add(key);
    const ep = ((box.textContent || '') + ' ' + decodeURIComponent(href)).match(/(?:الحلقة|حلقة)[\s-]*(\d+)/);
    const m = { id: 'a4:' + encodeURIComponent(href), name, nameEn: '', poster: a4Img(a) || a4Img(box), genres: '', score: '', synopsis: '', type: ep ? 'الحلقة ' + ep[1] : '', status: '', season: '', src: 'a4', a4Url: href, a4Ep: ep ? ep[1] : '', lastEp: ep ? ep[1] : '' };
    arCache.set(m.id, m); out.push(m);
  });
  return out;
}
async function a4Latest() { try { return a4Cards(await a4Html('')); } catch { return []; } }
async function a4Eps(m) {
  const eps = new Map(), add = (doc) => doc.querySelectorAll('a[href*="/episode/"]').forEach(a => {
    const url = a4Abs(a.getAttribute('href')), t = (a.textContent || '') + ' ' + (() => { try { return decodeURIComponent(url); } catch { return url; } })();
    const n = t.match(/(?:الحلقة|حلقة|الأونا|الاونا)[\s-]*(\d+(?:\.\d+)?)/); if (!n || eps.has(n[1])) return;
    eps.set(n[1], { num: n[1], a4: url });
  });
  try {
    const doc = await a4Html(m.a4Url); add(doc);
    const ap = doc.querySelector('a[href*="/anime/"]');
    if (ap && eps.size < 3) { try { add(await a4Html(a4Abs(ap.getAttribute('href')))); } catch {} }
    const d = doc.querySelector('meta[name="description"],meta[property="og:description"]'); if (d && !m.synopsis) m.synopsis = (d.getAttribute('content') || '').trim();
  } catch {}
  if (!eps.size) eps.set(m.a4Ep || '1', { num: m.a4Ep || '1', a4: m.a4Url });
  return [...eps.values()].sort((x, y) => parseFloat(x.num) - parseFloat(y.num));
}
const A4_HOSTS = [['uqload', 0], ['mp4upload', 1], ['mediafire', 2], ['voe.sx', 3], ['dsvplay', 4], ['doodstream', 4], ['dood', 4], ['ds2play', 4],
  ['streamwish', 5], ['hlswish', 5], ['awish', 5], ['dwish', 5], ['wishfast', 5], ['embedwish', 5], ['filemoon', 5], ['moonplayer', 5], ['vidhide', 5], ['filelions', 5], ['lulustream', 5], ['luluvdo', 5], ['earnvids', 5],
  ['mixdrop', 6], ['mixdrp', 6], ['streamtape', 6], ['strtape', 6], ['vidmoly', 6], ['ok.ru', 6], ['sendvid', 6], ['sibnet', 6], ['yourupload', 6], ['pixeldrain', 6], ['upstream', 6], ['vtube', 6],
  ['dailymotion', 7], ['drive.google', 7], ['vk.com', 7], ['vkvideo', 7], ['vikingfile', 8], ['megamax', 9], ['4shared', 9], ['archive.org', 9]];
const A4_SKIP = /facebook|twitter|instagram|telegram|t\.me|whatsapp|discord|anime4up|aniime4up|youtube\.com\/(?:@|channel|user)|patreon|ko-fi|paypal/i;
async function a4Links(url) {
  const doc = await a4Html(url), out = [];
  doc.querySelectorAll('table tr').forEach(tr => {
    const a = tr.querySelector('a[href^="http"]'); if (!a) return;
    const u = a.getAttribute('href'), h = hostOf(u), hit = A4_HOSTS.find(x => h.includes(x[0])) || (A4_SKIP.test(u) ? null : [h, 20]); if (!hit) return;
    const cells = [...tr.querySelectorAll('td')].map(td => td.textContent.trim());
    const q = cells.find(c => /FHD|HD|SD|\d{3,4}p|الجودات/i.test(c)) || '';
    const qr = /FHD/i.test(q) ? 0 : /HD/i.test(q) ? 1 : /SD/i.test(q) ? 2 : 3;
    out.push({ url: u, host: h, q: q.replace(/\s+/g, ' '), rank: hit[1] * 10 + qr });
  });
  return out.sort((x, y) => x.rank - y.rank);
}
async function sdLatest() { try { return ((await window.api.sd.catalog({ type: 'series', skip: 0, limit: 15 })) || []).map(sdToM); } catch { return []; } }
const mixLists = (ls) => { const out = []; for (let i = 0; ls.some(l => i < l.length); i++) ls.forEach(l => { if (i < l.length) out.push(l[i]); }); return out; };

async function witMatch(m) {
  const ks = keysOf(m);
  for (const q of [m.nameEn, m.name].filter(Boolean)) {
    const r = await witSearch(q);
    const hit = r.find(x => keysOf(x).some(k => ks.includes(k)));
    if (hit) return hit;
  }
  return null;
}
const lastNum = (t) => { const x = String(t || '').match(/(\d+(?:\.\d+)?)(?!.*\d)/); return x ? x[1] : ''; };
async function witEpisodes(id) {
  const m = arCache.get(id), slug = id.replace(/^wit:/, '');
  const doc = await witHtml(m && m.url ? m.url : `anime/${slug}/`);
  const eps = [...doc.querySelectorAll('.episodes-card')].map((c, i) => {
    const a = c.querySelector('h3 > a'); if (!a) return null;
    return { num: lastNum(a.textContent) || String(i + 1), url: abs(a.getAttribute('href')) };
  }).filter(Boolean);
  return eps.sort((a, b) => parseFloat(a.num) - parseFloat(b.num));
}
async function witDetails(id) {
  const m = arCache.get(id) || { id, name: id.replace(/^wit:/, ''), nameEn: '', poster: '', genres: '', score: '', synopsis: '', src: 'wit' };
  try {
    const doc = await witHtml(m.url || `anime/${id.replace(/^wit:/, '')}/`);
    const h = doc.querySelector('h1.anime-details-title'), g = [...doc.querySelectorAll('ul.anime-genres a')].map(x => x.textContent.trim());
    const st = doc.querySelector('p.anime-story');
    if (h) m.name = h.textContent.trim();
    if (g.length) m.genres = g.join(',');
    if (st) m.synopsis = st.textContent.trim();
    if (!m.poster) m.poster = imgOf(doc.querySelector('.anime-thumbnail, .anime-info-container, .anime-page-container') || doc.body);
  } catch {}
  arCache.set(id, m); return m;
}
async function witQualities(epUrl) {
  const doc = await witHtml(epUrl), out = [];
  doc.querySelectorAll('ul.quality-list').forEach(ul => {
    const q = (ul.querySelector('li') || {}).textContent;
    const links = [...ul.querySelectorAll('a')].map(a => {
      try { let b = (a.getAttribute('href') || '').replace(/-/g, '+').replace(/_/g, '/'); while (b.length % 4) b += '='; const u = atob(b); return /^https?:\/\//i.test(u) ? u : null; } catch { return null; }
    }).filter(Boolean);
    if (links.length) out.push({ q: (q || '').trim(), links });
  });
  return out;
}
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
function playEmbed(u) {
  closePlayer();
  const title = ($('.hero h2') || {}).textContent || '', ep = ($('.eps button.on') || {}).textContent || '';
  const pl = document.createElement('div');
  pl.id = 'pl';
  pl.innerHTML = `<div class="pbox"><iframe allowfullscreen allow="autoplay; fullscreen; encrypted-media; picture-in-picture" referrerpolicy="no-referrer-when-downgrade"></iframe>
    <div class="ptop"><b>${esc(title)} ${esc(ep)}</b><span class="sp"></span><button id="pfs" title="ملء الشاشة">${I.full}</button><button id="pb" title="إغلاق">${I.close}</button></div></div>`;
  document.body.appendChild(pl);
  rpcSet({ type: 3, details: (title || 'WayAnime').trim(), state: rpcEp(ep) || 'يشاهد الآن', start: Date.now(), image: rpcCover(), imageText: (title || 'WayAnime').trim() });
  pl.querySelector('iframe').src = u;
  pl.querySelector('#pb').onclick = closePlayer;
  pl.querySelector('#pfs').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : pl.querySelector('.pbox').requestFullscreen());
  pl.onclick = (e) => { if (e.target === pl) closePlayer(); };
  plKey = (e) => { if (e.key === 'Escape') closePlayer(); };
  document.addEventListener('keydown', plKey);
  let tm; const wake = () => { pl.classList.remove('idle'); clearTimeout(tm); tm = setTimeout(() => pl.classList.add('idle'), 3000); };
  pl.onmousemove = wake; wake();
}
async function playWitLink(u) {
  // كلشي كيتشغّل داخل التطبيق: فيديو مباشر/‏m3u8 فالمشغّل ديالنا، وإلا نعرضو صفحة السيرفر داخل التطبيق
  toast('جارٍ فتح السيرفر…');
  try {
    const r = await window.api.host.resolve(u);
    if (r && r.url) { play({ url: r.url }); return true; }
    if (r && r.embed) { playEmbed(r.embed); return true; }
  } catch {}
  toast('تعذّر تشغيل هذا السيرفر داخل التطبيق — جرّب سيرفراً آخر.');
  return false;
}

const AR_GENRES = [["أكشن", "Action"], ["مغامرة", "Adventure"], ["كوميدي", "Comedy"], ["دراما", "Drama"], ["خيال", "Fantasy"], ["إيسيكاي", "Isekai"], ["رومانسي", "Romance"], ["خيال علمي", "Sci-Fi"], ["شونين", "Shounen"], ["الحياة اليومية", "Slice-Of-Life"], ["خارق للطبيعة", "Supernatural"], ["غموض", "Mystery"], ["تشويق", "Suspense"], ["رياضي", "Sports"], ["مدرسي", "School"], ["سينين", "Seinen"], ["شوچو", "Shoujo"], ["رعب", "Horror"], ["ميكا", "Mecha"], ["تاريخي", "Historical"], ["قوى خارقة", "Super-Power"], ["سحر", "Magic"], ["أساطير", "Mythology"], ["عسكري", "Military"], ["إيتشي", "Ecchi"], ["حريم", "Harem"], ["بطولة راشدين", "Adult-Cast"], ["طعام", "Gourmet"], ["موسيقى", "Music"], ["فضاء", "Space"], ["بوليسي", "Detective"], ["سفر عبر الزمن", "Time-Travel"], ["مصاصي دماء", "Vampire"], ["سايبربانك", "Cyberpunk"]];
const DUB_ICON0 = svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8"/>');
const CHIP_ICONS = {
  latest: svg('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>'),
  POPULARITY: svg('<path d="M12 21c4-2 6-5 6-8.5 0-2.5-1.5-4-2.5-5-.3 2-1.5 3-2.5 3 0-3-1-5-3-7-.5 3-4 5-4 9 0 4 2 6.5 6 8.5z"/>'),
  HIGHEST_RATE: svg('<polygon points="12 3 14.9 9 21.5 9.8 16.6 14.3 17.9 21 12 17.7 6.1 21 7.4 14.3 2.5 9.8 9.1 9"/>'),
  AIRING: svg('<circle cx="12" cy="12" r="2"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2"/>'),
  MANGA: svg('<path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5M9 7h5"/>'),
  SEASON: svg('<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  DUB: DUB_ICON0,
  CUSTOM: svg('<path d="M12 5v14M5 12h14"/>'),
  SERIES: svg('<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>'),
  MOVIE: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>'),
  OVA: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M12 3v3"/>'),
  SPECIAL: svg('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18"/>')
};
const GENRE_ICONS = {
  "Action": svg("<path d=\"M13 2L4 14h7l-1 8 9-12h-7z\"/>"),
  "Adventure": svg("<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M15.5 8.5l-2 5-5 2 2-5z\"/>"),
  "Comedy": svg("<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M8 14a4.5 4.5 0 0 0 8 0M9 9.5h.01M15 9.5h.01\"/>"),
  "Drama": svg("<path d=\"M4 4h10v7a5 5 0 0 1-10 0z\"/><path d=\"M7 8h.01M11 8h.01M7.5 13a2 2 0 0 0 3 0M14 9h6v6a4 4 0 0 1-6 3.5\"/>"),
  "Fantasy": svg("<path d=\"M5 19L15 9M14 3v4M12 5h4M19 11v3M17.5 12.5h3\"/>"),
  "Isekai": svg("<ellipse cx=\"12\" cy=\"12\" rx=\"5\" ry=\"9\"/><path d=\"M12 7a2 5 0 1 0 0 10\"/>"),
  "Romance": svg("<path d=\"M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z\"/>"),
  "Sci-Fi": svg("<circle cx=\"12\" cy=\"12\" r=\"1.5\"/><ellipse cx=\"12\" cy=\"12\" rx=\"10\" ry=\"4\"/><ellipse cx=\"12\" cy=\"12\" rx=\"10\" ry=\"4\" transform=\"rotate(60 12 12)\"/><ellipse cx=\"12\" cy=\"12\" rx=\"10\" ry=\"4\" transform=\"rotate(120 12 12)\"/>"),
  "Shounen": svg("<path d=\"M12 3l2.5 6 6.5.5-5 4.3 1.6 6.4L12 16.5 6.4 20.2 8 13.8 3 9.5 9.5 9z\"/>"),
  "Slice-Of-Life": svg("<path d=\"M4 8h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM16 10h2a2 2 0 0 1 0 4h-2M7 3v2M10 3v2\"/>"),
  "Supernatural": svg("<path d=\"M5 21V11a7 7 0 0 1 14 0v10l-3-2-2 2-2-2-2 2-2-2z\"/><path d=\"M9.5 11h.01M14.5 11h.01\"/>"),
  "Mystery": svg("<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17h.01\"/>"),
  "Suspense": svg("<path d=\"M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/>"),
  "Sports": svg("<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18\"/>"),
  "School": svg("<path d=\"M2 9l10-5 10 5-10 5zM6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.5\"/>"),
  "Seinen": svg("<rect x=\"3\" y=\"7\" width=\"18\" height=\"13\" rx=\"2\"/><path d=\"M9 7V5h6v2M3 13h18\"/>"),
  "Shoujo": svg("<path d=\"M12 12L5 7v10zM12 12l7-5v10z\"/><circle cx=\"12\" cy=\"12\" r=\"1.5\"/>"),
  "Horror": svg("<path d=\"M12 3a8 8 0 0 0-8 8c0 2.5 1 4 3 5v4h10v-4c2-1 3-2.5 3-5a8 8 0 0 0-8-8z\"/><path d=\"M9 11h.01M15 11h.01M10 20v-3M14 20v-3\"/>"),
  "Mecha": svg("<rect x=\"5\" y=\"8\" width=\"14\" height=\"11\" rx=\"2\"/><path d=\"M12 8V4M9 13h.01M15 13h.01M9 16h6M3 12v3M21 12v3\"/>"),
  "Historical": svg("<path d=\"M3 21h18M5 21V10M9 21V10M15 21V10M19 21V10M3 10l9-6 9 6z\"/>"),
  "Super-Power": svg("<path d=\"M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z\"/>"),
  "Magic": svg("<path d=\"M12 2l2 6 6 2-6 2-2 6-2-6-6-2 6-2z\"/>"),
  "Mythology": svg("<path d=\"M12 21V8M6 4v5a6 6 0 0 0 12 0V4M12 3v5\"/>"),
  "Military": svg("<circle cx=\"12\" cy=\"12\" r=\"7\"/><path d=\"M12 2v6M12 16v6M2 12h6M16 12h6\"/>"),
  "Ecchi": svg("<path d=\"M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z\"/>"),
  "Harem": svg("<circle cx=\"9\" cy=\"8\" r=\"3\"/><circle cx=\"17\" cy=\"9\" r=\"2.5\"/><path d=\"M3 20a6 6 0 0 1 12 0M15 20a5 5 0 0 1 6-4.5\"/>"),
  "Adult-Cast": svg("<circle cx=\"12\" cy=\"8\" r=\"4\"/><path d=\"M4 21a8 8 0 0 1 16 0\"/>"),
  "Gourmet": svg("<path d=\"M6 3v8a2 2 0 0 0 2 2v8M10 3v8M6 7h4M17 21V3c-2 1-3.5 4-3.5 8h3.5\"/>"),
  "Music": svg("<path d=\"M9 18V5l11-2v13\"/><circle cx=\"6\" cy=\"18\" r=\"3\"/><circle cx=\"17\" cy=\"16\" r=\"3\"/>"),
  "Space": svg("<circle cx=\"12\" cy=\"12\" r=\"5\"/><ellipse cx=\"12\" cy=\"12\" rx=\"10\" ry=\"3.5\" transform=\"rotate(-25 12 12)\"/>"),
  "Detective": svg("<circle cx=\"11\" cy=\"11\" r=\"7\"/><path d=\"M21 21l-5-5\"/>"),
  "Time-Travel": svg("<path d=\"M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 8v4l3 2\"/>"),
  "Vampire": svg("<path d=\"M20 14a8 8 0 1 1-10-10 6.5 6.5 0 0 0 10 10z\"/>"),
  "Cyberpunk": svg("<rect x=\"6\" y=\"6\" width=\"12\" height=\"12\" rx=\"2\"/><rect x=\"10\" y=\"10\" width=\"4\" height=\"4\"/><path d=\"M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4\"/>")
};
const GENRE_ALL = svg('<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>');
const GENRE_CARET = svg('<path d="M6 9l6 6 6-6"/>');
const AR_SECS = [['latest', 'آخر الإضافات'], ['POPULARITY', 'الأكثر شعبية'], ['HIGHEST_RATE', 'الأعلى تقييماً'], ['AIRING', 'يُعرض حالياً'], ['MANGA', 'مانجا'], ['DUB', 'مدبلج']];
const AR_TYPES = [['SERIES', 'مسلسلات'], ['MOVIE', 'أفلام'], ['OVA', 'OVA'], ['SPECIAL', 'خاصة']];
const AR_PAGE = 90;
const AF = { sec: 'latest', genre: '', type: 'SERIES', list: [], seen: newSeen(), off: 0, busy: false, done: false, token: 0, pg: { a4: 1, wit: 1, sd: 1, dub: 1 } };

function arQuery() {
  const base = { limit: AR_PAGE, from: AF.off };
  if (AF.genre) return { ...base, filterType: 'GENRE', filterData: AF.genre, type: AF.type };
  if (AF.sec === 'latest') return AF.type === 'SERIES' ? { ...base, latest: true } : { ...base, type: AF.type };
  if (AF.sec === 'AIRING') return { ...base, filterType: 'STATUS', filterData: 'AIRING', type: AF.type };
  return { ...base, filterType: 'SORT', filterData: AF.sec, type: AF.type };
}

/* ===== شارة «الحلقة N» على كل كارط فـ «آخر الإضافات»: رقم آخر حلقة فقط ===== */
const fmtEp = (n) => (Number.isInteger(n) ? String(n) : String(n));
function setEpBadge(m, n) {
  m.lastEp = String(n);
  document.querySelectorAll('#agrid .card').forEach((c) => {
    if (c.dataset.id !== m.id) return;
    let b = c.querySelector('.epb');
    if (!b) { b = document.createElement('span'); b.className = 'epb'; c.prepend(b); }
    b.textContent = 'الحلقة ' + n;
  });
}
async function lastEpOf(m) {
  const id = String(m.id);
  if (m.lastEp) return m.lastEp;
  const cache = store.get('lastEp', {}), hit = cache[id];
  if (hit && Date.now() - hit.t < 10 * 60e3) return hit.n;
  let eps = [];
  if (id.startsWith('wit:')) eps = await witEpisodes(id).catch(() => []);
  else if (/^\d+$/.test(id)) eps = await window.api.ar.episodes(id).catch(() => []);
  else return '';
  const nums = eps.map((e) => parseFloat(e.num)).filter((n) => !isNaN(n));
  if (!nums.length) return '';
  const n = fmtEp(Math.max(...nums));
  cache[id] = { t: Date.now(), n }; const ks = Object.keys(cache); if (ks.length > 300) delete cache[ks[0]];
  store.set('lastEp', cache);
  return n;
}
async function hydrateEps(list, tk) {
  const todo = list.filter((m) => !m.lastEp && /^(wit:|\d+$)/.test(String(m.id)));
  const worker = async () => {
    while (todo.length) {
      const m = todo.shift(); if (tk !== AF.token) return;
      try { const n = await lastEpOf(m); if (n && tk === AF.token) setEpBadge(m, n); } catch {}
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

/* ===== صفحات «آخر الإضافات» من المصادر (كل مرة صفحة جديدة باش نجيبو أكبر عدد) ===== */
async function a4LatestPage(p) {
  for (const u of (p === 1 ? ['episode/', ''] : [`episode/page/${p}/`])) { try { const l = a4Cards(await a4Html(u)); if (l.length) return l; } catch {} }
  return [];
}
async function witLatestPage(p) { try { return witCards(await witHtml(p === 1 ? 'episode' : `episode/page/${p}/`)); } catch { return []; } }
async function sdLatestPage(p) { try { return ((await window.api.sd.catalog({ type: 'series', skip: (p - 1) * 30, limit: 30 })) || []).map(sdToM); } catch { return []; } }
/* ===== Anime4up: المدبلج (كروت الأنمي) ===== */
function a4AnimeCards(doc) {
  const out = [], seen = new Set();
  const add = (c, a) => {
    const href = a4Abs(a.getAttribute('href')); if (!href || !/\/anime\//.test(href) || seen.has(href)) return;
    const img = c.querySelector('img');
    const name = a4Clean(a.textContent || a.getAttribute('title') || (img && img.getAttribute('alt')) || ''); if (!name) return;
    seen.add(href);
    const m = { id: 'a4:' + encodeURIComponent(href), name, nameEn: '', poster: a4Img(c), genres: '', score: '', synopsis: '', type: 'مدبلج', status: '', season: '', src: 'a4', a4Url: href, a4Ep: '' };
    arCache.set(m.id, m); out.push(m);
  };
  doc.querySelectorAll('.anime-card-container, article, .anime-card').forEach(c => {
    const a = c.querySelector('h3 a') || c.querySelector('.anime-card-title a') || c.querySelector('a[href*="/anime/"]');
    if (a) add(c, a);
  });
  if (!out.length) doc.querySelectorAll('a[href*="/anime/"]').forEach(a => { if (a.querySelector('img')) add(a, a); });
  return out;
}
let a4DubUrl = null;
async function a4DubPage(p) {
  try {
    if (a4DubUrl === null) {
      a4DubUrl = '';
      const home = await a4Html('');
      const a = [...home.querySelectorAll('a')].find(x => /مدبلج/.test(x.textContent || '') && x.getAttribute('href') && !/^#|javascript:/i.test(x.getAttribute('href')));
      a4DubUrl = a ? a4Abs(a.getAttribute('href')) : '';
    }
    if (a4DubUrl) {
      const base = a4DubUrl.replace(/\/+$/, '').replace(/\/page\/\d+$/, '');
      const l = a4AnimeCards(await a4Html(p === 1 ? a4DubUrl : base + '/page/' + p + '/'));
      if (l.length) return l;
    }
    if (p === 1) return a4AnimeCards(await a4Html('?search_param=animes&s=' + encodeURIComponent('مدبلج')));
  } catch {}
  return [];
}

async function arMore(reset) {
  if (AF.busy || (AF.done && !reset)) return;
  if (reset) { AF.list = []; AF.seen = newSeen(); AF.off = 0; AF.done = false; AF.token++; AF.pg = { a4: 1, wit: 1, sd: 1, dub: 1 }; }
  const tk = AF.token; AF.busy = true;
  const box = $('#agrid'), btn = $('#amore'), cnt = $('#acount');
  if (!box) { AF.busy = false; return; }
  btn.textContent = 'جارٍ التحميل…'; btn.disabled = true;
  if (reset) box.innerHTML = '<p class="mute">جارٍ التحميل…</p>';
  try {
    let fresh = [];
    if (AF.sec === 'DUB' && !AF.genre) {                          // مدبلج: Stardima + Anime4up (صفحات)
      const N = 90, p = AF.pg.dub++;
      const [sdl, a4d] = await Promise.all([
        sdBatch(AF.off, N).catch((e) => { AF.sdErr = errMsg(e); return []; }),
        AF.type === 'SERIES' ? a4DubPage(p).catch(() => []) : []
      ]);
      if (tk !== AF.token) return;
      if (sdl.length) AF.sdErr = '';
      AF.off += sdl.length;
      if (sdl.length < N && !a4d.length) AF.done = true;
      fresh = dedupe([...sdl, ...a4d], AF.seen);
    } else if (AF.sec === 'SEASON' && !AF.genre) {                       // أنمي الموسم: من WitAnime فقط (صفحة واحدة)
      fresh = dedupe(await witSeason(), AF.seen); AF.done = true;
    } else {
      const lat = !AF.genre && AF.sec === 'latest' && AF.type === 'SERIES';
      for (let tries = 0; tries < 4 && !fresh.length; tries++) {   // إذا الدفعة كلها مكررة نجيب اللي بعدها
        if (lat) {                                               // الترتيب: Anime4up ← WitAnime ← Animeify ← Stardima
          const pg = AF.pg, pages = pg.a4 === 1 ? [0, 1] : [0];     // أول مرة: صفحتين من كل مصدر
          const [a4l, wl, r, sdl] = await Promise.all([
            Promise.all(pages.map(i => a4LatestPage(pg.a4 + i))).then(x => x.flat()),
            Promise.all(pages.map(i => witLatestPage(pg.wit + i))).then(x => x.flat()),
            window.api.ar.list(arQuery()).catch(() => []),
            Promise.all(pages.map(i => sdLatestPage(pg.sd + i))).then(x => x.flat())
          ]);
          if (tk !== AF.token) return;
          pg.a4 += pages.length; pg.wit += pages.length; pg.sd += pages.length; AF.off += r.length;
          if (!a4l.length && !wl.length && !r.length && !sdl.length) { AF.done = true; break; }
          fresh = dedupe([...a4l, ...wl, ...r, ...sdl], AF.seen);
        } else {
          const r = await window.api.ar.list(arQuery());
          if (tk !== AF.token) return;
          if (!r.length) { AF.done = true; break; }
          AF.off += r.length;
          fresh = dedupe(r, AF.seen);
        }
      }
      if (!fresh.length) AF.done = true;
    }
    if (tk !== AF.token) return;
    if (reset && AF.sec === 'latest' && !AF.genre && AF.type === 'SERIES') { flagNew(fresh.filter(m => !['custom', 'sd', 'a4'].includes(m.src))); markKnown(fresh); }
    AF.list.push(...fresh);
    if (reset && fresh.length) box.innerHTML = '';
    box.insertAdjacentHTML('beforeend', fresh.map(arCard).join(''));
    if (!AF.list.length) box.innerHTML = '<p class="mute">' + (AF.sec === 'DUB' ? 'لم نجد أنمي مدبلجاً حالياً. ' + (AF.sdErr ? 'خطأ Stardima: ' + AF.sdErr : '(Stardima رجّع نتيجة فارغة) — تأكد من الإنترنت.') : 'لا توجد نتائج لهذا الفلتر.') + '</p>';
    bindCards();
    if (AF.sec === 'latest' && !AF.genre && AF.type === 'SERIES') hydrateEps(fresh, tk);
    cnt.textContent = AF.list.length + ' أنمي' + (AF.sec === 'DUB' && AF.sdErr ? ' · Stardima: ' + AF.sdErr : '');
  } catch (e) { if (tk === AF.token) box.insertAdjacentHTML('beforeend', '<p class="mute">خطأ: ' + esc(errMsg(e)) + '</p>'); }
  finally {
    AF.busy = false;
    if (tk === AF.token) { btn.disabled = false; btn.textContent = AF.done ? 'لا يوجد المزيد' : 'تحميل المزيد'; btn.classList.toggle('hide', AF.done); }
  }
}

async function arLoadCatalog(search) {
  setNav('nHome');
  if (search) {
    say('جارٍ البحث…');
    try {
      const nq = normT(search);
      const [a, w, cu] = await Promise.all([window.api.ar.search(search).catch(() => []), witSearch(search), customList().then(l => l.filter(m => keysOf(m).some(k => k.includes(nq))))]);
      const r = dedupe([...cu, ...a, ...w], newSeen());
      view.innerHTML = `<div class="sec"><h3>نتائج: ${esc(search)} (${r.length})</h3>` + (r.length ? arGrid(r) : '<p class="mute">لا توجد نتائج.</p>') + '</div>';
      bindCards();
    } catch (e) { say('خطأ: ' + errMsg(e)); }
    return;
  }
  const chips = (arr, cur, attr) => arr.map(([v, n]) => `<button class="chip${v === cur ? ' on' : ''}" data-${attr}="${esc(v)}">${CHIP_ICONS[v] || ''}${esc(n)}</button>`).join('');
  view.innerHTML = `<div class="sec"><div class="fbar">
      <div class="chips" id="fsec">${chips(AR_SECS, AF.genre ? '' : AF.sec, 'sec')}</div>
      <div class="chips" id="ftype">${chips(AR_TYPES, AF.type, 'type')}</div>
      <div class="gsel" id="fgenre"><button type="button" class="chip gbtn" id="gbtn"></button><div class="gpanel hide" id="gpanel"></div></div>
      <span class="mute" id="acount"></span></div>
    <div class="grid" id="agrid"></div>
    <div style="text-align:center;margin-top:26px"><button class="primary" id="amore">تحميل المزيد</button></div></div>`;
  $('.wrap').classList.add('hh'); view.scrollTop = 0; $('header').classList.remove('solid');
  const syncChips = () => {
    view.querySelectorAll('#fsec .chip').forEach(c => c.classList.toggle('on', !AF.genre && c.dataset.sec === AF.sec));
    view.querySelectorAll('#ftype .chip').forEach(c => c.classList.toggle('on', c.dataset.type === AF.type));
  };
  view.querySelectorAll('#fsec .chip').forEach(c => c.onclick = () => { if (c.dataset.sec === 'MANGA') return openManga(); AF.sec = c.dataset.sec; AF.genre = ''; $('#fgenre').value = ''; syncChips(); arMore(true); });
  view.querySelectorAll('#ftype .chip').forEach(c => c.onclick = () => { AF.type = c.dataset.type; syncChips(); arMore(true); });
  { // قائمة التصنيفات بأيقونات SVG (بدل select)
    const gs = $('#fgenre'), gb = $('#gbtn'), gp = $('#gpanel');
    const paint = () => {
      const cur = AR_GENRES.find(([, v]) => v === AF.genre);
      gb.innerHTML = (cur ? GENRE_ICONS[cur[1]] : GENRE_ALL) + '<span>' + esc(cur ? cur[0] : 'كل التصنيفات') + '</span>' + GENRE_CARET;
      gb.classList.toggle('on', !!AF.genre);
      gp.innerHTML = [['', 'كل التصنيفات']].concat(AR_GENRES.map(([n, v]) => [v, n])).map(([v, n]) => `<button type="button" class="gi${v === AF.genre ? ' on' : ''}" data-g="${esc(v)}">${v ? GENRE_ICONS[v] : GENRE_ALL}<span>${esc(n)}</span></button>`).join('');
    };
    Object.defineProperty(gs, 'value', { get: () => AF.genre, set: (v) => { AF.genre = v || ''; paint(); } });
    paint();
    gb.onclick = (e) => { e.stopPropagation(); gp.classList.toggle('hide'); };
    gp.onclick = (e) => { const b = e.target.closest('.gi'); if (!b) return; AF.genre = b.dataset.g; paint(); gp.classList.add('hide'); syncChips(); arMore(true); };
    if (!window._gOut) { window._gOut = 1; document.addEventListener('click', (e) => { const p = $('#gpanel'); if (p && !e.target.closest('#fgenre')) p.classList.add('hide'); }); }
  }
  $('#amore').onclick = () => arMore();
  if (window.IntersectionObserver) {   // تحميل تلقائي عند الوصول لآخر القائمة
    const ab = $('#amore');
    const io = new IntersectionObserver(async (es) => {
      if (!document.body.contains(ab)) { io.disconnect(); return; }
      if (es[0].isIntersecting && !AF.busy && !AF.done) { await arMore(); io.unobserve(ab); io.observe(ab); }
    }, { root: view, rootMargin: '700px' });
    io.observe(ab);
  }
  await arMore(true);
  buildHomeHero();
}

async function arDetails(id) {
  if (arCache.has(id)) return arCache.get(id);
  for (const type of ['SERIES', 'MOVIE']) {
    const r = await window.api.ar.list({ filterType: 'SEARCH', filterData: id, type, limit: 10 }).catch(() => []);
    const m = r.find(x => x.id === id) || r[0];
    if (m) { arCache.set(id, m); return m; }
  }
  return { id, name: id, nameEn: '', poster: '', genres: '', score: '', synopsis: '' };
}

/* ===== إشعارات الحلقات الجديدة (للأنمي المستمر في المفضلة وآخر ما شاهدته) ===== */
function noteEps(id, name, latest, aired, mode) {
  const st = store.get('epSeen', {}), cur = st[id];
  st[id] = { n: Math.max(latest || 0, cur ? cur.n : 0), al: Math.max(aired || 0, cur ? cur.al : 0) };
  const ks = Object.keys(st); if (ks.length > 200) delete st[ks[0]];
  store.set('epSeen', st);
  if (!cur || mode === 'silent' || !notifyOn) return;
  let body = '';
  if (latest > cur.n) body = 'الحلقة ' + latest + ' متوفرة الآن';
  else if (aired > cur.al && aired > latest) body = 'الحلقة ' + aired + ' عُرضت — الروابط قريباً';
  if (!body) return;
  if (mode !== 'page') toast(name + ': ' + body);
  if (mode !== 'page' || !document.hasFocus()) window.api.notify({ title: name, body, id }).catch(() => {});
}
async function watchNew() {
  if (!notifyOn) return;
  const ids = [...new Set([...store.get('fav', []), ...store.get('hist', []).slice(0, 10)].filter(x => x && x.type === 'ar').map(x => x.id))].filter(id => !/^(custom|sd|a4):/.test(String(id))).slice(0, 20);
  for (const id of ids) {
    try {
      const isWit = String(id).startsWith('wit:');
      const m = isWit ? await witDetails(id) : await arDetails(id);
      const eps = isWit ? await witEpisodes(id) : await window.api.ar.episodes(id).catch(() => []);
      const al = null;
      const nums = eps.map(e => parseFloat(e.num)).filter(n => !isNaN(n));
      noteEps(id, m.name, nums.length ? Math.max(...nums) : 0, al ? al.aired : 0);
    } catch {}
    await new Promise(r => setTimeout(r, 1500));
  }
}
/* شخصيات الأنمي (من AniList) فـ الهيرو تحت الأزرار */
async function loadChars(alId, animeId) {
  const box = $('#chars'); if (!box || !alId) return;
  try {
    const cache = store.get('chars2', {}), hit = cache[animeId];
    let list = hit && Date.now() - hit.t < 7 * 864e5 ? hit.v : null;
    if (!list) {
      list = await window.api.anilistChars(alId);
      cache[animeId] = { t: Date.now(), v: list };
      const ks = Object.keys(cache); if (ks.length > 60) delete cache[ks[0]];
      store.set('chars2', cache);
    }
    if (!box.isConnected || !list.length) return;
    box.innerHTML = list.slice(0, 4).map((c, i) => `<div class="ch${c.role === 'MAIN' ? ' main' : ''}" data-i="${i}" tabindex="0" title="${esc(c.name)}"><img loading="lazy" src="${esc(c.img)}" alt=""><b>${esc(c.name)}</b><small>${c.role === 'MAIN' ? 'رئيسية' : 'ثانوية'}</small></div>`).join('');
    const sh = list.slice(0, 4);
    box.querySelectorAll('.ch').forEach(el => { const go = () => showChar(sh[el.dataset.i]); el.onclick = go; el.onkeydown = (e) => e.key === 'Enter' && go(); });
  } catch {}
}
/* ===== نافذة صغيرة: معلومات الشخصية ===== */
const GEN_AR = { Male: 'ذكر', Female: 'أنثى', 'Non-binary': 'غير ثنائي' };
function showChar(c) {
  if (!c || document.querySelector('.chov')) return;
  const rows = [['الدور', c.role === 'MAIN' ? 'رئيسية' : 'ثانوية'], ['الجنس', GEN_AR[c.gender] || c.gender], ['العمر', c.age], ['تاريخ الميلاد', c.bday], ['فصيلة الدم', c.blood], ['المفضلة', c.fav ? c.fav.toLocaleString('en') : '']].filter(r => r[1]);
  const ov = document.createElement('div'); ov.className = 'chov';
  ov.innerHTML = `<div class="chbox" role="dialog" aria-modal="true"><button class="abx" aria-label="إغلاق">${svg('<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>')}</button><div class="chtop"><img src="${esc(c.img)}" alt=""><div><h3>${esc(c.name)}</h3>${c.native ? `<small dir="ltr">${esc(c.native)}</small>` : ''}</div></div><div class="chtags">${rows.map(r => `<span><small>${esc(r[0])}</small><b>${esc(r[1])}</b></span>`).join('')}</div><p class="chdesc mute">${c.desc ? 'جارٍ الترجمة…' : 'لا توجد معلومات عن هذه الشخصية.'}</p></div>`;
  const done = () => { document.removeEventListener('keydown', onKey, true); ov.classList.add('out'); setTimeout(() => ov.remove(), 150); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(); } };
  ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('.abx')) done(); });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(ov);
  ov.querySelector('.abx').focus();
  if (c.desc) {
    const p = ov.querySelector('.chdesc');
    (async () => {
      let t = c.desc;
      try { if (!/[\u0600-\u06FF]/.test(t)) t = await window.api.translate(t); } catch {}
      if (p.isConnected) { p.textContent = t; p.classList.remove('mute'); }
    })();
  }
}
let epTimer = null, epRefresh = null;
window.addEventListener('focus', () => { if (epRefresh) epRefresh(); });
/* ===== AniList: نجيبو عدد الحلقات، نقارنوه مع لي عندنا، ونزيدو الناقصين ===== */
const alNorm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, '');
const alSame = (a, b) => { if (!a || !b) return false; if (a === b) return true; const [s, l] = a.length < b.length ? [a, b] : [b, a]; return s.length >= 6 && l.includes(s) && s.length / l.length >= 0.7; };
async function anilistEps(m, force) {
  const cache = store.get('al', {}), hit = cache[m.id];
  if (!force && hit && Date.now() - hit.t < 30 * 60e3) return hit.v;
  const names = [m.nameEn, m.name].filter(Boolean);
  const want = names.map(alNorm).filter(Boolean);
  if (!want.length) return null;
  let a = null;
  for (const n of names) {
    const list = await window.api.anilist(n).catch(() => []);
    a = list.find(x => [x.title && x.title.romaji, x.title && x.title.english, x.title && x.title.native, ...(x.synonyms || [])].map(alNorm).some(t => want.some(w => alSame(t, w))));
    if (a) break;
  }
  if (!a) return null;
  const next = a.nextAiringEpisode || null;
  const aired = next ? next.episode - 1 : (a.status === 'NOT_YET_RELEASED' ? 0 : (a.episodes || 0));
  const v = { id: a.id, aired, total: a.episodes || 0, next, status: a.status };
  cache[m.id] = { t: Date.now(), v };
  const ks = Object.keys(cache); if (ks.length > 150) delete cache[ks[0]];
  store.set('al', cache);
  return v;
}
function mergeAl(eps, al) {
  return { eps, added: 0 };   // لا نعتمد على AniList في الحلقات: نعرض فقط الحلقات اللي لها روابط فعلية
  if (!al) return { eps, added: 0 };
  const nums = eps.map(e => parseFloat(e.num)).filter(n => !isNaN(n));
  const max = nums.length ? Math.max(...nums) : 0;
  if (max > al.aired + 2) return { eps, added: 0 };      // ترقيم مختلف (مثلاً مطلق) → ما نخلطوش
  const have = new Set(nums), out = eps.slice(); let added = 0;
  for (let n = 1; n <= Math.min(al.aired, 400); n++) if (!have.has(n)) { out.push({ num: String(n), missing: true }); added++; }
  if (al.next && !have.has(al.next.episode)) { out.push({ num: String(al.next.episode), missing: true, upcoming: true, at: al.next.airingAt }); added++; }
  if (out.every(e => !isNaN(parseFloat(e.num)))) out.sort((a, b) => parseFloat(a.num) - parseFloat(b.num));
  return { eps: out, added };
}

/* ===== أجزاء الأنمي + أنميات مشابهة (AniList) تحت الحلقات — كنبحثو عليهم فالمصادر وكنعرضو غير اللي موجودين ===== */
const relFound = new Map();
async function relFind(x) {
  if (relFound.has(x.id)) return relFound.get(x.id);
  const qs = [...new Set([x.title, ...(x.alt || [])].filter(Boolean))].slice(0, 3);
  const want = qs.map(normT).filter(Boolean);
  let hit = null;
  for (const q of qs) {
    try {
      const res = dedupe([...(await window.api.ar.search(q).catch(() => [])), ...(await witSearch(q).catch(() => []))], newSeen());
      res.forEach((y) => arCache.set(y.id, y));
      hit = res.find((y) => keysOf(y).some((k) => want.some((w) => k === w || (Math.min(k.length, w.length) >= 5 && (k.includes(w) || w.includes(k)))))) || null;
    } catch {}
    if (hit) break;
  }
  relFound.set(x.id, hit);
  return hit;
}
async function loadRelated(m) {
  let r = [];
  try { r = await window.api.anilistRelated([m.nameEn, m.name].filter(Boolean)); } catch {}
  const box = $('#rel'); if (!box) return;
  if (!r.length) { box.remove(); return; }
  r = r.slice(0, 18);
  const res = new Array(r.length).fill(undefined);       // undefined = لسا كنقلبو، null = ما كايناش، كائن = كاين
  box.innerHTML = '<h3 class="relh">أجزاء وأنميات مشابهة</h3><div class="relrow" id="relrow"></div><p class="mute" id="relst">جارٍ البحث عنهم فالمصادر…</p>';
  const paint = () => {
    const row = $('#relrow'); if (!row) return;
    row.innerHTML = r.map((x, i) => res[i] ? `<div class="rcard" tabindex="0" data-i="${i}"><span class="rk ${x.kind}">${esc(x.rel)}</span><img loading="lazy" src="${esc(res[i].poster || x.cover)}" alt=""><p>${esc(res[i].name || x.title)}</p></div>` : '').join('');
    row.querySelectorAll('.rcard').forEach((el) => {
      const go = () => { const h = res[el.dataset.i]; if (h) openAr(h.id); };
      el.onclick = go; el.onkeydown = (e) => e.key === 'Enter' && go();
      const im = el.querySelector('img'); im.onerror = () => { const x = r[el.dataset.i]; if (x.cover && im.src !== x.cover) im.src = x.cover; };
    });
  };
  const q = r.map((x, i) => i);
  const worker = async () => {
    while (q.length) {
      const i = q.shift();
      try { res[i] = await relFind(r[i]); } catch { res[i] = null; }
      if (!$('#rel')) return;
      if (res[i]) { paint(); const st = $('#relst'); if (st) st.remove(); }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  const b2 = $('#rel'); if (!b2) return;
  if (!res.some(Boolean)) b2.remove(); else { const st = $('#relst'); if (st) st.remove(); }
}

async function openAr(id) {
  say('جارٍ التحميل…');
  try {
    const isWit = String(id).startsWith('wit:'), isCustom = String(id).startsWith('custom:'), isSd = String(id).startsWith('sd:'), isA4 = String(id).startsWith('a4:');
    if (isCustom && !arCache.has(id)) await customList();
    const m = isCustom ? arCache.get(id) : isWit ? await witDetails(id) : isSd ? await sdDetails(id) : isA4 ? arCache.get(id) : await arDetails(id);
    if (!m) throw new Error('هذا الأنمي لم يعد موجوداً في custom.json');
    let eps = [], witP = null, alAdded = 0, alInfo = null;
    const alP = (isCustom || isSd || isA4) ? null : anilistEps(m).catch(() => null);   // بالتوازي مع جلب الحلقات
    if (isCustom) eps = m.episodes.map((e, i) => ({ num: String(e.num ?? i + 1), custom: e }));
    else if (isSd) eps = sdEpisodes(m);
    else if (isA4) eps = await a4Eps(m);
    else if (isWit) eps = (await witEpisodes(id)).map(e => ({ num: e.num, wit: e.url }));
    else {
      witP = witMatch(m).then(w => (w ? witEpisodes(w.id) : [])).catch(() => []);   // نفس الأنمي في WitAnime (إن وُجد) — بالتوازي مع Animeify
      eps = await window.api.ar.episodes(id).catch(() => []);
      if (!eps.length) eps = (await witP).map(e => ({ num: e.num, wit: e.url }));
    }
    const seen = new Set(store.get('seen', {})[m.id] || []);
    const key = (e) => m.id + ':' + e.num;
    let selNum = null;
    const epsInner = () => `${false ? `<p class="mute alnote">AniList: ${esc(alInfo.aired)} حلقة معروضة${alInfo.total ? ' من ' + esc(alInfo.total) : ''}${alAdded ? ` · أُضيفت ${esc(alAdded)} حلقة ناقصة (بدون روابط بعد)` : ' · كل الحلقات موجودة'}</p>` : ''}${eps.length ? `<div class="eps">${eps.map((e, i) => `<button data-i="${i}" class="${seen.has(key(e)) ? 'seen' : ''}${e.num === selNum ? ' on' : ''}${e.missing ? ' miss' : ''}${e.upcoming ? ' up' : ''}"${e.missing ? ` title="${e.upcoming ? 'تُعرض ' + esc(new Date(e.at * 1000).toLocaleString('ar')) : 'لا توجد روابط لهذه الحلقة بعد'}"` : ''}>${esc(e.num)}</button>`).join('')}</div>` : '<p class="mute">لا توجد حلقات متاحة حالياً.</p>'}`;
    const gen = arOk(m.genres) ? String(m.genres).split(',').slice(0, 4).join(' · ') : '';
    view.innerHTML = `<div class="hero" style="background-image:url('assets/hero-bg.jpg')"><div class="hwrap">${m.poster ? `<img class="hposter" src="${esc(m.poster)}" alt="" onerror="this.style.display='none'">` : ''}<div class="htext"><h2>${esc(m.name)}</h2><p class="sub">${esc([m.nameEn, gen].filter(Boolean).join(' · '))}</p><div class="acts"><button class="ghost" id="watch">${I.playc} شاهد الآن</button><button class="ghost" id="fav"></button></div>${arOk(m.score) ? `<div class="hmeta"><b>${esc(m.score)}</b>${arOk(m.season) ? `<span>${esc(m.season)}</span>` : ''}${arOk(m.status) ? `<span>${esc(m.status)}</span>` : ''}</div>` : ''}<div class="chars" id="chars"></div></div></div></div>`
      + `<div class="sec"><div class="tabs"><button class="on" data-t="eps">الحلقات</button><button data-t="ds">الوصف</button></div>`
      + `<div id="t_eps"><div id="epsbox">${epsInner()}</div><div id="out"></div></div>`
      + `<div id="t_ds" class="hide"><p class="mute" id="desc">${esc(arOk(m.synopsis) ? m.synopsis : 'لا يوجد وصف.')}</p></div></div>`;
    view.insertAdjacentHTML('beforeend', '<div class="sec" id="rel"></div>');
    loadRelated(m);
    $('.wrap').classList.add('hh'); view.scrollTop = 0; $('header').classList.remove('solid');
    if (translateOn && arOk(m.synopsis) && !/[\u0600-\u06FF]/.test(m.synopsis)) translateDesc({ id: m.id, description: m.synopsis });
    if (!isCustom) { const nn = eps.filter(e => !e.missing).map(e => parseFloat(e.num)).filter(n => !isNaN(n)); noteEps(m.id, m.name, nn.length ? Math.max(...nn) : 0, 0, 'silent'); }
    if (alP) alP.then(a => { if (a && a.id && $('#chars')) { alInfo = a; loadChars(a.id, m.id); } }).catch(() => {});   // فـ الخلفية: ما نبطّؤوش فتح الصفحة
    if (!arOk(m.synopsis)) fillDescFromMal(m);   // \u0645\u0627 \u0641\u064A\u0647 \u0648\u0635\u0641 \u0645\u0646 \u0627\u0644\u0645\u0635\u062F\u0631 \u2192 \u0646\u062C\u064A\u0628\u0648 \u0645\u0646 MyAnimeList
    const fp = () => ($('#fav').innerHTML = isFavId(m.id) ? starSvg(true) + ' في المفضلة' : I.plus + ' أضف للمفضلة');
    fp();
    $('#fav').onclick = () => { toggleFav({ id: m.id, type: 'ar', name: m.name, poster: m.poster }); fp(); };
    view.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
      view.querySelectorAll('.tabs button').forEach(x => x.classList.remove('on')); b.classList.add('on');
      $('#t_eps').classList.toggle('hide', b.dataset.t !== 'eps'); $('#t_ds').classList.toggle('hide', b.dataset.t !== 'ds');
    });
    const bindEps = () => view.querySelectorAll('.eps button').forEach(b => b.onclick = async () => {
      const e = eps[b.dataset.i]; selNum = e.num;
      if (e.missing) {   // حلقة من AniList ما لقيناش ليها روابط
        view.querySelectorAll('.eps button').forEach(x => x.classList.remove('on')); b.classList.add('on');
        $('#out').innerHTML = `<p class="mute">${e.upcoming ? 'الحلقة ' + esc(e.num) + ' لم تُعرض بعد — ' + esc(new Date(e.at * 1000).toLocaleString('ar')) : 'الحلقة ' + esc(e.num) + ' موجودة في AniList لكن لم نجد لها روابط في المصادر حالياً.'}</p>`;
        return;
      }
      view.querySelectorAll('.eps button').forEach(x => x.classList.remove('on'));
      b.classList.add('on'); b.classList.add('seen');
      const s = store.get('seen', {}); s[m.id] = [...new Set([...(s[m.id] || []), key(e)])]; store.set('seen', s);
      const h = store.get('hist', []).filter(x => x.id !== m.id);
      store.set('hist', [{ id: m.id, type: 'ar', name: m.name, poster: m.poster }, ...h].slice(0, 40));
      cur = { type: 'ar', vid: '' };
      const out = $('#out'); out.innerHTML = '<p class="mute">جارٍ البحث عن مصادر…</p>';
      const witUrl = async () => e.wit || ((witP ? await witP : []).find(x => x.num === e.num) || {}).url;
      const btns = []; let left = 0, ready = false, note = '';
      chkQ.length = 0;   // نوقّفو فحص الحلقة السابقة
      const add = (o) => { o.st = o.chk ? 'wait' : 'ok'; btns.push(o); if (o.chk) queueCheck(o, () => draw()); };
      const draw = () => {
        if (!b.classList.contains('on')) return;
        const pend = btns.some(x => x.st === 'wait'), okAny = btns.some(x => x.st === 'ok');
        // كنبقاو غير السيرفرات اللي خدامين؛ اللي كيتعرضو غير فـ iframe كيبانو غير إلا ما بقا حتى واحد خدام
        const vis = btns.filter(x => x.st === 'ok' || x.st === 'wait' || (x.st === 'embed' && (window.api.platform === 'android' || (!okAny && !pend && !left))));
        if (!vis.length) {
          out.innerHTML = '<p class="mute">' + esc(left || pend ? 'جارٍ فحص السيرفرات…' : (note ? 'Stardima: ' + note : 'لم نجد أي سيرفر يعمل لهذه الحلقة حالياً. جرّب حلقة أخرى.')) + '</p>';
          return;
        }
        if (!ready || !out.querySelector('.streams')) { out.innerHTML = '<div class="streams"></div><div id="player"></div>'; ready = true; }
        const rank = (x) => (x.st === 'ok' ? 0 : x.st === 'wait' ? 100 : 200) + x.p;
        const list = vis.slice().sort((x, y) => rank(x) - rank(y)).slice(0, 40), st = out.querySelector('.streams');
        st.innerHTML = list.map((x, i) => `<div class="srow"><button data-i="${i}" class="${x.st === 'wait' ? 'chk' : ''}"><i class="sv ${x.st}"></i>${I.play} ${esc(x.t)}${x.st === 'embed' ? ' <small>iframe</small>' : ''}</button>${x.dl && x.st !== 'wait' ? `<button class="dlb" data-d="${i}" title="تحميل للمشاهدة بدون إنترنت">${DL_ICON}</button>` : ''}</div>`).join('') + (pend ? '<p class="mute" style="margin:4px 2px;font-size:12px">جارٍ فحص باقي السيرفرات…</p>' : '');
        st.querySelectorAll('button.dlb').forEach(db => db.onclick = () => startDl(list[db.dataset.d], m, e.num));
        st.querySelectorAll('button[data-i]').forEach(sb => sb.onclick = async () => {
          // إذا السيرفر ما خدمش، نجرّبو تلقائياً اللي موراه (حتى 6 سيرفرات)
          for (let i = +sb.dataset.i, k = 0; i < list.length && k < 6; i++, k++) {
            const bt = list[i];
            // السيرفرات الخدامة الأخرى كتبان فقائمة الجودة ديال المشغّل
            playCtx = { id: m.id, name: m.name, poster: m.poster, num: e.num, label: bt.t, cur: bt.t, curF: bt.f, alts: list.filter(x => x !== bt && x.st === 'ok').map(x => ({ t: x.t, f: x.f })) };
            const r = resumeGet(m.id); if (r && r.num === e.num && r.t > 10) pendingResume = r.t;
            if ((await bt.f()) !== false) return;
            if (i + 1 < list.length && k < 5) toast('هذا السيرفر لا يعمل — جارٍ تجربة التالي…');
          }
        });
      };
      const src = (p, fn) => { left++; Promise.resolve(p).then(fn).catch(() => {}).finally(() => { left--; draw(); }); };
      if (e.custom) (e.custom.urls || [{ name: 'رابط', url: e.custom.url }]).filter(u => u && u.url).forEach(u => add({ p: 1, chk: u.url, t: `${u.name || 'رابط'} · ${hostOf(u.url)}`, f: () => playWitLink(u.url), dl: () => window.api.host.resolve(u.url) }));
      src(e.raw ? window.api.ar.streams(e.raw) : [], ar => ar.forEach(x => add({ p: 0, t: `Mediafire · ${x.q}`, f: () => play({ url: x.url }), dl: async () => ({ url: x.url }) })));
      src(e.a4 ? a4Links(e.a4) : [], aq => aq.forEach(x => add({ p: 2, chk: x.url, t: `Anime4up · ${x.q || 'HD'} · ${x.host}`, f: () => playWitLink(x.url), dl: () => window.api.host.resolve(x.url) })));
      src(e.sd ? window.api.sd.streams(e.sd) : { streams: [] }, sq => { note = sq.note || ''; (sq.streams || []).forEach(x => add({ p: 3, chk: x.url, t: `Stardima · ${x.name}`, f: () => play({ url: x.url }), dl: async () => ({ url: x.url, type: x.type }) })); });
      src(witUrl().then(u => (u ? witQualities(u) : [])), wq => wq.forEach(g => g.links.forEach(l => add({ p: 4, chk: l, t: `WitAnime · ${g.q} · ${hostOf(l)}`, f: () => playWitLink(l), dl: () => window.api.host.resolve(l) }))));
    });
    bindEps();

    // تحديث تلقائي: كل 5 دقايق (وكي ترجع للنافذة) نسولو المصادر + AniList ونزيدو الحلقات الجديدة بلا ما نخرجو من الصفحة
    if (!isCustom && !isSd && !isA4) {
      clearInterval(epTimer);
      let lastEp = Date.now(), busy = false;
      const refresh = async () => {
        if (!$('#epsbox')) { clearInterval(epTimer); epRefresh = null; return; }
        if (busy) return; busy = true; lastEp = Date.now();
        try {
          let base;
          if (isWit) base = (await witEpisodes(id)).map(e => ({ num: e.num, wit: e.url }));
          else {
            base = await window.api.ar.episodes(id).catch(() => null);
            if (base === null) return;
            witP = witMatch(m).then(w => (w ? witEpisodes(w.id) : [])).catch(() => []);
            if (!base.length) base = (await witP).map(e => ({ num: e.num, wit: e.url }));
          }
          const al = null;
          const mg = mergeAl(base, al);
          const sig = (a) => a.map(e => e.num + (e.missing ? 'm' : 'a')).join(',');
          if (sig(mg.eps) === sig(eps) || !$('#epsbox')) return;
          const hadReal = new Set(eps.filter(e => !e.missing).map(e => e.num));
          const fresh = mg.eps.filter(e => !e.missing && !hadReal.has(e.num)).map(e => e.num);
          eps = mg.eps; if (al) alInfo = al; alAdded = mg.added;
          $('#epsbox').innerHTML = epsInner(); bindEps();
          if (fresh.length) toast(m.name + ': حلقة جديدة ' + fresh.join('، '));
          { const nn = eps.filter(e => !e.missing).map(e => parseFloat(e.num)).filter(n => !isNaN(n)); noteEps(m.id, m.name, nn.length ? Math.max(...nn) : 0, al ? al.aired : 0, 'page'); }
        } catch {} finally { busy = false; }
      };
      epRefresh = () => { if (Date.now() - lastEp > 60000) refresh(); };
      epTimer = setInterval(refresh, 5 * 60 * 1000);
    } else { clearInterval(epTimer); epRefresh = null; }
    $('#watch').onclick = () => { const b = view.querySelector('.eps button:not(.seen):not(.miss)') || view.querySelector('.eps button:not(.miss)'); b && b.click(); };
  } catch (e) { say('خطأ: ' + errMsg(e)); }
}


/* ===== هيرو الرئيسية: أنمي يتبدّل تلقائياً + وصف من MyAnimeList (Jikan) ===== */
const malClean = (t) => String(t || '').replace(/\[Written by[^\]]*\]/gi, '').replace(/\(Source:[^)]*\)/gi, '').replace(/\n{2,}/g, '\n').trim();
async function malInfo(m) {
  const cache = store.get('mal', {});
  if (cache[m.id] && cache[m.id].synopsis) return cache[m.id];
  let info = null;
  // 1) AniList (الأدق): نقارن العنوان باش ما نجيبوش وصف أنمي آخر
  try {
    const r = await window.api.anilistDesc([m.nameEn, m.name]);
    if (r && r.description) info = { score: r.score || '', synopsis: malClean(r.description).slice(0, 700), url: r.url || '' };
  } catch {}
  // 2) Jikan (MyAnimeList) كاحتياط، مع إعادة المحاولة عند 429 واختيار أحسن نتيجة مطابقة
  if (!info) {
    const names = [m.nameEn, m.name].filter(Boolean), want = names.map(alNorm).filter(Boolean);
    for (const q of names.slice(0, 2)) {
      let r = null;
      for (let k = 0; k < 2 && !r; k++) {
        try { r = await window.api.get('https://api.jikan.moe/v4/anime?limit=6&sfw=true&q=' + encodeURIComponent(q)); }
        catch (e) { if (k === 0 && /429/.test(errMsg(e))) await new Promise(ok => setTimeout(ok, 1500)); else break; }
      }
      const list = (r && r.data) || [];
      const a = list.find(x => [x.title, x.title_english, x.title_japanese, ...(x.title_synonyms || [])].map(alNorm).some(t => want.some(w => alSame(t, w)))) ;
      if (a && a.synopsis) { info = { score: a.score || '', synopsis: malClean(a.synopsis).slice(0, 700), url: a.url || '' }; break; }
    }
  }
  if (!info) throw new Error('not found');
  cache[m.id] = info;
  const ks = Object.keys(cache); if (ks.length > 120) delete cache[ks[0]];
  store.set('mal', cache);
  return info;
}
async function heroDesc(m, el, scEl) {
  try {
    const info = await malInfo(m);
    if (info.score && scEl) scEl.innerHTML = `<span class="mal">MAL</span><span class="sc">★ ${esc(info.score)}</span>`;
    let t = info.synopsis;
    if (!t) return;
    if (translateOn && !/[\u0600-\u06FF]/.test(t)) {
      const tr = store.get('tr', {}), k = 'mal:' + m.id;
      if (!tr[k]) { el.textContent = t; tr[k] = await window.api.translate(t); const ks = Object.keys(tr); if (ks.length > 150) delete tr[ks[0]]; store.set('tr', tr); }
      t = tr[k];
    }
    el.textContent = t;
  } catch { if (arOk(m.synopsis)) el.textContent = m.synopsis; }
}
// وصف لصفحة الأنمي لما المصدر ما يعطيش وصف: MyAnimeList (Jikan) + ترجمة للعربية
async function fillDescFromMal(m) {
  const el = $('#desc'); if (!el) return;
  el.textContent = 'جارٍ جلب الوصف…';
  try {
    const info = await malInfo(m);
    let t = info.synopsis;
    if (!t) throw new Error('empty');
    if (!el.isConnected) return;
    el.textContent = t;
    if (translateOn && !/[؀-ۿ]/.test(t)) {
      const tr = store.get('tr', {}), k = 'mal:' + m.id;
      if (!tr[k]) { tr[k] = await window.api.translate(t); const ks = Object.keys(tr); if (ks.length > 150) delete tr[ks[0]]; store.set('tr', tr); }
      if (el.isConnected) el.textContent = tr[k];
    }
  } catch { if (el.isConnected) el.textContent = 'لا يوجد وصف.'; }
}
let heroTimer = null;
function buildHomeHero() {
  clearInterval(heroTimer);
  const items = AF.list.filter(m => m.poster).slice(0, 6);
  if (!items.length || !view.querySelector('.sec')) return;
  const DUR = 8000;
  const box = document.createElement('div');
  box.className = 'hhero';
  const VID = 'assets/itachi.mp4';
  box.innerHTML = `<video class="hvid" src="${VID}" autoplay muted loop playsinline></video>` + items.map((m, i) => {
    const gen = arOk(m.genres) ? String(m.genres).split(',').slice(0, 3).join(' · ') : '';
    return `<div class="hslide" data-i="${i}"><div class="hbg" style="background-image:url('${esc(m.poster)}')"></div>
      <div class="hbody"><h2>${esc(m.name)}</h2><p class="sub">${esc([m.nameEn && m.nameEn !== m.name ? m.nameEn : '', gen].filter(Boolean).join(' · '))}</p>
      <div class="hmeta2"></div><p class="hdesc">${esc(arOk(m.synopsis) ? m.synopsis : '')}</p>
      <button class="hbtn" data-id="${esc(m.id)}">${I.play} شاهد الآن</button></div>
      <img class="hpost" src="${esc(m.poster)}" alt=""></div>`;
  }).join('') + `<div class="hdots" dir="rtl">${items.map((_, i) => `<button data-i="${i}" style="--d:${DUR}ms"><i></i></button>`).join('')}</div>`;
  const ann = document.createElement('div'); ann.className = 'hann'; ann.hidden = true;
  ann.innerHTML = '<b>' + svg('<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M16 8.5a5 5 0 0 1 0 7"/>') + 'إعلان</b><p dir="auto"></p>';
  box.appendChild(ann);
  const loadAnn = async () => {
    try {
      const t = await window.api.announce();
      if (!box.isConnected) return;
      ann.querySelector('p').textContent = t || '';
      ann.hidden = !t;
    } catch { ann.hidden = true; }
  };
  loadAnn();
  const annTimer = setInterval(() => { if (!box.isConnected) return clearInterval(annTimer); loadAnn(); }, 600000);
  view.insertBefore(box, view.firstChild);
  const slides = [...box.querySelectorAll('.hslide')], dots = [...box.querySelectorAll('.hdots button')];
  const loaded = new Set();
  let cur = -1, paused = false;
  const show = (i) => {
    cur = (i + items.length) % items.length;
    slides.forEach((s, k) => s.classList.toggle('on', k === cur));
    dots.forEach((d, k) => { d.classList.remove('on'); if (k === cur) { void d.offsetWidth; d.classList.add('on'); } });
    if (!loaded.has(cur)) { loaded.add(cur); const s = slides[cur]; heroDesc(items[cur], s.querySelector('.hdesc'), s.querySelector('.hmeta2')); }
  };
  box.querySelectorAll('.hbtn').forEach(b => b.onclick = () => openMeta('ar', b.dataset.id));
  dots.forEach(d => d.onclick = () => show(+d.dataset.i));
  box.onmouseenter = () => (paused = true); box.onmouseleave = () => (paused = false);
  show(0);
  let t0 = Date.now();
  heroTimer = setInterval(() => {
    if (!document.body.contains(box)) return clearInterval(heroTimer);
    if (paused) { t0 += 250; return; }
    if (Date.now() - t0 >= DUR) { t0 = Date.now(); show(cur + 1); }
  }, 250);
}


/* ===== لوحة البحث (مثل command palette) ===== */
const SRCH = svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>');
let smTok = 0;
function closeSearch() { const s = $('#sm'); if (s) s.remove(); smTok++; }
async function smSearch(q) {
  const nq = normT(q);
  const [a, w, cu] = await Promise.all([
    window.api.ar.search(q).catch(() => []), witSearch(q).catch(() => []),
    customList().then(l => l.filter(m => keysOf(m).some(k => k.includes(nq)))).catch(() => [])
  ]);
  const r = dedupe([...cu, ...a, ...w], newSeen());
  r.forEach(m => arCache.set(m.id, m));
  return r.slice(0, 30);
}
function openSearch() {
  if ($('#sm')) return;
  const sm = document.createElement('div'); sm.id = 'sm';
  sm.innerHTML = `<div class="smbox"><div class="smin">${SRCH}<input id="smq" placeholder="ابحث عن أنمي…" autocomplete="off" spellcheck="false"><button id="smx" class="hide" title="مسح">${I.close}</button></div>
    <div class="smpanel"><div class="smres" id="smres"></div>
    <div class="smfoot"><span><kbd>↑</kbd><kbd>↓</kbd> تنقّل</span><span><kbd>↵</kbd> اختيار</span><span class="sp"></span><span><kbd>esc</kbd> إغلاق</span></div></div></div>`;
  document.body.appendChild(sm);
  const inp = sm.querySelector('#smq'), res = sm.querySelector('#smres'), x = sm.querySelector('#smx');
  let rows = [], act = -1, tm;
  const setAct = (i) => { rows.forEach((r, k) => r.classList.toggle('on', k === i)); act = i; if (rows[i]) rows[i].scrollIntoView({ block: 'nearest' }); };
  const idle = () => (res.innerHTML = '<div class="smempty"><div class="ic">' + SRCH + '</div><h4>ابدأ بكتابة اسم الأنمي</h4><p>ابحث بالعربية أو الإنجليزية</p></div>', rows = [], act = -1);
  const empty = () => {
    res.innerHTML = `<div class="smempty"><div class="ic">${SRCH}</div><h4>لم يتم العثور على نتائج</h4><p>لم يطابق بحثك أي نتيجة. حاول مرة أخرى.</p><button id="smclr">مسح البحث</button></div>`;
    res.querySelector('#smclr').onclick = () => { inp.value = ''; x.classList.add('hide'); inp.focus(); idle(); };
    rows = []; act = -1;
  };
  const pick = (id) => { closeSearch(); $('#q').value = ''; openMeta('ar', id); };
  const show = (list) => {
    if (!list.length) return empty();
    res.innerHTML = list.map(m => `<div class="smrow" data-id="${esc(m.id)}"><img src="${esc(m.poster)}" alt=""><div><b>${esc(m.name)}</b><small>${esc([m.nameEn && m.nameEn !== m.name ? m.nameEn : '', arOk(m.type) ? m.type : ''].filter(Boolean).join(' · '))}</small></div>${arOk(m.score) ? `<span class="sc">★ ${esc(m.score)}</span>` : ''}</div>`).join('');
    rows = [...res.querySelectorAll('.smrow')];
    rows.forEach((r, i) => { r.onmouseenter = () => setAct(i); r.onclick = () => pick(r.dataset.id); });
    setAct(0);
  };
  const run = async (q) => {
    const tk = ++smTok;
    res.innerHTML = '<div class="smempty"><p>جارٍ البحث…</p></div>';
    let list = []; try { list = await smSearch(q); } catch {}
    if (tk === smTok && $('#sm')) show(list);
  };
  idle();
  inp.oninput = () => {
    const q = inp.value.trim(); x.classList.toggle('hide', !inp.value);
    clearTimeout(tm); smTok++;
    if (!q) return idle();
    tm = setTimeout(() => run(q), 300);
  };
  x.onclick = () => { inp.value = ''; x.classList.add('hide'); clearTimeout(tm); smTok++; idle(); inp.focus(); };
  inp.onkeydown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); rows.length && setAct((act + 1) % rows.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); rows.length && setAct((act - 1 + rows.length) % rows.length); }
    else if (e.key === 'Enter') { e.preventDefault(); if (rows[act]) pick(rows[act].dataset.id); }
  };
  sm.onmousedown = (e) => { if (e.target === sm) closeSearch(); };
  inp.focus();
}
$('#q').onfocus = () => { $('#q').blur(); openSearch(); };
$('#q').onclick = () => openSearch();
$('#qb').onclick = () => openSearch();
document.querySelector('.sb').onclick = () => openSearch();
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#sm') ? closeSearch() : openSearch(); }
});

/* التطبيق عربي فقط: نستبدل دوال الكتالوج القديمة بالمصدر العربي */
{
  loadCatalog = (s) => arLoadCatalog(s);
  openMeta = (type, id) => openAr(id);
  init = () => arLoadCatalog();
  subAddon = '';
  let lastRef = Date.now();
  async function arRefresh() {                                        // تحديث تلقائي: نجيبو الجديد ونحطوه فوق
    lastRef = Date.now();
    if (AF.busy || !$('#agrid') || AF.sec !== 'latest' || AF.genre || AF.type !== 'SERIES') return;
    try {
      const [r, w] = await Promise.all([window.api.ar.list({ latest: true, limit: AR_PAGE, from: 0 }), witLatest()]);
      const fresh = dedupe([...r, ...w], AF.seen);
      if (!fresh.length || !$('#agrid')) return;
      fresh.forEach(m => newIds.add(m.id)); markKnown(fresh);
      AF.list.unshift(...fresh);
      $('#agrid').insertAdjacentHTML('afterbegin', fresh.map(arCard).join(''));
      bindCards(); $('#acount').textContent = AF.list.length + ' أنمي';
      toast('تزاد ' + fresh.length + ' أنمي جديد');
    } catch {}
  }
  window.arRefresh = arRefresh;
  setInterval(arRefresh, 5 * 60 * 1000);
  pushBg();
  if (window.api.onHidden) window.api.onHidden(() => document.querySelectorAll('video,audio').forEach(v => { try { v.pause(); } catch {} }));
  setTimeout(watchNew, 20000); setInterval(watchNew, 10 * 60 * 1000);   // فحص الحلقات الجديدة للمفضلة وآخر ما شاهدته
  if (window.api.onNotifyOpen) window.api.onNotifyOpen((id) => openAr(id));
  window.addEventListener('focus', () => { if (Date.now() - lastRef > 60000) arRefresh(); });
  view.addEventListener('scroll', () => {
    if ($('#agrid') && view.scrollTop + view.clientHeight > view.scrollHeight - 400) arMore();
  });
}

/* ===== زر الرجوع: يرجع للصفحة اللي كنتي فيها قبل ===== */
const navStack = []; let navCur = null;
function navUpd() { const b = $('#wBack'); if (b) b.disabled = !navStack.length; }
function navTrack(fn, keyOf) {
  return function (...a) {
    const k = keyOf(...a);
    if (!navCur || navCur.k !== k) { if (navCur) { navStack.push(navCur); if (navStack.length > 40) navStack.shift(); } navCur = { k, run: () => fn(...a) }; }
    else navCur.run = () => fn(...a);
    navUpd();
    return fn.apply(this, a);
  };
}
arLoadCatalog = navTrack(arLoadCatalog, (s) => 'cat:' + (s || ''));
openAr = navTrack(openAr, (id) => 'ar:' + id);
showList = navTrack(showList, (t, key) => 'list:' + key);
function navBack() {
  if (document.querySelector('#pl') || document.querySelector('#sm')) return;   // المشغّل/البحث مفتوحين: ما نرجعوش
  const prev = navStack.pop(); if (!prev) return;
  navCur = prev; navUpd();
  try { prev.run(); } catch {}
}
$('#wBack').onclick = navBack;
document.addEventListener('keydown', (e) => { if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); navBack(); } });
document.addEventListener('mouseup', (e) => { if (e.button === 3) { e.preventDefault(); navBack(); } });

/* ===== مزامنة المفضلة وسجل المشاهدة مع حساب الموقع (كيتحفظو فـ Render) ===== */
const SY = { base: store.get('syncBase', 0), dirty: store.get('syncDirty', false), timer: null, busy: false, on: false };
const syMerge = (a, b, max) => { const seen = new Set(), out = []; for (const x of [...(a || []), ...(b || [])]) { if (x && x.id && !seen.has(x.id)) { seen.add(x.id); out.push(x); } } return out.slice(0, max); };
window.syncDirty = () => { if (!SY.on) return; SY.dirty = true; store.set('syncDirty', true); clearTimeout(SY.timer); SY.timer = setTimeout(syncPush, 2500); };
async function syncPush() {
  if (SY.busy) { SY.timer = setTimeout(syncPush, 2000); return; }
  SY.busy = true;
  try {
    for (let k = 0; k < 3; k++) {
      const r = await window.api.sync.put({ fav: store.get('fav', []), hist: store.get('hist', []), base: SY.base });
      if (!r) return;
      if (r.conflict) {                       // جهاز آخر حفظ قبلنا: ندمجو ونعاودو
        store.set('fav', syMerge(store.get('fav', []), r.fav, 300)); store.set('hist', syMerge(store.get('hist', []), r.hist, 40));
        SY.base = r.t; continue;
      }
      SY.base = r.t; SY.dirty = false; store.set('syncBase', SY.base); store.set('syncDirty', false); return;
    }
  } catch {} finally { SY.busy = false; }
}
async function syncPull() {
  try {
    const r = await window.api.sync.get(); if (!r) return;
    if (r.t && r.t !== SY.base) {
      if (SY.dirty || !SY.base) {            // تغييرات محلية (أو أول مزامنة): ندمجو
        store.set('fav', syMerge(store.get('fav', []), r.fav, 300)); store.set('hist', syMerge(store.get('hist', []), r.hist, 40));
        SY.dirty = true;
      } else { store.set('fav', r.fav || []); store.set('hist', (r.hist || []).slice(0, 40)); }
      SY.base = r.t; store.set('syncBase', SY.base);
    } else if (!r.t && (store.get('fav', []).length || store.get('hist', []).length)) SY.dirty = true;
    SY.on = true;
    if (SY.dirty) await syncPush();
  } catch { SY.on = true; }
}
setInterval(() => { if (SY.on && !SY.dirty && !SY.busy) syncPull(); }, 5 * 60 * 1000);

/* ===== تسجيل الدخول بحساب موقع البطاقات (WAYANIME) ===== */
function showAcct(u) {
  const a = $('#acct'); if (!a) return;
  a.hidden = false;
  a.innerHTML = `${u.pic ? `<img src="${esc(u.pic)}" alt="" referrerpolicy="no-referrer">` : ''}<span>${esc(u.username)}</span><span class="pt">${esc(u.pts)}</span><button id="acOut" title="تسجيل الخروج">خروج</button>`;
  $('#acOut').onclick = async () => { await window.api.acct.logout(); ['fav', 'hist', 'syncBase', 'syncDirty'].forEach(k => localStorage.removeItem('way:' + k)); location.reload(); };
}
function askLogin() {
  return new Promise(async (resolve) => {
    const site = await window.api.acct.site().catch(() => '');
    const g = document.createElement('div'); g.id = 'gate';
    g.innerHTML = `<div class="gwall" aria-hidden="true"></div><form><img src="assets/logo.png" alt=""><h1>تسجيل الدخول</h1><p class="d">ادخل بنفس حساب موقع البطاقات</p><input name="u" placeholder="اسم المستخدم" autocomplete="username" required><input name="p" type="password" placeholder="كلمة السر" autocomplete="current-password" required><p class="er" id="gerr"></p><button class="go" type="submit">دخول</button><a id="gnew">ليس لديك حساب؟ سجّل في الموقع</a></form>`;
    document.body.appendChild(g);
    { // حائط البطاقات المتحرك (نفس تاع الموقع)
      const all = ["aot-0.jpg", "aot-1.jpg", "aot-2.jpg", "aot-3.jpg", "aot-4.jpg", "aot-5.jpg", "aot-6.jpg", "bb-0.jpg", "bb-1.jpg", "bb-2.jpg", "bb-3.jpg", "bb-4.jpg", "bb-5.jpg", "bc-0.jpg", "bc-1.jpg", "bc-2.jpg", "bc-3.jpg", "bc-4.jpg", "bc-5.jpg", "bc-6.jpg", "bc-7.jpg", "cute-0.jpg", "cute-1.jpg", "cute-10.jpg", "cute-11.jpg", "cute-12.jpg", "cute-13.jpg", "cute-14.jpg", "cute-2.jpg", "cute-3.jpg", "cute-4.jpg", "cute-5.jpg", "cute-6.jpg", "cute-7.jpg", "cute-8.jpg", "cute-9.jpg", "dbz-0.jpg", "dbz-1.jpg", "dbz-2.jpg", "dbz-3.jpg", "dbz-4.jpg", "dbz-5.jpg", "dbz-6.jpg", "dbz-7.jpg", "ds-0.jpg", "ds-1.jpg", "ds-2.jpg", "ds-3.jpg", "ds-4.jpg", "ds-5.jpg", "ds-6.jpg", "ds-7.jpg", "hxh-0.jpg", "hxh-1.jpg", "hxh-2.jpg", "hxh-3.jpg", "hxh-4.jpg", "hxh-5.jpg", "hxh-6.jpg", "hxh-7.jpg", "jjk-0.jpg", "jjk-1.jpg", "jjk-2.jpg", "jjk-3.jpg", "jjk-4.jpg", "jjk-5.jpg", "jjk-6.jpg", "leg-0.jpg", "leg-1.jpg", "leg-2.jpg", "leg-3.jpg", "leg-4.jpg", "leg-5.jpg", "leg-6.jpg", "leg-7.jpg", "leg-8.jpg", "leg-9.jpg", "mha-0.jpg", "mha-1.jpg", "mha-2.jpg", "mha-3.jpg", "mha-4.jpg", "mha-5.jpg", "mha-6.jpg", "mha-7.jpg", "naruto-0.jpg", "naruto-1.jpg", "naruto-2.jpg", "naruto-3.jpg", "naruto-4.jpg", "naruto-5.jpg", "naruto-6.jpg", "naruto-7.jpg", "op-0.jpg", "op-1.jpg", "op-2.jpg", "op-3.jpg", "op-4.jpg", "op-5.jpg", "op-6.jpg", "op-7.jpg"], w = g.querySelector('.gwall');
      for (let r = 0; r < 7; r++) {
        const l = []; for (let i = 0; i < 12; i++) l.push(all[(r * 17 + i * 7) % all.length]);
        const row = document.createElement('div'); row.className = 'gro';
        row.innerHTML = l.concat(l).map(u => '<img src="assets/cards/' + u + '" alt="">').join('');
        w.appendChild(row);
      }
    }
    g.querySelector('#gnew').onclick = () => window.api.openExternal(site);
    const f = g.querySelector('form'), er = g.querySelector('#gerr'), btn = g.querySelector('.go');
    f.u.focus();
    f.onsubmit = async (e) => {
      e.preventDefault(); er.textContent = ''; btn.disabled = true; btn.textContent = 'جارٍ الدخول…';
      try {
        const r = await window.api.acct.login({ username: f.u.value, password: f.p.value });
        g.remove(); resolve(r.user);
      } catch (x) { er.textContent = errMsg(x); btn.disabled = false; btn.textContent = 'دخول'; }
    };
  });
}
async function gate() {
  let r = { user: null };
  try { r = await window.api.acct.me(); } catch {}
  if (r.user) { showAcct(r.user); return true; }
  const u = await askLogin(); showAcct(u); return true;
}


/* ===== كمّل المشاهدة: آخر حلقة شفتها + الوقت اللي وقفت فيه ===== */
const resumeAll = () => store.get('resume', { last: '', items: {} });
const resumeGet = (id) => (resumeAll().items || {})[id];
function resumeSave(ctx, v) {
  if (!ctx || !isFinite(v.duration) || v.duration < 60 || v.currentTime < 5) return;
  const R = resumeAll(); R.items = R.items || {};
  if (v.currentTime > v.duration - 30) { delete R.items[ctx.id]; if (R.last === ctx.id) R.last = ''; }   // خلّص الحلقة
  else { R.items[ctx.id] = { id: ctx.id, name: ctx.name, poster: ctx.poster, num: ctx.num, label: ctx.label, t: Math.floor(v.currentTime), d: Math.floor(v.duration), ts: Date.now() }; R.last = ctx.id; }
  const ks = Object.keys(R.items); if (ks.length > 40) { ks.sort((a, b) => R.items[a].ts - R.items[b].ts); delete R.items[ks[0]]; }
  store.set('resume', R); resumeBtn();
}
const fmtT = (t) => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
function resumeBtn() {
  const b = $('#nResume'); if (!b) return;
  const R = resumeAll(), r = R.last && (R.items || {})[R.last];
  b.hidden = !r;
  if (!r) return;
  b.querySelector('span').textContent = 'أكمل · ح' + r.num;
  b.title = `${r.name} — الحلقة ${r.num} — من ${fmtT(r.t)}`;
}
const waitFor = (fn, ms = 20000) => new Promise((res) => { const t0 = Date.now(); const k = setInterval(() => { const x = fn(); if (x || Date.now() - t0 > ms) { clearInterval(k); res(x || null); } }, 250); });
async function resumeGo() {
  const R = resumeAll(), r = R.last && (R.items || {})[R.last];
  if (!r) return;
  toast('جارٍ فتح ' + r.name + ' — الحلقة ' + r.num);
  openMeta('ar', r.id);
  const eb = await waitFor(() => [...view.querySelectorAll('.eps button')].find(x => x.textContent.trim() === String(r.num) && !x.classList.contains('miss')));
  if (!eb) return;
  eb.click();
  const sb = await waitFor(() => { const l = [...view.querySelectorAll('.streams button')]; return l.length ? (l.find(x => x.textContent.includes(r.label || '\u0000')) || l[0]) : null; });
  if (!sb) return;
  pendingResume = r.t;
  sb.click();
}
$('#nResume').onclick = resumeGo;
resumeBtn();


/* ===== زر التحديث: يظهر فقط ملي يكون فيه إصدار جديد على GitHub ===== */
const verParts = (v) => String(v || '').replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
const verNewer = (a, b) => { const x = verParts(a), y = verParts(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
async function checkUpdate() {
  const b = $('#nUpdate'); if (!b || !window.api.update) return;
  try {
    const [cur, r] = await Promise.all([window.api.update.version(), window.api.update.check()]);
    if (r && r.tag && verNewer(r.tag, cur)) {
      b.hidden = false; b.title = 'يوجد إصدار جديد ' + r.tag + ' (الحالي ' + cur + ')';
      if (window.__updAsked !== r.tag) { window.__updAsked = r.tag; setTimeout(() => { try { if (confirm('يوجد إصدار جديد ' + r.tag + ' (الحالي ' + cur + ').\nتحديث الآن؟ سيُثبَّت فوق النسخة القديمة ثم يُعاد فتح التطبيق.')) b.click(); } catch {} }, 1500); }
      b.onclick = async () => {
        if (b.dataset.busy) return;
        if (!r.download || !/^https:/i.test(r.download)) return window.api.openExternal(r.url);
        b.dataset.busy = '1'; const sp = b.querySelector('span'), old = sp.textContent; sp.textContent = 'جارٍ التحميل…';
        window.api.update.onProgress(p => { sp.textContent = p.done ? 'جارٍ التثبيت…' : (p.total ? Math.round(p.got / p.total * 100) + '%' : (p.got / 1048576).toFixed(0) + ' MB'); });
        const res = await window.api.update.install(r.download);
        if (!res || !res.ok) { delete b.dataset.busy; sp.textContent = old; toast('فشل التحديث: ' + ((res && res.error) || 'خطأ') + ' — سنفتح الرابط في المتصفح'); window.api.openExternal(r.download); }
        else toast('سيُغلق التطبيق ويُثبّت التحديث…');
      };
    } else b.hidden = true;
  } catch { b.hidden = true; }
}
checkUpdate(); setInterval(checkUpdate, 30 * 60 * 1000);

if (!window.api) say('لم يعمل preload.js (window.api غير موجود). تأكد أن preload.js في نفس مجلد main.js.');
else if (!navigator.onLine) { showDownloads(); toast('لا يوجد اتصال بالإنترنت — تم فتح «التحميلات»'); } else init();   // تم حذف تسجيل الدخول: التطبيق يفتح مباشرة (المفضلة والسجل محليان)

// Discord Presence: تفعيل/تعطيل حسب الإعداد ثم حالة التصفح
try { window.api.rpc.enable(rpcOn()); rpcBrowse(); } catch {}
