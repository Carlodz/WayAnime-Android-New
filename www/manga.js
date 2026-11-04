/* ===== قسم المانجا (MangaDex) ===== */
const MG = {
  lang: store.get('mgLang', 'all'), sort: store.get('mgSort', 'latestUploadedChapter'), q: '',
  off: 0, offL: 0, doneMd: false, doneMl: false, total: 0, busy: false, done: false, token: 0, nav: 0, loading: 0,
  list: [], ids: new Set(), scroll: 0, cache: new Map(), rpc: false, src: store.get('mgSrc', 'all'), desc: store.get('mgDesc', false)
};
const MG_LANGS = [['ar', 'عربي'], ['en', 'English'], ['all', 'كل اللغات']];
const MG_SORTS = [['latestUploadedChapter', 'آخر التحديثات'], ['followedCount', 'الأكثر شعبية'], ['rating', 'الأعلى تقييماً'], ['createdAt', 'أحدث إضافة']];
const MG_PAGE = 100;            // أقصى عدد يسمح به MangaDex فـ الطلب الواحد
const MG_MAX = 10000;           // حد MangaDex: offset + limit <= 10000
const mgApi = (p) => window.api.manga(p);
const mgImg = (u, r) => u ? '/_mgimg/?u=' + encodeURIComponent(u) + (r ? '&r=' + r : '') : '';   // الصور كتدوز من main.js
const mgStatus = { ongoing: 'مستمرة', completed: 'مكتملة', hiatus: 'متوقفة مؤقتاً', cancelled: 'ملغاة' };
const mgLbl = (c) => (c.num ? 'الفصل ' + c.num : 'فصل خاص');
const mgRead = {
  get() { try { return JSON.parse(localStorage.getItem('mgRead') || '{}'); } catch { return {}; } },
  mark(mid, cid) { try { const o = this.get(); (o[mid] = o[mid] || []).includes(cid) || o[mid].push(cid); localStorage.setItem('mgRead', JSON.stringify(o)); } catch {} }
};

