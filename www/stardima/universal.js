// Universal server resolver for WayAnime.
// Goal: turn ANY server link (embed page) into a direct stream (m3u8 / mp4 / webm)
// that the in-app player can read. Order of attempts:
//   1) host-specific extractors (Streamtape, Doodstream, Voe, OK.ru, VK, Google Drive...)
//   2) the existing generic extractor (hosts.js: unwrap, packer, validation form)
//   3) deep scan: unpack JS, atob() strings, <source>/<video>, then follow <iframe>s
// If nothing works the caller falls back to showing the embed inside the app.

const { resolveHost, extractCandidates, normalizeUrl, UA } = require('./hosts');
const { unpackAll } = require('./unpacker');

const MEDIA_RE = /\.(mp4|m3u8|webm|mkv|avi|mov|m4v|flv|ts|ogv|3gp)(\?|#|$)/i;
const AD_HOST = /(doubleclick|googlesyndication|google-analytics|googletagmanager|facebook\.|twitter\.|histats|popads|adsterra|onclickads|disqus|recaptcha|gstatic|youtube\.com\/(?:iframe_api))/i;

async function fetchT(url, opts = {}, ms = 12000) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(to); }
}
async function getText(url, referer, ms = 12000, extra = {}) {
  const headers = { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', ...extra };
  if (referer) headers['Referer'] = referer;
  const res = await fetchT(url, { headers, redirect: 'follow' }, ms);
  const text = await res.text();
  return { text, url: res.url || url, status: res.status };
}
const originOf = (u) => { try { return new URL(u).origin + '/'; } catch { return ''; } };
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const lastSeg = (u) => { try { return new URL(u).pathname.split('/').filter(Boolean).pop() || ''; } catch { return ''; } };
const typeOf = (u) => (/\.m3u8(\?|#|$)/i.test(u) || /\/hls\/|master\.txt|\/playlist/i.test(u) ? 'hls' : 'mp4');
const decodeEnt = (s) => String(s || '').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const cleanEsc = (s) => String(s || '').replace(/\\\//g, '/').replace(/\\u0026/gi, '&').replace(/\\u002F/gi, '/').replace(/&amp;/g, '&');

// A link only counts when the first bytes can really be fetched (several hosts hand
// out a link and then answer 403 when the player opens it).
async function probe(url, referer, ms = 7000, type = '') {
  try {
    const hls = type === 'hls' || /\.m3u8(\?|#|$)/i.test(url);
    const headers = { 'User-Agent': UA, Accept: '*/*' };
    if (!hls) headers.Range = 'bytes=0-1';
    if (referer) headers['Referer'] = referer;
    const res = await fetchT(url, { headers, redirect: 'follow' }, ms);
    if (!(res.ok || res.status === 206)) { try { res.body && res.body.cancel(); } catch {} return false; }
    if (hls) { const t = (await res.text()).slice(0, 400); return t.includes('#EXTM3U'); }   // لازم يكون playlist حقيقي
    try { res.body && res.body.cancel(); } catch {}
    return !/text\/html|application\/json/i.test(res.headers.get('content-type') || '');   // صفحة خطأ ماشي فيديو
  } catch { return false; }
}
async function firstWorking(list, referer) {
  const cand = [...new Set(list.filter(Boolean))].slice(0, 5);
  for (const u of cand) if (await probe(u, referer)) return u;
  return null;
}

// ---------- host-specific extractors ----------
async function streamtape(u) {
  const id = lastSeg(u).replace(/\.html$/, '');
  const origin = new URL(u).origin;
  const page = await getText(/\/e\//.test(u) ? u : `${origin}/e/${id}`, origin + '/');
  const exprs = [...page.text.matchAll(/getElementById\(['"](?:robotlink|ideoooolink|norobotlink|botlink)['"]\)\.innerHTML\s*=\s*([^;]+);/g)].map((m) => m[1]);
  let best = null;
  for (const ex of exprs) {
    let out = '';
    for (const m of ex.matchAll(/\(\s*['"]([^'"]*)['"]\s*\)((?:\.substring\(\d+\))+)|['"]([^'"]*)['"]/g)) {
      if (m[1] !== undefined) {
        let s = m[1];
        for (const n of m[2].matchAll(/\.substring\((\d+)\)/g)) s = s.substring(+n[1]);
        out += s;
      } else out += m[3];
    }
    if (/get_video/.test(out) && /token=/.test(out)) best = out;
  }
  if (!best) return null;
  let url = best.startsWith('//') ? 'https:' + best : best;
  if (!/stream=1/.test(url)) url += '&stream=1';
  return { url, type: 'mp4', referer: origin + '/' };
}

async function doodstream(u) {
  const x = new URL(u), id = lastSeg(u);
  const embed = `${x.origin}/e/${id}`;
  const page = await getText(embed, embed);
  const m = page.text.match(/\/pass_md5\/[^'"\s]+/);
  if (!m) return null;
  const token = m[0].split('/').pop();
  const base = (await getText(x.origin + m[0], embed)).text.trim();
  if (!/^https?:\/\//i.test(base)) return null;
  const ch = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let rnd = ''; for (let i = 0; i < 10; i++) rnd += ch[Math.floor(Math.random() * ch.length)];
  return { url: `${base}${rnd}?token=${token}&expiry=${Date.now()}`, type: 'mp4', referer: x.origin + '/' };
}

const rot13 = (s) => s.replace(/[a-zA-Z]/g, (c) => { const b = c <= 'Z' ? 65 : 97; return String.fromCharCode(((c.charCodeAt(0) - b + 13) % 26) + b); });
function voeDecode(enc) {
  let s = rot13(enc);
  for (const p of ['@$', '^^', '~@', '%?', '*~', '!!', '#&']) s = s.split(p).join('');
  s = Buffer.from(s, 'base64').toString('latin1');
  s = s.split('').map((c) => String.fromCharCode(c.charCodeAt(0) - 3)).join('');
  s = s.split('').reverse().join('');
  return JSON.parse(Buffer.from(s, 'base64').toString('utf8'));
}
async function voe(u) {
  let page = await getText(u, 'https://voe.sx/');
  for (let i = 0; i < 2; i++) {   // voe often answers with a tiny JS redirect to a rotating domain
    const r = page.text.match(/(?:window\.location(?:\.href)?|location\.href)\s*=\s*['"](https?:\/\/[^'"]+)['"]/);
    if (r && page.text.length < 4000) page = await getText(r[1], page.url); else break;
  }
  const html = page.text, ref = originOf(page.url);
  try {
    const m = html.match(/<script[^>]*type=["']application\/json["'][^>]*>\s*\[?\s*"([^"]+)"\s*\]?\s*<\/script>/i);
    if (m) {
      const j = voeDecode(m[1]);
      const url = j.source || j.direct_access_url || j.file || (j.sources && j.sources[0] && j.sources[0].file);
      if (url && /^https?:/.test(url)) return { url, type: typeOf(url), referer: ref };
    }
  } catch { /* try the older format below */ }
  const o = html.match(/['"](?:hls|mp4)['"]\s*:\s*['"]([A-Za-z0-9+/=]{20,})['"]/g);
  if (o) for (const g of o) {
    try { const url = Buffer.from(g.match(/['"]([A-Za-z0-9+/=]{20,})['"]$/)[1], 'base64').toString('utf8'); if (/^https?:/.test(url)) return { url, type: typeOf(url), referer: ref }; } catch {}
  }
  return null;
}

async function okru(u) {
  const id = (u.match(/(?:videoembed|video)\/(\d+)/) || [])[1] || lastSeg(u);
  const page = await getText(`https://ok.ru/videoembed/${id}`, 'https://ok.ru/');
  const m = page.text.match(/data-options="([^"]+)"/);
  if (!m) return null;
  const opts = JSON.parse(decodeEnt(m[1]));
  const meta = JSON.parse(opts.flashvars.metadata);
  if (meta.hlsManifestUrl) return { url: meta.hlsManifestUrl, type: 'hls', referer: 'https://ok.ru/' };
  const order = ['mobile', 'lowest', 'low', 'sd', 'hd', 'full', 'quad', 'ultra'];
  const vids = (meta.videos || []).slice().sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  const v = vids[vids.length - 1];
  return v && v.url ? { url: v.url, type: 'mp4', referer: 'https://ok.ru/' } : null;
}

async function vk(u) {
  const page = await getText(u.replace('vkvideo.ru', 'vk.com'), 'https://vk.com/');
  const t = cleanEsc(page.text);
  const hls = t.match(/"hls":"(https?:[^"]+)"/);
  const q = [...t.matchAll(/"url(\d{3,4})":"(https?:[^"]+)"/g)].sort((a, b) => +b[1] - +a[1]);
  if (q.length) return { url: q[0][2], type: 'mp4', referer: 'https://vk.com/' };
  return hls ? { url: hls[1], type: 'hls', referer: 'https://vk.com/' } : null;
}

function gdrive(u) {
  const id = (u.match(/\/d\/([\w-]{15,})/) || u.match(/[?&]id=([\w-]{15,})/) || [])[1];
  return id ? { url: `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`, type: 'mp4', referer: '' } : null;
}

async function mp4upload(u) {
  const id = lastSeg(u).replace(/^embed-/, '').replace(/\.html$/, '');
  const page = await getText(`https://www.mp4upload.com/embed-${id}.html`, 'https://www.mp4upload.com/');
  const m = page.text.match(/src\s*:\s*["'](https?:[^"']+\.mp4[^"']*)["']/i) || page.text.match(/["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i);
  return m ? { url: m[1], type: 'mp4', referer: 'https://www.mp4upload.com/' } : null;
}
async function sibnet(u) {
  const id = (u.match(/videoid=(\d+)/) || u.match(/video(\d+)/) || [])[1];
  if (!id) return null;
  const page = await getText(`https://video.sibnet.ru/shell.php?videoid=${id}`, 'https://video.sibnet.ru/');
  const m = page.text.match(/src\s*:\s*["'](\/v\/[^"']+\.mp4[^"']*)["']/i);
  return m ? { url: 'https://video.sibnet.ru' + m[1], type: 'mp4', referer: 'https://video.sibnet.ru/' } : null;
}
async function yourupload(u) {
  const id = lastSeg(u);
  const page = await getText(`https://www.yourupload.com/embed/${id}`, 'https://www.yourupload.com/');
  const m = page.text.match(/file\s*:\s*["']([^"']+)["']/i) || page.text.match(/og:video["'][^>]*content=["']([^"']+)["']/i);
  return m ? { url: m[1], type: 'mp4', referer: 'https://www.yourupload.com/' } : null;
}
function pixeldrain(u) {
  const id = (u.match(/pixeldrain\.[a-z]+\/(?:u|api\/file)\/([\w-]+)/i) || [])[1];
  return id ? { url: `https://pixeldrain.com/api/file/${id}`, type: 'mp4', referer: 'https://pixeldrain.com/' } : null;
}
async function sendvid(u) {
  const page = await getText(u, 'https://sendvid.com/');
  const m = page.text.match(/<source[^>]+src=["']([^"']+)["']/i) || page.text.match(/og:video(?::url)?["'][^>]*content=["']([^"']+)["']/i);
  return m ? { url: decodeEnt(m[1]), type: 'mp4', referer: 'https://sendvid.com/' } : null;
}


// ---- عائلات سيرفرات تُخفي الرابط داخل JS مضغوط (p,a,c,k,e,d): نفتح صفحة /e/ ونفكّها ----
const PACKED_RE = /streamwish|awish|dwish|wishfast|embedwish|hlswish|swhoi|sfastwish|strwish|wishonly|vidhide|vidhidepro|vidhidevip|dhcplay|filelions|vidspeed|callistanise|filemoon|moonplayer|kerapoxy|bysezoxexe|lulustream|luluvdo|lulu\.st|vidmoly|streamhg|earnvids|minochinos|mivalyo|ryderjet|upstream|vtube|streamvid|uqload|vidoza|vidlox|gounlimited|clipwatching|evoload|hexload|mp4player/i;
async function packedEmbed(u) {
  const origin = new URL(u).origin;
  const id = lastSeg(u).replace(/\.html?$/i, '');
  let emb = u;
  if (!/\/(?:e|embed|v|embed-[^/]*)(?:\/|$)|\/embed-/.test(u)) emb = /vidmoly|uqload|vidoza/i.test(origin) ? `${origin}/embed-${id}.html` : `${origin}/e/${id}`;
  return deep(emb, 1, new Set([emb]), origin + '/');
}
async function mixdrop(u) {
  const origin = new URL(u).origin, id = lastSeg(u);
  const emb = /\/e\//.test(u) ? u : `${origin}/e/${id}`;
  const page = await getText(emb, origin + '/');
  let blob = ''; try { blob = unpackAll(page.text); } catch {}
  blob = cleanEsc(blob + '\n' + page.text);
  const m = blob.match(/wurl\s*=\s*["']([^"']+)["']/);
  if (!m) return null;
  let url = m[1]; if (url.startsWith('//')) url = 'https:' + url;
  return { url, type: 'mp4', referer: origin + '/' };
}
async function dailymotion(u) {
  const id = (u.match(/(?:video\/|dai\.ly\/|video=)([a-z0-9]+)/i) || [])[1] || lastSeg(u).split('_')[0];
  if (!id) return null;
  const page = await getText(`https://www.dailymotion.com/player/metadata/video/${id}`, 'https://www.dailymotion.com/');
  let j; try { j = JSON.parse(page.text); } catch { return null; }
  const a = j && j.qualities && j.qualities.auto && j.qualities.auto[0];
  return a && a.url ? { url: a.url, type: 'hls', referer: 'https://www.dailymotion.com/' } : null;
}

async function specific(u, host) {
  if (/streamtape|strtape|strcloud|tapecontent|streamadblock|shavetape|stape\./i.test(host)) return streamtape(u);
  if (/dood|d0+o+d|dsvplay|ds2play|playmogo|vide0\.net|do7go|myvidplay/i.test(host)) return doodstream(u);
  if (/voe|jilliandescribecompany|lauradaydo|diananatureforeign|mikaylaarealike|jonathansmoney|donaldlineelse/i.test(host)) return voe(u);
  if (/(^|\.)ok\.ru$|odnoklassniki/i.test(host)) return okru(u);
  if (/(^|\.)vk\.com$|vkvideo\.ru/i.test(host)) return vk(u);
  if (/drive\.google\.com|docs\.google\.com/i.test(host)) return gdrive(u);
  if (/mp4upload/i.test(host)) return mp4upload(u);
  if (/sibnet/i.test(host)) return sibnet(u);
  if (/yourupload/i.test(host)) return yourupload(u);
  if (/pixeldrain/i.test(host)) return pixeldrain(u);
  if (/sendvid/i.test(host)) return sendvid(u);
  if (/mixdrop|mixdrp|mdy48tn|mxcontent|mdbekjwqa|mdfx9dc8n/i.test(host)) return mixdrop(u);
  if (/dailymotion|(^|\.)dai\.ly$/i.test(host)) return dailymotion(u);
  if (PACKED_RE.test(host)) return packedEmbed(u);
  return null;
}

// ---------- generic deep scan ----------
function scanPage(html, base) {
  let blob = '';
  try { blob = unpackAll(html); } catch {}
  blob = cleanEsc(blob + '\n' + html);
  // atob("...") strings that hide a URL
  for (const m of blob.matchAll(/atob\(\s*['"]([A-Za-z0-9+/=]{16,})['"]\s*\)/g)) {
    try { blob += '\n' + Buffer.from(m[1], 'base64').toString('utf8'); } catch {}
  }
  const cand = extractCandidates(blob);
  for (const m of blob.matchAll(/(?:\bfile|\bsrc|\bsource|\burl|\bvideo_url|\bhls)\s*[:=]\s*["']([^"']+\.(?:webm|mkv)[^"']*)["']/gi)) cand.mp4.push(normalizeUrl(m[1]));
  for (const m of blob.matchAll(/<(?:source|video)[^>]+src=["']([^"']+)["']/gi)) {
    try { const abs = new URL(decodeEnt(m[1]), base).href; if (MEDIA_RE.test(abs)) (/\.m3u8/i.test(abs) ? cand.m3u8 : cand.mp4).push(abs); } catch {}
  }
  for (const m of blob.matchAll(/<meta[^>]+(?:og:video(?::url|:secure_url)?)["'][^>]+content=["']([^"']+)["']/gi)) {
    try { const abs = new URL(decodeEnt(m[1]), base).href; if (MEDIA_RE.test(abs)) (/\.m3u8/i.test(abs) ? cand.m3u8 : cand.mp4).push(abs); } catch {}
  }
  const iframes = [];
  for (const m of html.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)) {
    try { const abs = new URL(decodeEnt(m[1]), base).href; if (/^https?:/i.test(abs) && !AD_HOST.test(abs)) iframes.push(abs); } catch {}
  }
  for (const m of blob.matchAll(/https?:\/\/[^"'\s\\<>]+\/(?:e|embed|embed-[^"'\s\\<>]*|v|player)\/[A-Za-z0-9_-]{6,}[^"'\s\\<>]*/g)) if (!AD_HOST.test(m[0])) iframes.push(m[0]);
  const uniq = (a) => [...new Set(a.filter(Boolean))];
  return { m3u8: uniq(cand.m3u8), mp4: uniq(cand.mp4), iframes: uniq(iframes) };
}

async function deep(u, depth, seen, ref) {
  let page;
  try { page = await getText(u, ref || originOf(u)); } catch { return null; }
  const referer = originOf(page.url);
  const s = scanPage(page.text, page.url);
  s.m3u8 = s.m3u8.filter((x) => /^https?:/i.test(x)); s.mp4 = s.mp4.filter((x) => /^https?:/i.test(x));
  const hlsOk = await firstWorking(s.m3u8, referer);
  if (hlsOk) return { url: hlsOk, type: 'hls', referer };
  const mp4Ok = await firstWorking(s.mp4, referer);
  if (mp4Ok) return { url: mp4Ok, type: 'mp4', referer };
  const any = s.m3u8[0] || s.mp4[0];                 // could not verify, but better than nothing
  if (any) return { url: any, type: typeOf(any), referer, unverified: true };
  for (const f of s.iframes.slice(0, 4)) {
    if (seen.has(f)) continue;
    const r = await resolve(f, depth + 1, seen, page.url);
    if (r) return r;
  }
  return null;
}

async function resolve(input, depth = 0, seen = new Set(), ref = '') {
  if (!input || depth > 3) return null;
  let u = String(input).trim();
  if (u.startsWith('//')) u = 'https:' + u;
  let host;
  try { host = hostOf(u); if (!host) return null; } catch { return null; }
  if (seen.has(u)) return null;
  seen.add(u);
  if (MEDIA_RE.test(u)) return { url: u, type: typeOf(u), referer: ref ? originOf(ref) : '' };
  let r = null;
  try { r = await specific(u, host); } catch { r = null; }
  if (r && r.url) return r;
  try { r = await resolveHost(u); } catch { r = null; }
  if (r && r.url) return r;
  try { return await deep(u, depth, seen, ref); } catch { return null; }
}

module.exports = { resolve, probe, scanPage };
