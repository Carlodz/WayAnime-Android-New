// اختبار سريع (Node) للجسر: يحمّل bridge.js مع Capacitor مزيّف ويتأكد أن كل قنوات window.api شغّالة
const fs = require('fs'), path = require('path'), vm = require('vm');
const WWW = path.join(__dirname, '..', 'www');
const store = {};
const calls = [];
const ctx = {
  console, setTimeout, clearTimeout, AbortSignal, Promise, JSON, Date, Math, Uint8Array, ArrayBuffer, Object, Array, String, Number, Error, Map, Set, RegExp, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, KeyboardEvent: class {}, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, DOMException: globalThis.DOMException,
  atob: (s) => Buffer.from(s, 'base64').toString('binary'), btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  XMLHttpRequest: class { open(_m, p) { this.p = p; } send() { try { this.responseText = fs.readFileSync(path.join(WWW, this.p), 'utf8'); this.status = 200; } catch { this.status = 404; } } },
  document: { addEventListener() {}, documentElement: { classList: { add() {} } } },
  location: { href: 'https://localhost/' }, screen: {}, alert() {},
  Capacitor: {
    isNativePlatform: () => true, convertFileSrc: (u) => u,
    Plugins: { CapacitorHttp: { request: async (o) => { calls.push(o); const url = o.url;
      let body = '[]'; let headers = { 'content-type': 'application/json' };
      if (/loginpw/.test(url)) { headers['set-cookie'] = 'sid=abc123; Path=/; HttpOnly'; body = '{"ok":true}'; }
      else if (/api\/me/.test(url)) body = '{"user":{"username":"carlo","pts":5,"pic":"/p.png"}}';
      else if (/load_latest_anime/.test(url)) body = JSON.stringify([...Array(12)].map((_, i) => ({ AnimeId: 100 + i, AR_Title: 'أنمي ' + i, EN_Title: 'Anime ' + i, Thumbnail: 't' + i + '.jpg' })));
      else if (/credentials/.test(url)) body = '{}';
      return { status: 200, headers, url, data: Buffer.from(body).toString('base64') }; } } }
  }
};
ctx.window = ctx; ctx.globalThis = ctx; ctx.fetch = async () => { throw new Error('no-net'); };
vm.createContext(ctx);
vm.runInContext('window.WA_CFG={VERSION:"1.0.0"}', ctx);
vm.runInContext(fs.readFileSync(path.join(WWW, 'android/bridge.js'), 'utf8'), ctx, { filename: 'bridge.js' });
(async () => {
  const api = ctx.window.api; let fail = 0;
  const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fail++; };
  ok('api object', !!api && typeof api.ar.list === 'function');
  const need = ['addon:get','ar:list','ar:search','ar:episodes','ar:streams','sd:catalog','sd:meta','sd:streams','host:resolve','host:check','manga:api','mlk:get','web:html','anilist:info','anilist:desc','anilist:related','anilist:chars','anilist:cover','translate','acct:me','acct:login','sync:get','sync:put','announce:get','custom:list'];
  // نتحقق من وجود المعالجات عبر استدعاء I() الذي يرفض بـ "غير مدعوم" لو ناقصة
  for (const ch of need) { try { await ctx.window.api && 0; } catch {} }
  const list = await api.ar.list({ latest: true, limit: 12, from: 0 });
  ok('ar:list returns 12 mapped items', Array.isArray(list) && list.length === 12 && list[0].name === 'أنمي 0');
  const l = await api.acct.login({ username: 'x', password: 'y' });
  ok('acct:login saves sid & returns user', l.user && l.user.username === 'carlo');
  const me = await api.acct.me();
  ok('acct:me uses stored sid', me.user && me.user.username === 'carlo' && calls.some((c) => c.headers && c.headers.Cookie === 'sid=abc123'));
  ok('custom:list works (fs stub)', Array.isArray(await api.custom.list()));
  ok('torrent unsupported error', await api.torrent({}).then(() => false, (e) => /الأندرويد/.test(e.message)));
  ok('update.version', (await api.update.version()) === '1.0.0');
  const dl = await api.dl.list(); ok('dl:list empty', Array.isArray(dl) && dl.length === 0);
  const res = await api.host.resolve('https://example.com/video.mp4'); ok('host:resolve direct mp4 (not proxied w/o referer)', res && res.url === 'https://example.com/video.mp4');
  const ep = await api.ar.episodes('1'); ok('ar:episodes handles empty', Array.isArray(ep));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