/* ===== مانجا ليك (mangalik.net — Madara) ===== */
const MLK = 'https://mangalik.net';
const mlkDoc = async (u, post) => new DOMParser().parseFromString(await window.api.mlk(u, post || ''), 'text/html');
const mlkAbs = (u) => { try { return new URL(String(u || '').trim(), MLK + '/').href; } catch { return ''; } };
const mlkPath = (href) => { try { return decodeURIComponent(new URL(href, MLK + '/').pathname).replace(/\/+$/, ''); } catch { return ''; } };
const mlkSlug = (href) => { const p = mlkPath(href).split('/'); return p.length === 3 && p[1] === 'manga' && p[2] ? p[2] : ''; };
const mlkImgSrc = (im) => {
  for (const k of ['data-src', 'data-lazy-src', 'data-cfsrc', 'data-original', 'src']) {
    const v = (im.getAttribute(k) || '').trim(); if (v && !/^data:/i.test(v)) return mlkAbs(v);
  }
  return '';
};
function mlkCards(doc) {
  const by = new Map();
  doc.querySelectorAll('a[href]').forEach(a => {
    const slug = mlkSlug(a.getAttribute('href')); if (!slug) return;
    const o = by.get(slug) || { id: 'mlk:' + slug, src: 'mlk', name: '', nameEn: '', poster: '', synopsis: '', status: '', year: '', tags: [] };
    const im = a.querySelector('img');
    if (im && !o.poster) o.poster = mlkImgSrc(im);
    const t = (a.textContent || '').replace(/\s+/g, ' ').trim() || a.getAttribute('title') || (im && im.getAttribute('alt')) || '';
    if (t && !o.name) o.name = t;
    by.set(slug, o);
  });
  return [...by.values()].filter(o => o.name);
}
async function mlkList(pg) {
  pg = pg || 1; const q = encodeURIComponent(MG.q);
  let u;
  if (MG.q) u = pg > 1 ? `${MLK}/page/${pg}/?s=${q}&post_type=wp-manga` : `${MLK}/?s=${q}&post_type=wp-manga`;
  else if (MG.sort === 'latestUploadedChapter') u = pg > 1 ? `${MLK}/page/${pg}/` : `${MLK}/`;
  else {
    const o = { followedCount: 'views', rating: 'rating', createdAt: 'new-manga' }[MG.sort] || 'latest';
    u = `${MLK}/manga/${pg > 1 ? 'page/' + pg + '/' : ''}?m_orderby=${o}`;
  }
  return mlkCards(await mlkDoc(u));
}
function mlkChapterLinks(doc, slug) {
  const out = [], seen = new Set(), pre = '/manga/' + slug + '/';
  doc.querySelectorAll('a[href]').forEach(a => {
    const p = mlkPath(a.getAttribute('href'));
    if (!p.startsWith(pre)) return;
    const key = p.slice(pre.length);
    if (!key || key.includes('/') || !/\d/.test(key) || /^(feed|ajax|page|comment)/i.test(key) || seen.has(key)) return;
    seen.add(key);
    const n = key.match(/\d+(?:[-.]\d+)?/);
    out.push({ id: 'mlk:' + slug + '/' + key, url: mlkAbs(a.getAttribute('href')), num: n ? n[0].replace('-', '.') : key, title: '', vol: '' });
  });
  return out;
}
async function mlkInfo(slug) {
  const url = `${MLK}/manga/${slug}/`;
  const doc = await mlkDoc(url);
  const meta = (p) => { const e = doc.querySelector(`meta[property="${p}"]`); return e ? (e.getAttribute('content') || '') : ''; };
  const txt = (...sel) => { for (const s of sel) { const e = doc.querySelector(s); const t = e && e.textContent.replace(/\s+/g, ' ').trim(); if (t) return t; } return ''; };
  let name = '';
  const h1 = doc.querySelector('.post-title h1, h1');
  if (h1) { const c = h1.cloneNode(true); c.querySelectorAll('span').forEach(x => x.remove()); name = c.textContent.replace(/\s+/g, ' ').trim(); }
  name = name || meta('og:title').replace(/\s*[-–|].*$/, '') || slug;
  const pi = doc.querySelector('.summary_image img, .tab-summary img');
  const poster = (pi ? mlkImgSrc(pi) : '') || meta('og:image');
  const synopsis = txt('.summary__content', '.description-summary', '.manga-excerpt') || meta('og:description');
  const tags = [...doc.querySelectorAll('.genres-content a')].map(a => a.textContent.trim()).filter(Boolean).slice(0, 8);
  let chs = mlkChapterLinks(doc, slug);
  if (!chs.length) { try { chs = mlkChapterLinks(await mlkDoc(url + 'ajax/chapters/', 'post'), slug); } catch {} }   // Madara: الفصول كتتحمّل بـ AJAX
  chs.sort((a, b) => (parseFloat(a.num) || 0) - (parseFloat(b.num) || 0));
  return { m: { id: 'mlk:' + slug, src: 'mlk', name, nameEn: '', poster: poster.replace(/-\d+x\d+(\.\w+)$/, '$1'), synopsis, status: '', year: '', tags }, chs, lang: 'ar' };
}
async function mlkPages(url) {
  const doc = await mlkDoc(url);
  let ims = [...doc.querySelectorAll('.reading-content img, .page-break img, #readerarea img')];
  if (!ims.length) ims = [...doc.querySelectorAll('img')].filter(i => /WP-manga|\/chapter|\/manga_/i.test(mlkImgSrc(i)));
  const seen = new Set();
  return ims.map(mlkImgSrc).filter(u => u && !seen.has(u) && seen.add(u));
}

function mgMap(m) {
  const a = m.attributes || {}, t = a.title || {};
  const alts = a.altTitles || [];
  const pick = (l) => { const x = alts.find(z => z[l]); return x ? x[l] : ''; };
  const name = (MG.lang !== 'en' && pick('ar')) || t.en || pick('en') || t['ja-ro'] || Object.values(t)[0] || '—';
  const cov = (m.relationships || []).find(r => r.type === 'cover_art');
  const poster = cov && cov.attributes && cov.attributes.fileName ? `https://uploads.mangadex.org/covers/${m.id}/${cov.attributes.fileName}.256.jpg` : '';
  const d = a.description || {};
  return { id: m.id, name, nameEn: t.en || t['ja-ro'] || '', poster, synopsis: d.ar || d.en || '', status: a.status || '', year: a.year || '', tags: (a.tags || []).map(x => (x.attributes.name || {}).en).filter(Boolean).slice(0, 8) };
}

