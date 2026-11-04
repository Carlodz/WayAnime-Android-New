/* WayAnime Android bridge
 * يعيد تشغيل منطق main.js (السكرابرز، AniList، Stardima، المانجا...) داخل الـ WebView
 * ويوفّر window.api بنفس الواجهة اللي كان يوفرها preload.js على سطح المكتب.
 * الطلبات تمر عبر CapacitorHttp (بدون CORS)، والفيديو/الصور اللي تحتاج Referer تمر عبر
 * بروكسي محلي مكتوب بالـ Java (/_px و /_mgimg) داخل MainActivity. */
(function () {
  'use strict';
  const CFG = window.WA_CFG || {};
  const Cap = window.Capacitor || {};
  const native = !!(Cap.isNativePlatform && Cap.isNativePlatform());
  const plug = (n) => { try { return (Cap.Plugins || {})[n] || null; } catch { return null; } };
  const LS = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
    del: (k) => { try { localStorage.removeItem(k); } catch {} }
  };

  /* ---------- Buffer مصغّر (يكفي لـ base64/utf8/latin1) ---------- */
  class Buf extends Uint8Array {
    static from(v, enc) {
      if (typeof v === 'string') {
        if (enc === 'base64') { const b = atob(v.replace(/-/g, '+').replace(/_/g, '/')); const a = new Buf(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
        if (enc === 'latin1' || enc === 'binary') { const a = new Buf(v.length); for (let i = 0; i < v.length; i++) a[i] = v.charCodeAt(i) & 255; return a; }
        if (enc === 'hex') { const a = new Buf(v.length >> 1); for (let i = 0; i < a.length; i++) a[i] = parseInt(v.substr(i * 2, 2), 16); return a; }
        const u = new TextEncoder().encode(v); const a = new Buf(u.length); a.set(u); return a;
      }
      const src = v instanceof ArrayBuffer ? new Uint8Array(v) : v; const a = new Buf(src.length); a.set(src); return a;
    }
    static alloc(n) { return new Buf(n); }
    static isBuffer(x) { return x instanceof Buf; }
    static concat(l) { const n = l.reduce((s, x) => s + x.length, 0), a = new Buf(n); let o = 0; for (const x of l) { a.set(x, o); o += x.length; } return a; }
    toString(enc) {
      if (enc === 'base64') { let s = ''; for (let i = 0; i < this.length; i += 0x8000) s += String.fromCharCode.apply(null, this.subarray(i, i + 0x8000)); return btoa(s); }
      if (enc === 'latin1' || enc === 'binary') { let s = ''; for (let i = 0; i < this.length; i++) s += String.fromCharCode(this[i]); return s; }
      if (enc === 'hex') return Array.from(this, (b) => b.toString(16).padStart(2, '0')).join('');
      return new TextDecoder('utf-8').decode(this);
    }
  }
  window.Buffer = window.Buffer || Buf;

  /* ---------- AbortSignal.timeout يحمل المدة ليستعملها الـ HTTP الأصلي ---------- */
  AbortSignal.timeout = (ms) => {
    const c = new AbortController(); const t = setTimeout(() => c.abort(new DOMException('Timeout', 'TimeoutError')), ms);
    c.signal.__ms = ms; c.signal.addEventListener('abort', () => clearTimeout(t)); return c.signal;
  };

  /* ---------- روابط البروكسي المحلي (Java) ---------- */
  const PX = '/_px/';
  const proxify = (url, referer) => {
    if (!url || typeof url !== 'string' || !/^https?:/i.test(url)) return url;
    return PX + (/\.m3u8(\?|$)/i.test(url) ? 'stream.m3u8' : 'video.mp4') + '?u=' + encodeURIComponent(url) + (referer ? '&r=' + encodeURIComponent(referer) : '');
  };
  const unproxify = (url) => {
    try {
      if (!String(url).includes('/_px/')) return { url, referer: '' };
      const q = new URL(url, location.href).searchParams; return { url: q.get('u') || url, referer: q.get('r') || '' };
    } catch { return { url, referer: '' }; }
  };

  /* ---------- fetch أصلي (CapacitorHttp) ---------- */
  const b64ToU8 = (s) => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
  const normHeaders = (H) => {
    const o = {}; if (!H) return o;
    if (typeof H.forEach === 'function' && !Array.isArray(H)) H.forEach((v, k) => { o[k] = v; });
    else if (Array.isArray(H)) H.forEach(([k, v]) => { o[k] = v; });
    else Object.assign(o, H);
    return o;
  };
  async function nfetch(input, init) {
    init = init || {};
    const url = String((input && input.url) || input);
    const http = plug('CapacitorHttp');
    if (!native || !http) return window.fetch(url, init);
    const headers = normHeaders(init.headers);
    const hk = (n) => Object.keys(headers).find((k) => k.toLowerCase() === n);
    // طلبات Range (فحص الفيديو): نمرّرها عبر البروكسي المحلي باش ما نحمّلو الملف كامل
    if (hk('range') && /^https?:/i.test(url)) {
      const ref = hk('referer') ? headers[hk('referer')] : '';
      return window.fetch(proxify(url, ref).replace('video.mp4', 'probe.bin').replace('stream.m3u8', 'probe.bin'), { headers: { Range: headers[hk('range')] }, signal: init.signal });
    }
    const method = String(init.method || 'GET').toUpperCase(); let data; const body = init.body;
    if (body != null && method !== 'GET' && method !== 'HEAD') {
      if (body instanceof URLSearchParams) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; data = Object.fromEntries(body); }
      else if (typeof body === 'string') {
        const c = hk('content-type') ? String(headers[hk('content-type')]).toLowerCase() : '';
        if (c.includes('json')) { try { data = JSON.parse(body); } catch { data = body; } }
        else if (c.includes('x-www-form-urlencoded')) data = body ? Object.fromEntries(new URLSearchParams(body)) : {};
        else data = body;
      } else data = body;
    }
    const ms = (init.signal && init.signal.__ms) || 25000;
    const sig = init.signal;
    if (sig && sig.aborted) throw new DOMException('Aborted', 'AbortError');
    let onAbort;
    const aborted = new Promise((_ok, bad) => { if (sig) { onAbort = () => bad(new DOMException('Aborted', 'AbortError')); sig.addEventListener('abort', onAbort); } });
    let res;
    try {
      res = await Promise.race([http.request({ url, method, headers, data, responseType: 'arraybuffer', connectTimeout: ms, readTimeout: ms, disableRedirects: init.redirect === 'manual' }), aborted]);
    } finally { if (sig && onAbort) sig.removeEventListener('abort', onAbort); }
    const bytes = typeof res.data === 'string' && res.data ? b64ToU8(res.data) : new Uint8Array(0);
    const hm = {}; Object.keys(res.headers || {}).forEach((k) => { hm[k.toLowerCase()] = res.headers[k]; });
    const out = {
      ok: res.status >= 200 && res.status < 300, status: res.status, statusText: '', url: res.url || url, redirected: false, body: null,
      headers: { get: (n) => (hm[String(n).toLowerCase()] != null ? String(hm[String(n).toLowerCase()]) : null), has: (n) => String(n).toLowerCase() in hm, forEach: (f) => Object.keys(hm).forEach((k) => f(hm[k], k)), getSetCookie: () => (hm['set-cookie'] ? [].concat(hm['set-cookie']) : []) },
      text: async () => new TextDecoder('utf-8').decode(bytes),
      json: async () => JSON.parse(new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '')),
      arrayBuffer: async () => bytes.buffer.slice(0),
      clone() { return out; }
    };
    return out;
  }

  /* ---------- مجسّمات Electron / Node ---------- */
  const handlers = Object.create(null), listeners = Object.create(null);
  const emit = (ch, p) => (listeners[ch] || []).forEach((f) => { try { f(p); } catch {} });
  const on = (ch, f) => { (listeners[ch] = listeners[ch] || []).push(f); };
  const noop = () => {};
  class Dummy { constructor() {} on() { return this; } show() {} destroy() {} setToolTip() {} setContextMenu() {} static isSupported() { return false; } static getAllWindows() { return []; } static fromWebContents() { return null; } static buildFromTemplate() { return {}; } static createFromPath() { return { resize() { return {}; } }; } }
  const APP_VERSION = CFG.VERSION || '1.0.0';
  const electron = {
    app: { commandLine: { appendSwitch: noop }, getPath: () => '/ud', getVersion: () => APP_VERSION, whenReady: () => new Promise(noop), on: noop, quit: noop, requestSingleInstanceLock: () => true, setAppUserModelId: noop, setLoginItemSettings: noop },
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; }, on: noop },
    BrowserWindow: Dummy, Notification: Dummy, Tray: Dummy, Menu: Dummy, nativeImage: Dummy,
    shell: { openPath: noop, openExternal: (u) => openExternal(u) },
    safeStorage: { isEncryptionAvailable: () => false },
    protocol: { registerSchemesAsPrivileged: noop, handle: noop },
    session: { defaultSession: { webRequest: { onBeforeSendHeaders: noop, onHeadersReceived: noop } } }
  };
  // fs مصغّر مخزّن في localStorage (custom.json، جلسة الحساب، ...)
  const FSK = 'wa.fs:';
  const fsStub = {
    existsSync: (p) => LS.get(FSK + p) != null,
    mkdirSync: noop, unlinkSync: (p) => LS.del(FSK + p), rmSync: (p) => LS.del(FSK + p), readdirSync: () => [],
    statSync: (p) => ({ size: (LS.get(FSK + p) || '').length }),
    readFileSync: (p, enc) => {
      const v = LS.get(FSK + p); if (v == null) { const e = new Error('ENOENT: ' + p); e.code = 'ENOENT'; throw e; }
      const s = v.slice(2), buf = v[0] === 'b' ? Buf.from(s, 'base64') : Buf.from(s, 'utf8');
      return enc ? buf.toString(typeof enc === 'string' ? enc : 'utf8') : buf;
    },
    writeFileSync: (p, d) => LS.set(FSK + p, d instanceof Uint8Array ? 'b:' + Buf.from(d).toString('base64') : 's:' + String(d))
  };
  const pathStub = { join: (...a) => a.join('/').replace(/\/+/g, '/'), dirname: (p) => String(p).replace(/\/[^/]*$/, '') || '/', basename: (p) => String(p).split('/').pop(), resolve: (...a) => a.join('/') };
  const unsupported = (n) => () => { throw new Error(n + ' غير مدعوم على الأندرويد'); };
  const nodeMods = {
    electron, fs: fsStub, path: pathStub, os: { hostname: () => 'Android' },
    http: { createServer: unsupported('http server') }, net: {}, crypto: { createHash: unsupported('crypto') },
    child_process: { spawn: unsupported('ffmpeg') }, url: { pathToFileURL: (p) => ({ href: 'file://' + p }) },
    webtorrent: class { constructor() { throw new Error('التورنت غير مدعوم على الأندرويد'); } },
    'ffmpeg-static': ''
  };
  const proc = { env: {}, platform: 'android', argv: [], versions: {}, cwd: () => '/' };

  /* require مصغّر يحمّل ملفات المشروع (stardima/*) عبر XHR متزامن */
  const modCache = Object.create(null);
  const srcCache = Object.create(null);
  const loadText = (path) => {
    if (srcCache[path] != null) return srcCache[path];
    const x = new XMLHttpRequest(); x.open('GET', path, false); x.send(null);
    if (x.status && x.status !== 200) throw new Error('تعذّر تحميل ' + path);
    return (srcCache[path] = x.responseText);
  };
  const join = (base, rel) => { const parts = (base ? base.split('/') : []).concat(rel.split('/')); const out = []; for (const p of parts) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); } return out.join('/'); };
  function makeRequire(dir) {
    return (name) => {
      if (name in nodeMods) return nodeMods[name];
      if (name === 'discord' || name === './discord') throw new Error('discord غير مدعوم');
      if (name[0] !== '.') throw new Error('Cannot find module ' + name);
      let p = join(dir, name); if (!/\.js$/.test(p)) p += '.js';
      if (modCache[p]) return modCache[p].exports;
      const m = { exports: {} }; modCache[p] = m;
      const d = p.split('/').slice(0, -1).join('/');
      new Function('require', 'module', 'exports', 'process', '__dirname', 'Buffer', 'fetch', loadText(p))(makeRequire(d), m, m.exports, proc, '/' + d, Buf, nfetch);
      return m.exports;
    };
  }
  // نشغّل منطق main.js كما هو
  try {
    const m = { exports: {} };
    new Function('require', 'module', 'exports', 'process', '__dirname', 'Buffer', 'fetch', loadText('logic/main.js'))(makeRequire(''), m, m.exports, proc, '/', Buf, nfetch);
  } catch (e) { console.error('[bridge] main logic failed:', e); }
  const invoke = (ch, ...args) => {
    const h = handlers[ch];
    if (!h) return Promise.reject(new Error('غير مدعوم: ' + ch));
    try { return Promise.resolve(h({ sender: { send: emit } }, ...args)); } catch (e) { return Promise.reject(e); }
  };

  /* ---------- روابط الفيديو: نمرّرها عبر البروكسي عند الحاجة ---------- */
  const wrapStream = (s) => (s && s.url && (s.referer || s.type === 'hls' || /\.m3u8(\?|$)/i.test(s.url)) ? Object.assign({}, s, { url: proxify(s.url, s.referer) }) : s);
  const baseSdStreams = handlers['sd:streams'], baseResolve = handlers['host:resolve'], baseCheck = handlers['host:check'];
  if (baseSdStreams) handlers['sd:streams'] = async (e, ref) => { const r = await baseSdStreams(e, ref); return r && Array.isArray(r.streams) ? Object.assign({}, r, { streams: r.streams.map(wrapStream) }) : r; };
  if (baseResolve) handlers['host:resolve'] = async (e, u) => wrapStream(await baseResolve(e, u));

  /* ---------- وظائف خاصة بالأندرويد ---------- */
  function openExternal(url) {
    if (!/^(https?|magnet|intent):/i.test(String(url))) return false;
    const B = plug('Browser');
    if (B) { B.open({ url: String(url) }).catch(() => window.open(url, '_blank')); } else window.open(url, '_blank');
    return true;
  }
  handlers['open:external'] = async (_e, u) => openExternal(u);
  handlers['win:min'] = handlers['win:close'] = async () => true;
  handlers['win:max'] = async () => false;
  handlers['bg:set'] = async () => true;
  handlers['rpc:set'] = handlers['rpc:enable'] = async () => true;
  handlers['wp:name'] = async () => 'Android';
  handlers['wp:fs'] = async (_e, on_) => {
    try {
      if (on_) { await document.documentElement.requestFullscreen(); if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape').catch(noop); }
      else { if (document.fullscreenElement) await document.exitFullscreen(); if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); }
    } catch {}
    return true;
  };
  handlers['torrent:start'] = async () => { throw new Error('التورنت غير مدعوم على الأندرويد — اختر سيرفراً آخر.'); };
  handlers['transcode:start'] = async () => { throw new Error('التحويل غير مدعوم على الأندرويد — اختر جودة/سيرفراً آخر.'); };

  // إشعارات محلية
  handlers['notify:show'] = async (_e, { title, body, id }) => {
    const L = plug('LocalNotifications'); if (!L) return false;
    try {
      let p = await L.checkPermissions(); if (p.display !== 'granted') p = await L.requestPermissions();
      if (p.display !== 'granted') return false;
      await L.schedule({ notifications: [{ id: Math.floor(Math.random() * 2e9), title: String(title || 'WayAnime').slice(0, 120), body: String(body || '').slice(0, 250), extra: { id: id || '' } }] });
      return true;
    } catch { return false; }
  };
  try { const L = plug('LocalNotifications'); if (L && L.addListener) L.addListener('localNotificationActionPerformed', (e) => { const id = e && e.notification && e.notification.extra && e.notification.extra.id; if (id) emit('notify:open', id); }); } catch {}

  // أنمي يضيفه المستخدم: محرّر JSON بسيط داخل التطبيق
  handlers['custom:open'] = async () => {
    await invoke('custom:list').catch(noop);   // يضمن وجود الملف
    const file = '/ud/custom.json', cur = (LS.get(FSK + file) || 's:[]').slice(2);
    const ov = document.createElement('div'); ov.className = 'wa-editor';
    ov.innerHTML = '<div class="wa-ed-box"><b>أنمي أضفته (custom.json)</b><textarea spellcheck="false" dir="ltr"></textarea><div><button class="ghostb" data-a="x">إلغاء</button><button class="primary" data-a="s">حفظ</button></div></div>';
    ov.querySelector('textarea').value = cur;
    ov.onclick = (ev) => {
      const a = ev.target.closest('button[data-a]'); if (!a && ev.target !== ov) return;
      if (a && a.dataset.a === 's') { const t = ov.querySelector('textarea').value; try { JSON.parse(t); } catch (e) { return alert('JSON غير صالح: ' + e.message); } fsStub.writeFileSync(file, t); }
      ov.remove();
    };
    document.body.appendChild(ov); return true;
  };

  // التحديث: يقرأ آخر Release من GitHub ويبحث عن ملف APK
  handlers['app:version'] = async () => { try { const A = plug('App'); if (A && A.getInfo) return (await A.getInfo()).version; } catch {} return APP_VERSION; };
  const vcmp = (a, b) => { const x = String(a).replace(/^v/i, '').split('.').map(Number), y = String(b).replace(/^v/i, '').split('.').map(Number); for (let i = 0; i < 4; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };
  handlers['update:check'] = async () => {
    if (!/^[\w.-]+\/[\w.-]+$/.test(CFG.UPDATE_REPO || '')) return null;
    try {
      const r = await nfetch('https://api.github.com/repos/' + CFG.UPDATE_REPO + '/releases/latest', { headers: { 'User-Agent': 'WayAnime', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000) });
      if (!r.ok) return null; const j = await r.json();
      const apk = (j.assets || []).find((x) => /\.apk$/i.test(x.name));
      return { tag: String(j.tag_name || ''), name: j.name || '', url: j.html_url, download: apk ? apk.browser_download_url : '' };
    } catch { return null; }
  };
  handlers['update:install'] = async (_e, url) => { openExternal(url); return true; };
  void vcmp;

  // التحميلات: Filesystem + downloadFile (ملفات mp4 المباشرة فقط)
  const DLK = 'wa.dl';
  const dlRead = () => { try { return JSON.parse(LS.get(DLK) || '[]'); } catch { return []; } };
  const dlWrite = (l) => LS.set(DLK, JSON.stringify(l));
  const dlJobs = new Map();
  const toUrl = (uri) => (Cap.convertFileSrc ? Cap.convertFileSrc(uri) : uri);
  handlers['dl:list'] = async () => {
    const out = dlRead().map((e) => ({ ...e, fileUrl: toUrl(e.uri), posterUrl: '' }));
    for (const j of dlJobs.values()) out.unshift({ ...j.entry });
    return out;
  };
  handlers['dl:cancel'] = async (_e, key) => { const j = dlJobs.get(key); if (j) j.cancel(); return true; };
  handlers['dl:delete'] = async (_e, key) => {
    const l = dlRead(), e = l.find((x) => x.key === key), F = plug('Filesystem');
    if (e) { try { await F.deleteFile({ path: e.path, directory: 'DATA' }); } catch {} dlWrite(l.filter((x) => x.key !== key)); }
    return true;
  };
  handlers['dl:start'] = async (_e, job) => {
    job = job || {}; const F = plug('Filesystem'); if (!F) return { ok: false, error: 'التحميل غير متاح' };
    const key = String(job.animeId) + ':' + String(job.num);
    if (dlJobs.has(key)) return { ok: false, error: 'التحميل جاري' };
    if (dlRead().some((x) => x.key === key)) return { ok: false, error: 'هذه الحلقة محمّلة من قبل' };
    const px = unproxify(String(job.url || '')); const url = px.url;
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'رابط غير صالح' };
    if (/\.m3u8(\?|$)/i.test(url) || job.type === 'hls') return { ok: false, error: 'سيرفرات HLS لا تُحمَّل على الأندرويد — اختر سيرفر mp4 (مثل Mediafire).' };
    const safe = (t) => String(t || '').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || 'anime';
    const path = 'downloads/' + safe(job.name) + '_' + safe(job.num) + '_' + Date.now().toString(36) + '.mp4';
    const entry = { key, animeId: job.animeId, name: job.name || '', poster: job.poster || '', posterUrl: '', num: String(job.num), size: 0, t: Date.now(), status: 'downloading', pct: 0 };
    let cancelled = false, lis = null;
    dlJobs.set(key, { entry, cancel: () => { cancelled = true; /* لا يوجد إلغاء أصلي: نتجاهل النتيجة ونحذف الملف */ send({ status: 'cancelled' }); } });
    const send = (x) => { Object.assign(entry, x || {}); emit('dl:progress', { ...entry }); };
    (async () => {
      try {
        lis = await F.addListener('progress', (p) => { if (p && p.url === url && p.contentLength) send({ got: p.bytes, total: p.contentLength, pct: Math.min(99, Math.round(p.bytes / p.contentLength * 100)) }); });
        const headers = { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36' };
        if (px.referer) { headers.Referer = px.referer; try { headers.Origin = new URL(px.referer).origin; } catch {} }
        const r = await F.downloadFile({ url, path, directory: 'DATA', progress: true, recursive: true, headers });
        if (cancelled) throw new Error('cancelled');
        const st = await F.stat({ path, directory: 'DATA' });
        if (st.size < 200 * 1024) throw new Error('الملف المحمّل صغير جداً (ربما صفحة بدل الفيديو)');
        dlWrite([...dlRead().filter((x) => x.key !== key), { key, animeId: entry.animeId, name: entry.name, poster: entry.poster, num: entry.num, path, uri: r.path || (await F.getUri({ path, directory: 'DATA' })).uri, size: st.size, t: Date.now(), status: 'done' }]);
        dlJobs.delete(key); send({ status: 'done', pct: 100, size: st.size });
      } catch (err) {
        try { await F.deleteFile({ path, directory: 'DATA' }); } catch {}
        dlJobs.delete(key); if (!cancelled) send({ status: 'error', error: String((err && err.message) || err) });
      } finally { try { lis && lis.remove(); } catch {} }
    })();
    return { ok: true, key };
  };

  /* ---------- window.api (نفس شكل preload.js) ---------- */
  const I = (ch) => (...a) => invoke(ch, ...a);
  window.api = {
    get: I('addon:get'), text: I('addon:text'), translate: I('translate'), anilist: I('anilist:info'),
    bg: I('bg:set'), onHidden: noop, notify: I('notify:show'), onNotifyOpen: (cb) => on('notify:open', cb),
    anilistDesc: I('anilist:desc'), anilistRelated: I('anilist:related'), anilistChars: I('anilist:chars'), anilistCover: I('anilist:cover'),
    torrent: I('torrent:start'), transcode: I('transcode:start'),
    acct: { me: I('acct:me'), login: I('acct:login'), logout: I('acct:logout'), site: I('acct:site') },
    sync: { get: I('sync:get'), put: I('sync:put') },
    win: { min: I('win:min'), max: I('win:max'), close: I('win:close') },
    ar: { list: I('ar:list'), search: I('ar:search'), episodes: I('ar:episodes'), streams: I('ar:streams'), direct: I('ar:direct') },
    dl: { list: I('dl:list'), start: I('dl:start'), cancel: I('dl:cancel'), remove: I('dl:delete'), onProgress: (cb) => on('dl:progress', cb) },
    host: { resolve: I('host:resolve'), check: I('host:check') },
    sd: { catalog: I('sd:catalog'), meta: I('sd:meta'), streams: I('sd:streams') },
    custom: { list: I('custom:list'), open: I('custom:open') },
    html: I('web:html'), manga: I('manga:api'), mlk: I('mlk:get'),
    update: { version: I('app:version'), check: I('update:check'), install: I('update:install'), onProgress: (cb) => on('update:progress', cb) },
    wp: { name: I('wp:name'), fs: I('wp:fs') },
    rpc: { set: I('rpc:set'), enable: I('rpc:enable') },
    announce: I('announce:get'), openExternal: I('open:external'),
    platform: 'android'
  };

  /* ---------- زر الرجوع + شريط الحالة + شاشة البداية ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    document.documentElement.classList.add('android');
    const App = plug('App');
    if (App && App.addListener) App.addListener('backButton', () => {
      if (document.fullscreenElement) { document.exitFullscreen().catch(noop); return; }
      const overlay = document.querySelector('.cfov, #pl, #sm, .wa-editor, .srch, #srch');
      if (overlay) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); if (overlay.classList.contains('wa-editor')) overlay.remove(); return; }
      const b = document.getElementById('wBack');
      if (b && !b.disabled) { b.click(); return; }
      const home = document.getElementById('nHome');
      if (home && !home.classList.contains('on')) { home.click(); return; }
      if (App.exitApp) App.exitApp();
    });
    const SB = plug('StatusBar'); if (SB) { SB.setStyle && SB.setStyle({ style: 'DARK' }).catch(noop); SB.setBackgroundColor && SB.setBackgroundColor({ color: '#07060c' }).catch(noop); }
    const SS = plug('SplashScreen'); if (SS && SS.hide) setTimeout(() => SS.hide().catch(noop), 400);
  });
})();