function mgQuery(off) {
  const p = new URLSearchParams();
  p.set('limit', MG_PAGE); p.set('offset', off == null ? MG.off : off);
  if (MG.lang !== 'all') p.append('availableTranslatedLanguage[]', MG.lang);
  p.append('includes[]', 'cover_art');
  ['safe', 'suggestive'].forEach(c => p.append('contentRating[]', c));
  p.set('hasAvailableChapters', 'true');
  if (MG.q) p.set('title', MG.q); else p.set('order[' + MG.sort + ']', 'desc');
  return '/manga?' + p.toString();
}

// بلا onload/onerror inline (الـ CSP كيمنعهم): renderer.js فيه مستمعين عامين للبوسترات (fade-in + بوستر بديل)
const mgCard = (m) => `<div class="card" tabindex="0" data-mid="${esc(m.id)}"><img loading="lazy" src="${esc(m.poster ? mgImg(m.poster) : phSvg(m.name))}"${m.poster ? '' : ' data-need="1"'} alt=""><p>${esc(m.name)}</p><div class="cm"><span>${esc(mgStatus[m.status] || '')}</span></div></div>`;

function mgFoot() {
  const btn = $('#mmore'), cnt = $('#mcount'); if (!btn) return;
  btn.disabled = false; btn.textContent = MG.done ? 'لا يوجد المزيد' : 'تحميل المزيد'; btn.classList.toggle('hide', MG.done);
  if (cnt) cnt.textContent = MG.list.length ? (MG.list.length + (MG.total > MG.list.length ? ' من ' + MG.total : '') + ' مانجا') : '';
}


const mgSleep = (ms) => new Promise((r) => setTimeout(r, ms));
// MangaDex: عدة صفحات (100 لكل واحدة) بالتوازي مع فاصل بسيط لتفادي حد الطلبات
async function mgFetchMd(n) {
  const offs = [];
  for (let k = 0; k < n; k++) { const o = MG.off + k * MG_PAGE; if (o + MG_PAGE > MG_MAX || (MG.total && o >= MG.total)) break; offs.push(o); }
  if (!offs.length) { MG.doneMd = true; return []; }
  const rs = await Promise.all(offs.map(async (o, k) => { await mgSleep(k * 260); try { return await mgApi(mgQuery(o)); } catch (e) { return { err: e }; } }));
  const out = [];
  for (let k = 0; k < rs.length; k++) {
    const r = rs[k];
    if (r.err) { if (!out.length && k === 0) throw r.err; break; }
    const data = r.data || []; MG.total = r.total || MG.total; MG.off += data.length; out.push(...data.map(mgMap));
    if (data.length < MG_PAGE || MG.off >= MG.total || MG.off + MG_PAGE > MG_MAX) { MG.doneMd = true; break; }
  }
  return out;
}
// مانجا ليك: عدة صفحات بالتوازي
async function mgFetchMl(n) {
  const rs = await Promise.all([...Array(n)].map((_, k) => mgSleep(k * 200).then(() => mlkList(MG.offL + k + 1)).then((l) => ({ l }), (err) => ({ err }))));
  const out = [], seen = new Set();
  for (let k = 0; k < rs.length; k++) {
    const r = rs[k];
    if (r.err) { if (!out.length && k === 0) throw r.err; break; }
    const fresh = r.l.filter(m => !MG.ids.has(m.id) && !seen.has(m.id));
    fresh.forEach(m => seen.add(m.id)); MG.offL++; out.push(...fresh);
    if (!fresh.length) { MG.doneMl = true; break; }
  }
  return out;
}

async function mgMore(reset) {
  if (reset) { MG.list = []; MG.ids = new Set(); MG.off = 0; MG.offL = 0; MG.doneMd = false; MG.doneMl = false; MG.total = 0; MG.done = false; MG.token++; MG.busy = false; MG.scroll = 0; }
  if (MG.busy || MG.done) return;
  const tk = MG.token; MG.busy = true;
  const box = $('#mgrid'), btn = $('#mmore');
  if (!box) { MG.busy = false; return; }
  btn.textContent = 'جارٍ التحميل…'; btn.disabled = true;
  if (reset) box.innerHTML = '<p class="mute">جارٍ التحميل…</p>';
  try {
    const want = MG.src;
    const jobs = [];
    if (want !== 'mlk' && !MG.doneMd) jobs.push(mgFetchMd(want === 'all' ? 2 : 3)); else jobs.push(Promise.resolve([]));
    if (want !== 'md' && !MG.doneMl) jobs.push(mgFetchMl(want === 'all' ? 2 : 3)); else jobs.push(Promise.resolve([]));
    const [a, b] = await Promise.allSettled(jobs);
    if (tk !== MG.token) return;
    if (a.status === 'rejected' && b.status === 'rejected') throw a.reason;
    if (want === 'md' && a.status === 'rejected') throw a.reason;
    if (want === 'mlk' && b.status === 'rejected') throw b.reason;
    const lists = [a.status === 'fulfilled' ? a.value : [], b.status === 'fulfilled' ? b.value : []];
    MG.done = want === 'md' ? MG.doneMd : want === 'mlk' ? MG.doneMl : (MG.doneMd && MG.doneMl);
    if (want === 'all' && (a.status === 'rejected' || b.status === 'rejected') && !lists[0].length && !lists[1].length) MG.done = true;
    const items = mixLists(lists).filter(m => !MG.ids.has(m.id));
    items.forEach(m => MG.ids.add(m.id));
    if (reset) box.innerHTML = '';
    MG.list.push(...items);
    box.insertAdjacentHTML('beforeend', items.map(mgCard).join(''));
    if (!MG.list.length) box.innerHTML = '<p class="mute">لا توجد مانجا بهذا البحث.</p>';
  } catch (e) {
    if (tk === MG.token) { if (reset) box.innerHTML = ''; box.insertAdjacentHTML('beforeend', '<p class="mute">خطأ: ' + esc(errMsg(e)) + '</p>'); }
  } finally {
    if (tk === MG.token) { MG.busy = false; mgFoot(); }
  }
}

function mgChips() {
  return AR_SECS.map(([v, n]) => `<button class="chip${v === 'MANGA' ? ' on' : ''}" data-sec="${esc(v)}">${CHIP_ICONS[v] || ''}${esc(n)}</button>`).join('');
}

/* ===== Discord: الحالة (إسم المانجا + الفصل) ===== */
function mgRpc(m, state, big) {
  MG.rpc = true;
  const img = m.poster ? m.poster.replace('.256.jpg', big ? '.512.jpg' : '.256.jpg') : '';
  rpcSet({ type: 0, details: m.name, state, start: Date.now(), image: /^https:\/\//.test(img) ? img : '', imageText: m.name });
}

/* ===== قائمة المانجا ===== */
function openManga(fresh) {
  MG.nav++;
  setNav('nHome');            // بلا 'hh': وإلا الهيدر يغطي المحتوى
  MG.rpc = true; rpcSet({ type: 0, details: 'يتصفح المانجا', state: 'WayAnime' });
  view.innerHTML = `<div class="sec" id="mgwrap"><div class="fbar">
      <div class="chips" id="fsec">${mgChips()}</div>
      <div class="chips" id="msrc">${[['all', 'الكل'], ['md', 'MangaDex'], ['mlk', 'مانجا ليك']].map(([v, n]) => `<button class="chip${v === MG.src ? ' on' : ''}" data-v="${v}">${esc(n)}</button>`).join('')}</div>
      <div class="chips" id="mlang"${MG.src === 'mlk' ? ' style="display:none"' : ''}>${MG_LANGS.map(([v, n]) => `<button class="chip${v === MG.lang ? ' on' : ''}" data-l="${v}">${esc(n)}</button>`).join('')}</div>
      <div class="chips" id="msort">${MG_SORTS.map(([v, n]) => `<button class="chip${!MG.q && v === MG.sort ? ' on' : ''}" data-s="${v}">${esc(n)}</button>`).join('')}</div>
      <input id="mq" type="search" placeholder="ابحث عن مانجا…" value="${esc(MG.q)}" style="height:var(--fh);border-radius:var(--r);padding:0 14px;background:var(--panel);border:1px solid var(--line);color:var(--text);min-width:200px">
      <span class="mute" id="mcount"></span></div>
    <div class="grid" id="mgrid"></div>
    <div style="text-align:center;margin-top:26px"><button class="primary" id="mmore">تحميل المزيد</button></div></div>`;
  view.scrollTop = 0;
  view.querySelectorAll('#fsec .chip').forEach(c => c.onclick = () => { if (c.dataset.sec === 'MANGA') return; AF.sec = c.dataset.sec; AF.genre = ''; arLoadCatalog(); });
  view.querySelectorAll('#msrc .chip').forEach(c => c.onclick = () => {
    MG.src = c.dataset.v; store.set('mgSrc', MG.src);
    view.querySelectorAll('#msrc .chip').forEach(x => x.classList.toggle('on', x === c));
    $('#mlang').style.display = MG.src === 'mlk' ? 'none' : ''; mgMore(true);
  });
  view.querySelectorAll('#mlang .chip').forEach(c => c.onclick = () => {
    MG.lang = c.dataset.l; store.set('mgLang', MG.lang);
    view.querySelectorAll('#mlang .chip').forEach(x => x.classList.toggle('on', x === c)); mgMore(true);
  });
  view.querySelectorAll('#msort .chip').forEach(c => c.onclick = () => {
    MG.sort = c.dataset.s; MG.q = ''; store.set('mgSort', MG.sort); $('#mq').value = '';
    view.querySelectorAll('#msort .chip').forEach(x => x.classList.toggle('on', x === c)); mgMore(true);
  });
  const mq = $('#mq'); let tm;
  mq.oninput = () => { clearTimeout(tm); tm = setTimeout(() => { MG.q = mq.value.trim(); view.querySelectorAll('#msort .chip').forEach(x => x.classList.toggle('on', !MG.q && x.dataset.s === MG.sort)); mgMore(true); }, 450); };
  const box = $('#mgrid');
  box.onclick = (e) => { const c = e.target.closest('.card'); if (c) openMangaInfo(c.dataset.mid); };
  box.onkeydown = (e) => { if (e.key === 'Enter') { const c = e.target.closest('.card'); if (c) openMangaInfo(c.dataset.mid); } };
  $('#mmore').onclick = () => mgMore();
  if (window.IntersectionObserver) {
    const mb = $('#mmore');
    const io = new IntersectionObserver(async (es) => {
      if (!document.body.contains(mb)) { io.disconnect(); return; }
      if (es[0].isIntersecting && !MG.busy && !MG.done) { await mgMore(); io.unobserve(mb); io.observe(mb); }
    }, { root: view, rootMargin: '700px' });
    io.observe(mb);
  }
  if (!fresh && MG.list.length) {            // رجوع: نعاودو نعرضو اللي كان محمّل (بلا طلب جديد) ونرجعو لنفس المكان
    box.innerHTML = MG.list.map(mgCard).join(''); mgFoot(); view.scrollTop = MG.scroll || 0;
  } else mgMore(true);
}

/* ===== الفصول ===== */
async function mgChapters(mid) {
  const out = []; let off = 0, total = 1;
  while (off < total && off < 5000) {
    const p = new URLSearchParams({ limit: 500, offset: off, includeExternalUrl: '0' });
    if (MG.lang !== 'all') p.append('translatedLanguage[]', MG.lang);
    p.set('order[chapter]', 'asc');
    ['safe', 'suggestive'].forEach(c => p.append('contentRating[]', c));
    const r = await mgApi(`/manga/${mid}/feed?` + p.toString());
    total = r.total || 0; off += (r.data || []).length;
    out.push(...(r.data || []));
    if (!(r.data || []).length) break;
  }
  let rows = out.filter(c => (c.attributes.pages || 0) > 0);
  let lang = MG.lang;
  if (lang === 'all') {       // نختارو لغة وحدة باش ما تتخلطش الفصول: عربي ثم إنجليزي ثم اللي عندها فصول أكثر
    const by = {}; rows.forEach(c => { const l = c.attributes.translatedLanguage || '?'; (by[l] = by[l] || []).push(c); });
    lang = by.ar ? 'ar' : by.en ? 'en' : Object.keys(by).sort((a, b) => by[b].length - by[a].length)[0] || '';
    rows = by[lang] || [];
  }
  const seen = new Set();
  const chs = rows.map(c => ({ id: c.id, num: c.attributes.chapter || '', title: c.attributes.title || '', vol: c.attributes.volume || '' }))
    .filter(c => { const k = c.num || c.id; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (parseFloat(a.num) || 0) - (parseFloat(b.num) || 0));
  return { chs, lang };
}

const mgGoBack = () => (navStack.length ? navBack() : openManga());

async function openMangaInfo(mid) {
  if ($('#mgrid')) MG.scroll = view.scrollTop;
  const nv = ++MG.nav; MG.loading++;
  say('جارٍ التحميل…');
  try {
    const key = mid + ':' + MG.lang;
    let it = MG.cache.get(key);
    if (!it) {
      if (String(mid).startsWith('mlk:')) it = await mlkInfo(String(mid).slice(4));
      else {
        const r = await mgApi(`/manga/${mid}?includes[]=cover_art`);
        const m = mgMap(r.data);
        const { chs, lang } = await mgChapters(mid);
        it = { m, chs, lang };
      }
      MG.cache.set(key, it);
      if (MG.cache.size > 30) MG.cache.delete(MG.cache.keys().next().value);
    }
    if (nv !== MG.nav) return;
    const { m, chs, lang } = it;
    const done = new Set(mgRead.get()[mid] || []);
    view.innerHTML = `<div class="sec" id="mginfo"><button class="chip" id="mback">→ رجوع</button>
      <div style="display:flex;gap:24px;margin-top:18px;flex-wrap:wrap">
        ${m.poster ? `<img src="${esc(mgImg(m.poster.replace('.256.jpg', '.512.jpg')))}" alt="" style="width:200px;border-radius:8px;aspect-ratio:2/3;object-fit:cover;background:var(--panel)">` : ''}
        <div style="flex:1;min-width:260px"><h2 style="margin:0 0 6px">${esc(m.name)}</h2>
          <p class="mute" style="margin:0 0 10px">${esc([m.nameEn !== m.name ? m.nameEn : '', mgStatus[m.status], m.year, lang === 'ar' ? 'عربي' : lang === 'en' ? 'English' : lang.toUpperCase()].filter(Boolean).join(' · '))}</p>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">${m.tags.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>
          <p style="line-height:1.7;max-width:70ch">${esc(m.synopsis.slice(0, 700))}</p>
          ${chs.length ? `<button class="primary" id="mstart" style="margin-top:10px">${done.size ? 'تابع القراءة' : 'ابدأ القراءة'}</button>` : ''}</div></div>
      <div style="display:flex;align-items:center;gap:12px;margin:26px 0 12px;flex-wrap:wrap"><h3 style="margin:0">الفصول (${chs.length})</h3>
        ${chs.length > 1 ? `<button class="chip" id="msortc"></button>` : ''}</div>
      <div id="mchs" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px"></div></div>`;
    view.scrollTop = 0;
    const go = (i) => mgReader(m, chs, i);
    const paint = () => {
      const idx = chs.map((_, i) => i); if (MG.desc) idx.reverse();
      $('#mchs').innerHTML = idx.map(i => { const c = chs[i]; return `<button class="chip${done.has(c.id) ? ' on' : ''}" data-i="${i}" title="${esc(c.title)}">${esc(mgLbl(c))}</button>`; }).join('') || '<p class="mute">لا توجد فصول لهاد اللغة.</p>';
      const sb = $('#msortc'); if (sb) sb.textContent = MG.desc ? 'الأحدث أولاً ↓' : 'الأقدم أولاً ↑';
    };
    paint();
    $('#mchs').onclick = (e) => { const b = e.target.closest('[data-i]'); if (b) go(+b.dataset.i); };
    const sb = $('#msortc'); if (sb) sb.onclick = () => { MG.desc = !MG.desc; store.set('mgDesc', MG.desc); paint(); };
    $('#mback').onclick = mgGoBack;
    const st = $('#mstart'); if (st) st.onclick = () => { const n = chs.findIndex(c => !done.has(c.id)); go(n < 0 ? 0 : n); };
    mgRpc(m, 'يتصفح الفصول', true);
  } catch (e) { if (nv === MG.nav) say('خطأ: ' + errMsg(e)); }
  finally { MG.loading--; }
}

/* ===== القارئ ===== */
async function mgReader(m, chs, i) {
  const c = chs[i]; if (!c) return;
  const nv = ++MG.nav; MG.loading++;
  say('جارٍ تحميل الصفحات…');
  try {
    let urls, alts = [];
    if (m.src === 'mlk') urls = await mlkPages(c.url);
    else {
      const r = await mgApi('/at-home/server/' + c.id);
      const base = r.baseUrl, h = r.chapter.hash;
      urls = (r.chapter.data || []).map(f => base + '/data/' + h + '/' + f);
      alts = (r.chapter.dataSaver || []).map(f => base + '/data-saver/' + h + '/' + f);
    }
    if (nv !== MG.nav) return;
    if (!urls.length) throw new Error('لا توجد صور لهذا الفصل');
    mgRead.mark(m.id, c.id);
    const bar = `<div style="display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap;margin:12px 0">
      <button class="chip" data-a="back">→ الفصول</button>
      <button class="chip" data-a="next"${i + 1 >= chs.length ? ' disabled' : ''}>← التالي</button>
      <b>${esc(m.name)} — ${esc(mgLbl(c))}</b>
      <button class="chip" data-a="prev"${i === 0 ? ' disabled' : ''}>السابق →</button></div>`;
    view.innerHTML = `<div class="sec" style="max-width:920px;margin:0 auto">${bar}<div id="mpages" style="display:flex;flex-direction:column;align-items:center">${urls.map((f, k) => `<img loading="lazy" data-k="${k}" src="${esc(mgImg(f))}" alt="" style="width:100%;display:block;background:var(--panel);min-height:200px">`).join('')}</div>${bar}</div>`;
    view.scrollTop = 0;
    const acts = { back: mgGoBack, next: () => mgReader(m, chs, i + 1), prev: () => mgReader(m, chs, i - 1) };
    view.querySelectorAll('[data-a]').forEach(b => b.onclick = () => acts[b.dataset.a]());
    view.querySelectorAll('#mpages img').forEach(im => im.addEventListener('error', () => {
      const k = +im.dataset.k, st = +(im.dataset.r || 0); im.dataset.r = st + 1;
      if (st === 0) setTimeout(() => { im.src = mgImg(urls[k], 1); }, 1500);          // محاولة ثانية
      else if (st === 1 && alts[k]) im.src = mgImg(alts[k], 2);                       // نسخة مضغوطة (MangaDex)
    }));
    mgRpc(m, mgLbl(c) + (c.title ? ' · ' + c.title : ''), true);   // Discord: إسم المانجا + الفصل
  } catch (e) { if (nv === MG.nav) say('خطأ: ' + errMsg(e)); }
  finally { MG.loading--; }
}

/* ===== زر الرجوع (الهيدر / Alt+← / زر الفأرة / Esc) ===== */
openManga = navTrack(openManga, () => 'manga');
openMangaInfo = navTrack(openMangaInfo, (id) => 'mg:' + id);
mgReader = navTrack(mgReader, (m) => 'mgr:' + m.id);

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || document.querySelector('#pl, #sm')) return;
  if (view.querySelector('#mginfo, #mpages')) { e.preventDefault(); mgGoBack(); }
});

/* ===== تحميل تلقائي كي توصل لآخر الصفحة + حفظ مكان السكرول ===== */
view.addEventListener('scroll', () => {
  if (!$('#mgrid')) return;
  MG.scroll = view.scrollTop;
  if (view.scrollTop + view.clientHeight > view.scrollHeight - 600) mgMore();
});

/* ===== كي تخرج من المانجا: Discord يرجع لـ «يتصفح الأنمي» ===== */
{
  let t;
  new MutationObserver(() => {
    if (!MG.rpc) return;
    clearTimeout(t);
    t = setTimeout(() => {
      if (MG.rpc && !MG.loading && !view.querySelector('#mgrid, #mginfo, #mpages')) { MG.rpc = false; rpcBrowse(); }
    }, 600);
  }).observe(view, { childList: true });
}
