const { app, BrowserWindow, ipcMain, shell, Notification, Tray, Menu, nativeImage, safeStorage, protocol } = require('electron');
// بروتوكول داخلي لصور المانجا (البوسترات + صفحات الفصول): الطلب كيدوز من هنا بـ User-Agent صحيح وإعادة محاولة
protocol.registerSchemesAsPrivileged([{ scheme: 'mgimg', privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true } }]);
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');
const WebTorrent = require('webtorrent');

// كاش ديال الصور على القرص (500MB) باش البوسترات ما تتحملش مرة أخرى
app.commandLine.appendSwitch('disk-cache-size', String(500 * 1024 * 1024));

// ===== كاش للروابط والطلبات: نفس الطلب ما كيتعاودش (TTL) + طلبين فنفس الوقت كيتجمعو + إلا طاح السيرفر كنرجعو القديم =====
const MEMO_TTL = { 'addon:get': 300e3, 'addon:text': 300e3, 'ar:episodes': 600e3, 'ar:streams': 420e3, 'ar:direct': 420e3, 'web:html': 300e3, 'sd:catalog': 300e3, 'sd:meta': 600e3, 'sd:streams': 300e3 };
const memoOk = (v) => v != null && !(Array.isArray(v) && !v.length) && !(v && Array.isArray(v.streams) && !v.streams.length);
const _ipcHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (ch, fn) => {
  const ttl = MEMO_TTL[ch]; if (!ttl) return _ipcHandle(ch, fn);
  const store = new Map(), inflight = new Map();
  return _ipcHandle(ch, (e, ...args) => {
    const k = JSON.stringify(args), hit = store.get(k);
    if (hit && Date.now() - hit.t < ttl) return hit.v;
    if (inflight.has(k)) return inflight.get(k);
    const p = (async () => {
      try {
        const v = await fn(e, ...args);
        if (memoOk(v)) { store.set(k, { t: Date.now(), v }); if (store.size > 150) store.delete(store.keys().next().value); }
        return v;
      } catch (err) { if (hit) return hit.v; throw err; }
      finally { inflight.delete(k); }
    })();
    inflight.set(k, p); return p;
  });
};

let mainWin = null, tray = null, quitting = false, hintShown = false;
const bg = { keep: true, autostart: false };
function showMain() { const w = mainWin; if (!w) return createWindow(); if (w.isMinimized()) w.restore(); w.show(); w.focus(); }
function makeTray() {
  if (tray) return;
  try {
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')).resize({ width: 16, height: 16 }));
    tray.setToolTip('WayAnime');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'فتح WayAnime', click: showMain },
      { type: 'separator' },
      { label: 'إغلاق نهائي', click: () => { quitting = true; app.quit(); } }
    ]));
    tray.on('click', showMain);
  } catch (e) { console.log('[tray]', e.message); }
}
function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 420, minHeight: 360,
    title: 'WayAnime', icon: path.join(__dirname, 'assets', 'icon.png'), backgroundColor: '#07060c', frame: false, autoHideMenuBar: true,
    show: !process.argv.includes('--hidden'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, backgroundThrottling: false }
  });
  mainWin = win;
  // عند الإغلاق: نخبّيو النافذة فـ الـ tray ويبقى التطبيق خدام (باش الإشعارات تبقى توصل)
  win.on('close', (e) => {
    if (bg.keep && !quitting) {
      e.preventDefault();
      win.hide();
      win.webContents.send('app:hidden');   // نوقفو الفيديو
      if (!hintShown && Notification.isSupported()) { hintShown = true; new Notification({ title: 'WayAnime', body: 'التطبيق ما زال يعمل في الخلفية ليصلك إشعار بالحلقات الجديدة. يمكنك فتحه أو إغلاقه نهائياً من أيقونة الـ tray.', icon: path.join(__dirname, 'assets', 'icon.png') }).show(); }
    }
  });
  // تكبير/تصغير: Ctrl + / Ctrl - / Ctrl 0 (والعجلة مع Ctrl)، ويتحفظ
  const zf = path.join(app.getPath('userData'), 'zoom.json');
  let zoom = 1; try { zoom = Number(JSON.parse(require('fs').readFileSync(zf, 'utf8')).z) || 1; } catch {}
  const setZoom = (z) => { zoom = Math.min(2, Math.max(0.5, Math.round(z * 20) / 20)); win.webContents.setZoomFactor(zoom); try { require('fs').writeFileSync(zf, JSON.stringify({ z: zoom })); } catch {} };
  win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(zoom));
  win.webContents.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown' || !(i.control || i.meta)) return;
    if (i.key === '+' || i.key === '=') { setZoom(zoom + 0.1); e.preventDefault(); }
    else if (i.key === '-' || i.key === '_') { setZoom(zoom - 0.1); e.preventDefault(); }
    else if (i.key === '0') { setZoom(1); e.preventDefault(); }
  });
  win.webContents.on('zoom-changed', (_e, dir) => setZoom(zoom + (dir === 'in' ? 0.1 : -0.1)));
  win.setMenuBarVisibility(false);
  win.webContents.on('console-message', (...a) => console.log('[renderer]', a[2]));
  win.webContents.on('did-fail-load', (_e, code, desc) => console.log('[load failed]', code, desc));
  win.webContents.on('before-input-event', (e, i) => { if (i.type === 'keyDown' && i.key === 'F12') win.webContents.toggleDevTools(); });
  win.loadFile('index.html');
}

// الطلبات للإضافات من العملية الرئيسية (بدون CORS)
ipcMain.handle('addon:get', async (_e, url) => {
  if (!/^https?:\/\//i.test(url)) throw new Error('رابط غير صالح');
  const res = await fetch(url, { headers: { 'User-Agent': 'WayAnime' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
});

// ===== حساب موقع البطاقات: نفس اسم المستخدم وكلمة السر ديال الموقع =====
// بدّل العنوان هنا (أو حطو فـ متغير البيئة CARDS_SITE) بعنوان موقع البطاقات ديالك.
const CARDS_SITE = String(process.env.CARDS_SITE || 'https://anime-cards-iei9.onrender.com').replace(/\/+$/, '');
const sessFile = () => path.join(app.getPath('userData'), 'cards-session.bin');
function readSid() {
  try {
    const raw = require('fs').readFileSync(sessFile());
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8');
  } catch { return ''; }
}
function saveSid(sid) {
  try {
    if (!sid) return require('fs').rmSync(sessFile(), { force: true });
    require('fs').writeFileSync(sessFile(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(sid) : Buffer.from(sid, 'utf8'));
  } catch (e) { console.log('[acct] save failed', e.message); }
}
const absUrl = (u) => {
  if (u && typeof u === 'object') u = u.url || u.src || u.path || '';
  u = (typeof u === 'string' || typeof u === 'number') ? String(u).trim() : '';
  if (!u) return '';
  if (/^https?:\/\//i.test(u) || /^data:image\//i.test(u)) return u;
  return CARDS_SITE + (u.startsWith('/') ? '' : '/') + u;
};
async function fetchMe(sid) {
  const r = await fetch(CARDS_SITE + '/api/me', { headers: { Cookie: 'sid=' + sid, 'User-Agent': 'WayAnime' }, signal: AbortSignal.timeout(15000) });
  if (r.status === 401) return null;
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json(); const u = j && j.user; if (!u) return null;
  return { username: String(u.username || ''), pts: Number(u.pts) || 0, pic: absUrl(u.pic || u.avatar || '') };
}
ipcMain.handle('acct:me', async () => {
  const sid = readSid(); if (!sid) return { user: null };
  try { const user = await fetchMe(sid); if (!user) saveSid(''); return { user }; }
  catch (e) { return { user: null, offline: true, error: e.message }; }
});
ipcMain.handle('acct:login', async (_e, { username, password }) => {
  const r = await fetch(CARDS_SITE + '/auth/loginpw', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'WayAnime' },
    body: JSON.stringify({ username: String(username || '').trim(), password: String(password || '') }), signal: AbortSignal.timeout(20000)
  }).catch(() => { throw new Error('تعذّر الاتصال بموقع البطاقات'); });
  if (r.status === 429) throw new Error('محاولات كثيرة، جرّب بعد قليل');
  if (r.status === 401) throw new Error('اسم المستخدم أو كلمة السر غير صحيحة');
  if (!r.ok) throw new Error('خطأ من الموقع (' + r.status + ')');
  const ck = (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map((c) => /(?:^|[\s;])sid=([^;]+)/.exec(c)).find(Boolean);
  if (!ck) throw new Error('لم يُرجع الموقع جلسة');
  saveSid(ck[1]);
  const user = await fetchMe(ck[1]);
  if (!user) { saveSid(''); throw new Error('فشل تسجيل الدخول'); }
  return { user };
});
ipcMain.handle('acct:logout', async () => {
  const sid = readSid(); saveSid('');
  if (sid) fetch(CARDS_SITE + '/auth/logout', { headers: { Cookie: 'sid=' + sid }, redirect: 'manual' }).catch(() => {});
  return true;
});
ipcMain.handle('acct:site', () => CARDS_SITE);
// مزامنة المفضلة وسجل المشاهدة مع حساب الموقع
ipcMain.handle('sync:get', async () => {
  const sid = readSid(); if (!sid) return null;
  const r = await fetch(CARDS_SITE + '/api/wa/sync', { headers: { Cookie: 'sid=' + sid }, signal: AbortSignal.timeout(20000) });
  if (r.status === 401) { saveSid(''); return null; }
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
});
ipcMain.handle('sync:put', async (_e, body) => {
  const sid = readSid(); if (!sid) return null;
  const r = await fetch(CARDS_SITE + '/api/wa/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: 'sid=' + sid }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  if (r.status === 401) { saveSid(''); return null; }
  if (r.status !== 409 && !r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
});

// أزرار النافذة (بدون شريط العنوان الأصلي)
const winOf = (e) => BrowserWindow.fromWebContents(e.sender);
ipcMain.handle('win:min', (e) => winOf(e).minimize());
ipcMain.handle('win:close', (e) => winOf(e).close());
ipcMain.handle('win:max', (e) => { const w = winOf(e), was = w.isMaximized(); was ? w.unmaximize() : w.maximize(); return !was; });
// مشاهدة مشتركة: اسم الجهاز + ملء الشاشة للنافذة كاملة
ipcMain.handle('wp:name', () => os.hostname());
ipcMain.handle('wp:fs', (e, on) => { const w = winOf(e); if (!w) return false; if (on) { w.show(); w.focus(); } w.setFullScreen(!!on); return true; });
ipcMain.handle('open:external', (_e, url) => {
  if (/^(https?|magnet):/i.test(url)) return shell.openExternal(url);
});

// ===== التحديثات: يقرا آخر Release من GitHub =====
// حط هنا اسم الريبو بصيغة  username/repo  (أو متغير البيئة UPDATE_REPO). إذا خليتو فارغ زر التحديث ما يظهرش أبداً.
const UPDATE_REPO = process.env.UPDATE_REPO || '';
ipcMain.handle('app:version', () => app.getVersion());
// ===== التحديث من Google Drive =====
// UPDATE_VERSION_LINK: رابط ملف الإصدار فـ Drive (مشاركة «أي شخص معه الرابط») — يقبل رابط كامل أو ID فقط.
//   الملف يقدر يكون نص عادي فيه الرقم بس (مثلاً 1.2.0) أو JSON: { "version": "1.2.0", "url": "رابط_التحميل" }
// UPDATE_DOWNLOAD_LINK: رابط ملف التثبيت (exe) فـ Drive. تبدّل غير الرقم فـ ملف الإصدار، والتحميل يبقى هو هو.
const UPDATE_VERSION_LINK = process.env.UPDATE_VERSION_LINK || '';
const UPDATE_DOWNLOAD_LINK = process.env.UPDATE_DOWNLOAD_LINK || '';
const driveId = (v) => { v = String(v || '').trim(); const m = v.match(/\/d\/([\w-]{10,})/) || v.match(/[?&]id=([\w-]{10,})/) || v.match(/^([\w-]{20,})$/); return m ? m[1] : ''; };
const driveDl = (v) => { const id = driveId(v); return id ? 'https://drive.google.com/uc?export=download&confirm=t&id=' + encodeURIComponent(id) : (/^https?:/i.test(v) ? v : ''); };
// مجلد Drive (عام): التطبيق يقرا محتواه بنفسو — تحط فيه ملف version.txt (الرقم فقط) وملف الـ exe، وتبدل غير الرقم.
const UPDATE_FOLDER_LINK = process.env.UPDATE_FOLDER_LINK || 'https://drive.google.com/drive/folders/1ag6runyf095MffiO2dGHI5lJfz2lh2_D?usp=drive_link';
const folderId = (v) => { const m = String(v || '').match(/folders\/([\w-]{10,})/); return m ? m[1] : ''; };
const unesc = (t) => String(t || '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/<[^>]+>/g, '').trim();
async function folderFiles(fid) {
  const r = await fetch('https://drive.google.com/embeddedfolderview?id=' + fid + '&t=' + Date.now(), { headers: { 'User-Agent': UA, 'Accept-Language': 'en' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) return [];
  const html = await r.text(), out = [], seen = new Set();
  const re = /(?:id="entry-|\/file\/d\/)([\w-]{20,})/g; let m;
  while ((m = re.exec(html))) {
    if (seen.has(m[1])) continue; seen.add(m[1]);
    const chunk = html.slice(m.index, m.index + 1500);
    const t = chunk.match(/flip-entry-title[^>]*>([^<]+)</) || chunk.match(/title="([^"]+)"/);
    if (t) out.push({ id: m[1], name: unesc(t[1]) });
  }
  return out;
}
async function driveFolderUpdate() {
  const fid = folderId(UPDATE_FOLDER_LINK); if (!fid) return null;
  try {
    const files = await folderFiles(fid);
    // الإصدار كيتقرا من سمية الـ exe (مثلاً WayAnime-Setup-1.1.0.exe). إذا كاين أكثر من exe ناخدو الأكبر.
    const num = (n) => { const m = String(n).match(/\d+(?:\.\d+){1,3}/); return m ? m[0] : ''; };
    const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 4; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };
    const exes = files.filter((f) => /\.exe$/i.test(f.name) && num(f.name)).sort((p, q) => cmp(num(q.name), num(p.name)));
    const exe = exes[0] || files.find((f) => /\.exe$/i.test(f.name));
    let tag = exe ? num(exe.name) : '', notes = '';
    if (!tag) {   // احتياط: version.txt
      const vf = files.find((f) => /^version.*\.(txt|json)$/i.test(f.name)) || files.find((f) => /\.(txt|json)$/i.test(f.name));
      if (vf) {
        const r = await fetch('https://drive.google.com/uc?export=download&id=' + vf.id + '&t=' + Date.now(), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
        if (r.ok) {
          const txt = (await r.text()).replace(/^\uFEFF/, '').trim();
          if (txt.startsWith('{')) { try { const j = JSON.parse(txt); tag = String(j.version || j.tag || ''); notes = j.notes || ''; } catch {} }
          else tag = num(txt);
        }
      }
    }
    if (!tag) return null;
    const dl = exe ? 'https://drive.google.com/uc?export=download&confirm=t&id=' + exe.id : UPDATE_FOLDER_LINK;
    return { tag, name: notes, url: dl, download: dl };
  } catch { return null; }
}
async function driveUpdate() {
  const f = await driveFolderUpdate(); if (f) return f;
  const id = driveId(UPDATE_VERSION_LINK); if (!id) return null;
  try {
    const r = await fetch('https://drive.google.com/uc?export=download&id=' + id + '&t=' + Date.now(), { headers: { 'User-Agent': 'WayAnime' }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const txt = (await r.text()).replace(/^\uFEFF/, '').trim();
    let tag = '', dl = '', notes = '';
    if (txt.startsWith('{')) { const j = JSON.parse(txt); tag = String(j.version || j.tag || ''); dl = driveDl(j.url || j.file || ''); notes = j.notes || ''; }
    else { const m = txt.match(/\d+(?:\.\d+){1,3}/); tag = m ? m[0] : ''; }
    if (!tag) return null;
    dl = dl || driveDl(UPDATE_DOWNLOAD_LINK);
    return { tag, name: notes, url: dl, download: dl };
  } catch { return null; }
}
// ===== إعلان الصفحة الرئيسية: ملف announce.txt فـ نفس مجلد Drive =====
// تبدل المحتوى فـ Drive والتطبيق يقراه كل مرة يفتح الرئيسية (وكل 10 دقايق).
ipcMain.handle('announce:get', async () => {
  try {
    const fid = folderId(UPDATE_FOLDER_LINK); if (!fid) return '';
    const files = await folderFiles(fid);
    const f = files.find((x) => /^an+ou?n?ce(ment)?s?(\.txt)?$/i.test(String(x.name).trim()));
    if (!f) return '';
    const r = await fetch('https://drive.google.com/uc?export=download&confirm=t&id=' + encodeURIComponent(f.id) + '&t=' + Date.now(), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return '';
    return (await r.text()).replace(/^\uFEFF/, '').trim().slice(0, 1200);
  } catch { return ''; }
});
ipcMain.handle('update:check', async () => {
  const d = await driveUpdate(); if (d) return d;
  if (!/^[\w.-]+\/[\w.-]+$/.test(UPDATE_REPO)) return null;
  try {
    const r = await fetch('https://api.github.com/repos/' + UPDATE_REPO + '/releases/latest', { headers: { 'User-Agent': 'WayAnime', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const j = await r.json();
    const exe = (j.assets || []).find((x) => /\.exe$/i.test(x.name));
    return { tag: String(j.tag_name || ''), name: j.name || '', url: j.html_url, download: exe ? exe.browser_download_url : '' };
  } catch { return null; }
});

// ===== تثبيت التحديث داخل التطبيق: تحميل الـ exe من Drive ثم تشغيلو وإغلاق التطبيق =====
let updating = false;
ipcMain.handle('update:install', async (e, url) => {
  if (updating) return { ok: false, error: 'busy' };
  if (process.platform !== 'win32') return { ok: false, error: 'win-only' };
  const fsx = require('fs'), dest = path.join(os.tmpdir(), 'WayAnime-Update.exe');
  const send = (p) => { try { e.sender.send('update:progress', p); } catch {} };
  updating = true;
  try {
    let u = String(url || '');
    const m = u.match(/[?&]id=([\w-]{10,})/) || u.match(/\/d\/([\w-]{10,})/);
    if (m) u = 'https://drive.usercontent.google.com/download?id=' + m[1] + '&export=download&confirm=t';
    if (!/^https:\/\//i.test(u)) throw new Error('رابط التحميل غير صالح');
    let res = await fetch(u, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    if (/text\/html/i.test(res.headers.get('content-type') || '')) {   // صفحة تأكيد ديال Drive (ملف كبير): نعمرو الفورم ونعاودو
      const html = await res.text();
      const act = (html.match(/<form[^>]*action="([^"]+)"/) || [])[1];
      if (!act) throw new Error('لم يسمح Drive بالتحميل — تأكد أن الملف مشارك «أي شخص معه الرابط»');
      const q = new URLSearchParams();
      for (const h of html.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) { const n = (h[0].match(/name="([^"]+)"/) || [])[1], v = (h[0].match(/value="([^"]*)"/) || [])[1]; if (n) q.set(n, v || ''); }
      res = await fetch(act.replace(/&amp;/g, '&') + (act.includes('?') ? '&' : '?') + q.toString(), { headers: { 'User-Agent': UA }, redirect: 'follow' });
    }
    if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
    if (/text\/html/i.test(res.headers.get('content-type') || '')) throw new Error('Drive رجّع صفحة بدل الملف');
    const total = Number(res.headers.get('content-length')) || 0;
    const out = fsx.createWriteStream(dest); let got = 0, last = 0;
    for await (const chunk of res.body) {
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      got += chunk.length;
      if (Date.now() - last > 250) { last = Date.now(); send({ got, total }); }
    }
    await new Promise((r) => out.end(r));
    if (got < 5 * 1024 * 1024) throw new Error('الملف المحمّل صغير جداً (ليس exe صحيحاً)');
    // تحقق: واش الـ exe المحمّل إصدارو فعلاً أكبر من الحالي (وإلا التطبيق يرجع بنفس الإصدار)
    const exeVer = await new Promise((r) => require('child_process').execFile('powershell', ['-NoProfile', '-Command', `(Get-Item -LiteralPath '${dest.replace(/'/g, "''")}').VersionInfo.ProductVersion`], { timeout: 8000, windowsHide: true }, (er, out) => r(er ? '' : String(out).trim())));
    const vm = exeVer.match(/\d+(?:\.\d+){1,3}/);
    const nv = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 4; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
    if (vm && !nv(vm[0], app.getVersion())) throw new Error('إصدار ملف الـ exe في Drive هو ' + vm[0] + ' (الحالي ' + app.getVersion() + '). غيّر version في package.json إلى رقم أكبر، ثم أعد البناء وارفع الـ exe الجديد.');
    send({ got, total: got, done: true });
    // سكريبت صغير: كيتسنى التطبيق يتسد، يشغّل التثبيت الصامت، ثم يرجع يفتح التطبيق (سجل فـ %TEMP%\\wayanime-update.log)
    const bat = path.join(os.tmpdir(), 'wayanime-update.cmd'), log = path.join(os.tmpdir(), 'wayanime-update.log');
    fsx.writeFileSync(bat, ['@echo off', 'ping 127.0.0.1 -n 4 >nul', `echo start %date% %time% > "${log}"`, `"${dest}" /S --updated >> "${log}" 2>&1`, `echo exit=%errorlevel% >> "${log}"`, 'ping 127.0.0.1 -n 3 >nul', `start "" "${process.execPath}"`].join('\r\n') + '\r\n');
    spawn('cmd.exe', ['/c', bat], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    setTimeout(() => { quitting = true; stopTorrent(); stopTranscode(); app.exit(0); }, 600);
    return { ok: true };
  } catch (err) {
    updating = false;
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle('addon:text', async (_e, url) => {
  if (!/^https?:\/\//i.test(url)) throw new Error('رابط غير صالح');
  const res = await fetch(url, { headers: { 'User-Agent': 'WayAnime' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.text();
});

// ترجمة النصوص إلى العربية
ipcMain.handle('translate', async (_e, text) => {
  const u = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ar&dt=t&q=' + encodeURIComponent(String(text).slice(0, 1800));
  const r = await fetch(u);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  return j[0].map((x) => x[0]).join('');
});

// AniList: عدد الحلقات المعروضة (GraphQL)
ipcMain.handle('anilist:info', async (_e, title) => {
  const query = 'query($s:String){Page(perPage:6){media(search:$s,type:ANIME,sort:SEARCH_MATCH){id format status episodes title{romaji english native} synonyms nextAiringEpisode{episode airingAt}}}}';
  const r = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables: { s: String(title).slice(0, 200) } }),
    signal: AbortSignal.timeout(8000)
  });
  if (!r.ok) throw new Error('AniList HTTP ' + r.status);
  const j = await r.json();
  return (j.data && j.data.Page && j.data.Page.media) || [];
});

// AniList: وصف الأنمي + التقييم (المصدر الأول: أدق وأسرع من Jikan)
ipcMain.handle('anilist:desc', async (_e, names) => {
  const nz = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, '');
  const same = (a, b) => { if (!a || !b) return false; if (a === b) return true; const [sh, lo] = a.length < b.length ? [a, b] : [b, a]; return sh.length >= 6 && lo.includes(sh) && sh.length / lo.length >= 0.7; };
  const list = [...new Set((names || []).map((n) => String(n || '').trim()).filter(Boolean))].slice(0, 3);
  const want = list.map(nz).filter(Boolean);
  const query = 'query($s:String){Page(perPage:8){media(search:$s,type:ANIME,sort:SEARCH_MATCH){id title{romaji english native} synonyms description(asHtml:false) averageScore siteUrl}}}';
  for (const n of list) {
    for (let k = 0; k < 2; k++) {
      let r;
      try {
        r = await fetch('https://graphql.anilist.co', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query, variables: { s: n.slice(0, 200) } }), signal: AbortSignal.timeout(9000) });
      } catch { break; }
      if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 1500)); continue; }
      if (!r.ok) break;
      const j = await r.json();
      const media = (j.data && j.data.Page && j.data.Page.media) || [];
      const a = media.find((x) => [x.title && x.title.romaji, x.title && x.title.english, x.title && x.title.native, ...(x.synonyms || [])].map(nz).some((t) => want.some((w) => same(t, w))));
      if (a && a.description) {
        const text = String(a.description).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\(Source:[^)]*\)/gi, '').replace(/\[Written by[^\]]*\]/gi, '').replace(/\n{2,}/g, '\n').trim();
        if (text) return { description: text, score: a.averageScore ? (a.averageScore / 10).toFixed(1) : '', url: a.siteUrl || '' };
      }
      break;
    }
  }
  return null;
});

// AniList: الأجزاء (سابق/لاحق/قصص جانبية) + الأنميات المشابهة (توصيات)
const REL_AR = { PREQUEL: 'الجزء السابق', SEQUEL: 'الجزء التالي', PARENT: 'القصة الأصلية', SIDE_STORY: 'قصة جانبية', SPIN_OFF: 'سبين أوف', ALTERNATIVE: 'نسخة بديلة', SUMMARY: 'ملخص', ADAPTATION: 'اقتباس' };
const relCache = new Map();
ipcMain.handle('anilist:related', async (_e, names) => {
  const nz = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, '');
  const list = [...new Set((names || []).map((n) => String(n || '').trim()).filter(Boolean))].slice(0, 3);
  const key = list.join('|'); if (!key) return [];
  if (relCache.has(key)) return relCache.get(key);
  const T = 'title{romaji english native} coverImage{large} format';
  const query = 'query($s:String){Page(perPage:6){media(search:$s,type:ANIME,sort:SEARCH_MATCH){id title{romaji english native} synonyms relations{edges{relationType node{id type ' + T + '}}} recommendations(sort:RATING_DESC,perPage:14){nodes{mediaRecommendation{id ' + T + '}}}}}}';
  const want = list.map(nz).filter(Boolean);
  const same = (a, b) => a && b && (a === b || (Math.min(a.length, b.length) >= 6 && (a.includes(b) || b.includes(a))));
  for (const n of list) {
    let j;
    try {
      const r = await fetch('https://graphql.anilist.co', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query, variables: { s: n.slice(0, 200) } }), signal: AbortSignal.timeout(10000) });
      if (!r.ok) continue; j = await r.json();
    } catch { continue; }
    const media = (j.data && j.data.Page && j.data.Page.media) || [];
    const a = media.find((x) => [x.title && x.title.romaji, x.title && x.title.english, x.title && x.title.native, ...(x.synonyms || [])].map(nz).some((t) => want.some((w) => same(t, w))));
    if (!a) continue;
    const out = [], seen = new Set([a.id]);
    const push = (node, kind, rel) => {
      if (!node || seen.has(node.id)) return; seen.add(node.id);
      const t = node.title || {};
      out.push({ id: node.id, kind, rel, title: t.english || t.romaji || t.native || '', alt: [t.romaji, t.english, t.native].filter(Boolean), cover: (node.coverImage && node.coverImage.large) || '', format: node.format || '' });
    };
    const order = ['PREQUEL', 'SEQUEL', 'PARENT', 'SIDE_STORY', 'SPIN_OFF', 'ALTERNATIVE', 'SUMMARY'];
    ((a.relations && a.relations.edges) || []).filter((e) => e.node && e.node.type === 'ANIME' && REL_AR[e.relationType] && e.relationType !== 'ADAPTATION')
      .sort((x, y) => order.indexOf(x.relationType) - order.indexOf(y.relationType)).forEach((e) => push(e.node, 'part', REL_AR[e.relationType]));
    ((a.recommendations && a.recommendations.nodes) || []).forEach((n) => push(n.mediaRecommendation, 'sim', 'مشابه'));
    relCache.set(key, out); if (relCache.size > 80) relCache.delete(relCache.keys().next().value);
    return out;
  }
  return [];
});

// AniList: شخصيات الأنمي (بالـ id اللي لقيناه فـ anilist:info)
// بوستر بديل بالاسم: AniList ← Kitsu ← Jikan (MAL)
async function coverFor(name) {
  name = String(name || '').trim().slice(0, 200); if (!name) return '';
  const J = async (u, o) => { const r = await fetch(u, { ...(o || {}), signal: AbortSignal.timeout(8000) }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); };
  try {
    const q = 'query($s:String){Page(perPage:1){media(search:$s,type:ANIME,sort:SEARCH_MATCH){coverImage{extraLarge large}}}}';
    const j = await J('https://graphql.anilist.co', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query: q, variables: { s: name } }) });
    const c = j && j.data && j.data.Page.media[0] && j.data.Page.media[0].coverImage; if (c && (c.extraLarge || c.large)) return c.extraLarge || c.large;
  } catch {}
  try {
    const j = await J('https://kitsu.io/api/edge/anime?page%5Blimit%5D=1&filter%5Btext%5D=' + encodeURIComponent(name), { headers: { Accept: 'application/vnd.api+json' } });
    const im = j && j.data && j.data[0] && j.data[0].attributes.posterImage; if (im && (im.large || im.original)) return im.large || im.original;
  } catch {}
  try {
    const j = await J('https://api.jikan.moe/v4/anime?limit=1&q=' + encodeURIComponent(name));
    const im = j && j.data && j.data[0] && j.data[0].images && j.data[0].images.jpg; if (im && (im.large_image_url || im.image_url)) return im.large_image_url || im.image_url;
  } catch {}
  return '';
}
ipcMain.handle('anilist:cover', (_e, name) => coverFor(name));
ipcMain.handle('anilist:chars', async (_e, id) => {
  const query = 'query($id:Int){Media(id:$id,type:ANIME){characters(sort:[ROLE,FAVOURITES_DESC],perPage:4){edges{role node{id name{full native} image{large medium} description(asHtml:false) gender age dateOfBirth{month day} bloodType favourites}}}}}';
  const r = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables: { id: Number(id) } }),
    signal: AbortSignal.timeout(9000)
  });
  if (!r.ok) throw new Error('AniList HTTP ' + r.status);
  const j = await r.json();
  const edges = (j.data && j.data.Media && j.data.Media.characters && j.data.Media.characters.edges) || [];
  const clean = (t) => String(t || '').replace(/~!.*?!~/gs, '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/__([^_]+)__/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\n{2,}/g, '\n').trim();
  return edges.map((e) => {
    const n = e.node, d = n.dateOfBirth || {};
    let desc = clean(n.description);
    if (desc.length > 600) desc = desc.slice(0, 600).replace(/\s+\S*$/, '') + '…';
    return { id: n.id, name: n.name.full || n.name.native || '', native: n.name.native || '', role: e.role, img: (n.image && (n.image.large || n.image.medium)) || '', desc, gender: n.gender || '', age: n.age || '', bday: d.month && d.day ? d.day + '/' + d.month : '', blood: n.bloodType || '', fav: n.favourites || 0 };
  }).filter((c) => c.name && c.img);
});

// تشغيل التورنت: نحمّل الملف ونعطي الواجهة رابطاً محلياً للفيديو
let client = null, server = null;
function stopTorrent() {
  try { server && server.close(); } catch {}
  server = null;
  if (client) client.torrents.slice().forEach((t) => t.destroy());
}
ipcMain.handle('torrent:start', (_e, { infoHash, fileIdx, sources = [] }) => new Promise((resolve, reject) => {
  stopTorrent();
  client = client || new WebTorrent();
  const trackers = sources.filter((s) => String(s).startsWith('tracker:')).map((s) => '&tr=' + encodeURIComponent(s.slice(8))).join('');
  const t = client.add(`magnet:?xt=urn:btih:${infoHash}${trackers}`, { path: path.join(os.tmpdir(), 'wayanime') });
  const timer = setTimeout(() => { t.destroy(); reject(new Error('انتهت مهلة الاتصال بالتورنت')); }, 60000);
  t.on('error', (e) => { clearTimeout(timer); reject(e); });
  t.on('ready', () => {
    clearTimeout(timer);
    const vids = t.files.filter((f) => /\.(mp4|mkv|webm|m4v)$/i.test(f.name)).sort((a, b) => b.length - a.length);
    const file = (fileIdx != null && t.files[fileIdx]) || vids[0];
    if (!file) return reject(new Error('لا يوجد ملف فيديو في هذا التورنت'));
    t.files.forEach((f) => f !== file && f.deselect());
    server = t.createServer({ origin: '*' });
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}/${t.files.indexOf(file)}`, name: file.name }));
  });
}));

// تحويل أي فيديو إلى mp4 (H.264 + AAC) عبر ffmpeg ليشتغل في المشغّل
const ffmpegBin = () => require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');
let tcServer = null;
function stopTranscode() { try { tcServer && tcServer.close(); } catch {} tcServer = null; }
const UA_TC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
ipcMain.handle('transcode:start', (_e, url) => new Promise((resolve, reject) => {
  if (!/^https?:\/\//i.test(url)) return reject(new Error('رابط غير صالح'));
  stopTranscode();
  tcServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
    let ffRef = ''; try { ffRef = sdRef.get(baseDom(new URL(url).hostname)) || ''; } catch {}
    const ffIn = ['-user_agent', UA_TC].concat(ffRef ? ['-headers', 'Referer: ' + ffRef + '\r\n'] : [], ['-i', url]);
    const p = spawn(ffmpegBin(), ['-v', 'error'].concat(ffIn).concat([ '-map', '0:v:0', '-map', '0:a:0?',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p', '-vf', 'scale=-2:min(ih\\,1080)',
      '-c:a', 'aac', '-ac', '2', '-b:a', '160k',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1']));
    p.stderr.on('data', () => {});
    p.stdout.pipe(res);
    res.on('close', () => { try { p.kill('SIGKILL'); } catch {} });
  });
  tcServer.on('error', reject);
  tcServer.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${tcServer.address().port}/`));
}));


// ===== المصدر العربي (Animeify) — منقول من ani-cli-arabic =====
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const AR = {
  base: 'https://animeify.net/animeify/apis_v4/',
  token: '8cnY80AZSbUCmR26Vku1VUUY4',
  thumbs: 'https://animeify.net/animeify/files/thumbnails/',
  ready: null
};
function arInit() {
  if (AR.ready) return AR.ready;
  AR.ready = (async () => {
    try {
      const r = await fetch('https://api.ani-cli-arabic.dev/credentials', {
        headers: { 'X-Auth-Key': '6rK9z0XyW8vQ3J7pL2mN4sB1tH5gD0fA', 'User-Agent': 'AniCliAr/2.0' },
        signal: AbortSignal.timeout(8000)
      });
      if (r.ok) {
        const j = await r.json();
        if (j.ANI_CLI_AR_API_BASE && j.ANI_CLI_AR_TOKEN) {
          AR.base = j.ANI_CLI_AR_API_BASE; AR.token = j.ANI_CLI_AR_TOKEN;
          if (j.THUMBNAILS_BASE_URL) AR.thumbs = j.THUMBNAILS_BASE_URL;
        }
      }
    } catch {}
  })();
  return AR.ready;
}
async function arPost(endpoint, payload) {
  await arInit();
  const res = await fetch(AR.base.replace(/\/+$/, '') + '/' + endpoint.replace(/^\/+/, ''), {
    method: 'POST',
    body: new URLSearchParams({ ...payload, Token: payload.Token || AR.token }),
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}
function arMap(it) {
  const th = it.Thumbnail || it.CoverImage || '';
  return {
    id: String(it.AnimeId || it.id || ''),
    name: it.AR_Title || it.anime_name || it.EN_Title || it.Title || '—',
    nameEn: it.EN_Title || it.Title || '',
    poster: th && !/^http/i.test(th) ? AR.thumbs + th : th,
    genres: it.Genres || '', score: it.Score || '', synopsis: it.Story || it.Synopsis || '',
    episodes: it.Episodes || '', status: it.Status || '', season: it.Season || '', type: it.Type || '',
    lastEp: String(it.LastEpisode || it.LatestEpisode || it.Last_Episode || it.EpisodeNumber || it.EpNumber || it.Episode || '').replace(/[^\d.]/g, '')
  };
}
async function arList({ latest, filterType = '', filterData = '', type = 'SERIES', from = 0, limit = 30 } = {}) {
  const endpoint = latest ? 'anime/load_latest_anime.php' : 'anime/load_anime_list_v2.php';
  const base = latest ? { UserId: '0', Language: 'English' }
    : { UserId: '0', Language: 'English', FilterType: filterType, FilterData: filterData, Type: type };
  const out = []; let cur = from;
  while (out.length < limit) {
    const data = await arPost(endpoint, { ...base, From: String(cur) });
    if (!Array.isArray(data) || !data.length) break;
    const batch = data.filter((x) => x && typeof x === 'object').map(arMap);
    out.push(...batch);
    if (batch.length < 10) break;
    cur += batch.length;
  }
  return out.slice(0, limit);
}
// كاش قصير للوائح (5 دقايق) + نرجعو القديم إلا السيرفر طاح
const arListCache = new Map();
ipcMain.handle('ar:list', async (_e, opts) => {
  const k = JSON.stringify(opts || {}), hit = arListCache.get(k);
  if (hit && Date.now() - hit.t < 300e3) return hit.v;
  try {
    const v = await arList(opts);
    if (v && v.length) { arListCache.set(k, { t: Date.now(), v }); if (arListCache.size > 60) arListCache.delete(arListCache.keys().next().value); }
    return v;
  } catch (e) { if (hit) return hit.v; throw e; }
});
ipcMain.handle('ar:search', async (_e, q) => {
  q = String(q || '').trim();
  if (!q) return [];
  const [a, b] = await Promise.all([
    arList({ filterType: 'SEARCH', filterData: q, type: 'SERIES', limit: 20 }).catch(() => []),
    arList({ filterType: 'SEARCH', filterData: q, type: 'MOVIE', limit: 20 }).catch(() => [])
  ]);
  return [...a, ...b];
});
ipcMain.handle('ar:episodes', async (_e, id) => {
  const data = await arPost('episodes/load_episodes.php', { AnimeID: String(id) });
  if (!Array.isArray(data)) return [];
  return data.filter((e) => e && typeof e === 'object')
    .map((e, i) => ({ num: String(e.Episode ?? i + 1), type: e.Type || 'Episode', raw: e }))
    .sort((a, b) => (parseFloat(a.num) || 0) - (parseFloat(b.num) || 0));
});
async function mediafireDirect(v) {
  try {
    const url = /^https?:/i.test(v) ? v : 'https://www.mediafire.com/file/' + v;
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const m = (await r.text()).match(/https:\/\/download[^"'\s>]+/);
    return m ? m[0].replace(/&amp;/g, '&') : null;
  } catch { return null; }
}
ipcMain.handle('ar:streams', async (_e, ep) => {
  const defs = [['FRFhdQ', '1080p'], ['FRLink', '720p'], ['FRLowQ', '480p']];
  const res = await Promise.all(defs.map(async ([k, q]) => (ep && ep[k] ? { q, url: await mediafireDirect(ep[k]) } : null)));
  return res.filter((x) => x && x.url);
});

ipcMain.handle('ar:direct', (_e, url) => mediafireDirect(String(url || '')));
// جلب صفحات HTML (للمواقع العربية مثل WitAnime) — التحليل يتم في الواجهة
ipcMain.handle('web:html', async (_e, url) => {
  if (!/^https:\/\//i.test(url)) throw new Error('رابط غير صالح');
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ar,en;q=0.8' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.text();
});

// ===== مانجا (MangaDex API عامة): الطلب كيدوز من هنا باش ما يوقعش مشكل CORS =====
ipcMain.handle('manga:api', async (_e, p) => {
  p = String(p || '');
  if (!/^\/(manga|at-home|chapter|cover)(\/|\?|$)/.test(p)) throw new Error('مسار غير صالح');
  let res;
  for (let k = 0; k < 3; k++) {     // MangaDex كيحدّ الطلبات (429): نعاودو مرتين بعد توقف قصير
    res = await fetch('https://api.mangadex.org' + p, { headers: { 'User-Agent': 'WayAnime/1.0', 'Accept': 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (res.ok || (res.status !== 429 && res.status < 500)) break;
    await new Promise(r => setTimeout(r, 1200 * (k + 1)));
  }
  if (!res.ok) throw new Error('MangaDex HTTP ' + res.status);
  return res.json();
});



// ===== مانجا ليك (mangalik.net — قالب Madara): نجيبو الـ HTML من هنا والتحليل فـ الواجهة =====
const MLK_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const mlkOk = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && x.hostname === 'mangalik.net'; } catch { return false; } };
const mlkBlocked = (st, t) => st === 403 || st === 503 || st === 429 || /Just a moment|cf-chl|challenge-platform/i.test(String(t).slice(0, 6000));
// إذا الموقع محمي (Cloudflare): نفتحو الصفحة فـ نافذة مخفية (متصفح حقيقي) ونقراو الـ HTML منها
async function mlkViaWindow(loadUrl, postUrl) {
  const w = new BrowserWindow({ show: false, width: 900, height: 700, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  try {
    w.webContents.setUserAgent(MLK_UA);
    await Promise.race([w.loadURL(loadUrl), new Promise((_r, rj) => setTimeout(() => rj(new Error('timeout')), 25000))]).catch(() => {});
    for (let i = 0; i < 15; i++) {
      const t = await w.webContents.executeJavaScript('document.title').catch(() => '');
      if (t && !/just a moment|attention required|لحظة/i.test(t)) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (postUrl) return await w.webContents.executeJavaScript('fetch(' + JSON.stringify(postUrl) + ',{method:"POST",credentials:"include",headers:{"X-Requested-With":"XMLHttpRequest"}}).then(r=>r.text())');
    return await w.webContents.executeJavaScript('document.documentElement.outerHTML');
  } finally { try { w.destroy(); } catch {} }
}
ipcMain.handle('mlk:get', async (_e, url, post) => {
  url = String(url || ''); if (!mlkOk(url)) throw new Error('رابط غير صالح');
  const hd = { 'User-Agent': MLK_UA, 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'ar,en;q=0.8', 'Referer': 'https://mangalik.net/' };
  try {
    const init = post ? { method: 'POST', headers: Object.assign({}, hd, { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded' }), body: '' } : { headers: hd };
    const r = await fetch(url, Object.assign({ signal: AbortSignal.timeout(20000) }, init));
    const t = await r.text();
    if (r.ok && !mlkBlocked(r.status, t)) return t;
  } catch {}
  let t = ''; try { t = await mlkViaWindow(post ? url.replace(/ajax\/chapters\/?$/, '') : url, post ? url : ''); } catch {}
  if (!t || mlkBlocked(200, t)) throw new Error('الموقع حاجب الطلب (Cloudflare) — جرّب مرة أخرى بعد شوية');
  return t;
});

// ===== صور المانجا: mgimg://i/?u=<رابط https> =====
const mgIsMd = (h) => /(^|\.)mangadex\.(org|network)$/i.test(h);
const mgImgOk = (h) => mgIsMd(h) || (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(h) && !/^\d+(\.\d+){3}$/.test(h) && !/(^|\.)(localhost|local|internal|lan)$/i.test(h));
let mgActive = 0; const mgWait = [];
const mgSlot = () => new Promise((ok) => { const go = () => { mgActive++; ok(); }; mgActive < 8 ? go() : mgWait.push(go); });
const mgFree = () => { mgActive--; const n = mgWait.shift(); if (n) n(); };
function setupMangaImages() {
  protocol.handle('mgimg', async (req) => {
    let u; try { u = new URL(new URL(req.url).searchParams.get('u') || ''); } catch { return new Response('bad', { status: 400 }); }
    if (u.protocol !== 'https:' || !mgImgOk(u.hostname)) return new Response('forbidden', { status: 403 });
    await mgSlot();
    try {
      let last = 0;
      for (let k = 0; k < 3; k++) {
        try {
          const hd = mgIsMd(u.hostname)
            ? { 'User-Agent': 'WayAnime/1.0', 'Accept': 'image/avif,image/webp,image/*,*/*' }
            : { 'User-Agent': MLK_UA, 'Accept': 'image/avif,image/webp,image/*,*/*', 'Referer': 'https://mangalik.net/' };   // مانجا ليك: Referer ضروري (حماية الـ hotlink)
          const r = await fetch(u.href, { headers: hd, signal: AbortSignal.timeout(25000), redirect: 'follow' });
          last = r.status;
          if (r.ok) {
            const buf = Buffer.from(await r.arrayBuffer());
            if (buf.length < 200) { last = 502; continue; }
            return new Response(buf, { status: 200, headers: { 'Content-Type': r.headers.get('content-type') || 'image/jpeg', 'Cache-Control': 'public, max-age=2592000' } });
          }
          if (r.status === 404 || r.status === 403) break;
        } catch { last = 504; }
        await new Promise((x) => setTimeout(x, 700 * (k + 1)));
      }
      return new Response('fail', { status: last || 502 });
    } finally { mgFree(); }
  });
}

// ===== أنمي تزيدوه أنت: ملف custom.json (في مجلد بيانات التطبيق) =====
const fs = require('fs');
const customFile = () => path.join(app.getPath('userData'), 'custom.json');
function ensureCustom() {
  const f = customFile();
  try {
    if (!fs.existsSync(f)) fs.writeFileSync(f, '[]');
    const ex = path.join(path.dirname(f), 'custom.example.json');
    if (!fs.existsSync(ex)) fs.writeFileSync(ex, JSON.stringify([{
      name: 'اسم الأنمي بالعربية', nameEn: 'English name', poster: 'https://example.com/poster.jpg',
      genres: 'Action,Drama', synopsis: 'وصف قصير', type: 'TV', score: '8.5',
      episodes: [
        { num: '1', url: 'https://example.com/ep1.mp4' },
        { num: '2', urls: [{ name: 'سيرفر 1', url: 'https://example.com/ep2.mp4' }, { name: 'ميديافاير', url: 'https://www.mediafire.com/file/xxxx' }] }
      ]
    }], null, 2));
  } catch {}
  return f;
}
ipcMain.handle('custom:list', () => {
  try {
    const j = JSON.parse(fs.readFileSync(ensureCustom(), 'utf8'));
    return Array.isArray(j) ? j : (j.anime || []);
  } catch (e) { throw new Error('custom.json فيه خطأ: ' + e.message); }
});
ipcMain.handle('custom:open', () => shell.openPath(ensureCustom()));

// إشعارات النظام (حلقة جديدة)
if (process.platform === 'win32') app.setAppUserModelId('com.wayanime.app');
ipcMain.handle('notify:show', (_e, { title, body, id }) => {
  if (!Notification.isSupported()) return false;
  const n = new Notification({ title: String(title || 'WayAnime').slice(0, 120), body: String(body || '').slice(0, 250), icon: path.join(__dirname, 'assets', 'icon.png') });
  n.on('click', () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); if (id) w.webContents.send('notify:open', id); }
  });
  n.show();
  return true;
});
ipcMain.handle('bg:set', (_e, o) => {
  bg.keep = o.keep !== false; bg.autostart = !!o.autostart;
  if (bg.keep) makeTray(); else if (tray) { tray.destroy(); tray = null; }
  try { app.setLoginItemSettings({ openAtLogin: bg.keep && bg.autostart, args: ['--hidden'] }); } catch {}
  return true;
});
// ===== Stardima (مدبلج): كود الـ addon الأصلي (API الموقع + مستخرج الفيديوهات) =====
const sdLib = require('./stardima/stardima');
const sdRes = require('./stardima/resolver');
const sdHost = require('./stardima/hosts');
const sdUni = require('./stardima/universal');   // محلّل شامل لكل السيرفرات
const sdRef = new Map(); let sdLastRef = '', sdLastAt = 0;      // referer لكل دومين فيديو
const baseDom = (h) => String(h).split('.').slice(-2).join('.');
const mediaLike = (p) => /\.(m3u8|ts|mp4|m4s|aac|key|vtt)(\?|$)/i.test(p);
function setupSdHeaders() {
  const ses = require('electron').session.defaultSession, filter = { urls: ['http://*/*', 'https://*/*'] };
  const refFor = (d) => {
    if (d.resourceType === 'image') { try { const h = new URL(d.url).hostname; if (/anime4up|aniime4up|witanime/i.test(h)) return 'https://' + h + '/'; } catch {} }
    if (!sdRef.size) return '';
    const u = new URL(d.url), hit = sdRef.get(baseDom(u.hostname));
    if (hit) return hit;
    return (d.resourceType === 'media' || d.resourceType === 'xhr') && mediaLike(u.pathname + u.search) && Date.now() - sdLastAt < 3 * 3600e3 ? sdLastRef : '';
  };
  ses.webRequest.onBeforeSendHeaders(filter, (d, cb) => {
    try { if (d.resourceType === 'subFrame') { const o = new URL(d.url).origin; if (!/^file:/i.test(o)) { d.requestHeaders['Referer'] = o + '/'; } } } catch {}
    try { const ref = refFor(d); if (ref) { d.requestHeaders['Referer'] = ref; d.requestHeaders['Origin'] = new URL(ref).origin; } } catch {}
    cb({ requestHeaders: d.requestHeaders });
  });
  ses.webRequest.onHeadersReceived(filter, (d, cb) => {
    const h = d.responseHeaders || {};
    if (d.resourceType === 'subFrame') {   // نسمحو بعرض صفحات السيرفرات داخل التطبيق
      for (const k of Object.keys(h)) {
        const l = k.toLowerCase();
        if (l === 'x-frame-options') delete h[k];
        else if (l === 'content-security-policy') h[k] = h[k].map((v) => v.replace(/frame-ancestors[^;]*;?/gi, ''));
      }
    }
    if (d.resourceType === 'image' && d.method === 'GET' && d.statusCode >= 200 && d.statusCode < 300) {   // نجبرو الكاش (30 يوم) للبوسترات
      for (const k of Object.keys(h)) if (/^(cache-control|pragma|expires|etag|vary)$/i.test(k)) delete h[k];
      h['Cache-Control'] = ['public, max-age=2592000, immutable'];
    }
    try { if (refFor(d)) { for (const k of Object.keys(h)) if (k.toLowerCase() === 'access-control-allow-origin') delete h[k]; h['Access-Control-Allow-Origin'] = ['*']; } } catch {}
    cb({ responseHeaders: h });
  });
}
ipcMain.handle('sd:catalog', (_e, o) => sdLib.getCatalog(o || {}));
ipcMain.handle('sd:meta', async (_e, id) => {
  const [type, ...rest] = String(id || '').split(':'), slug = rest.join(':');
  if (!slug) throw new Error('id غير صالح');
  return type === 'movie' ? sdLib.getMovieMeta(slug) : sdLib.getSeriesMeta(slug);
});
ipcMain.handle('sd:streams', async (_e, ref) => {
  ref = ref || {};
  const r = ref.type === 'movie' ? await sdRes.getMovieServers(ref.slug) : await sdRes.getServers(ref.episodeId);
  if (r.blocked) return { streams: [], note: String(r.reason || 'محظورة') };
  const list = (await sdRes.orderServers(r.servers || [], { probe: false })).slice(0, 14);
  const got = await Promise.all(list.map(async (s) => {
    try { const x = await Promise.race([sdUni.resolve(s.embedUrl), new Promise((r) => setTimeout(() => r(null), 12000))]); return x && x.url ? { name: s.name || 'server', url: x.url, type: x.type, referer: x.referer } : null; } catch { return null; }
  }));
  const streams = got.filter(Boolean);
  for (const s of streams) { try { if (s.referer) sdRef.set(baseDom(new URL(s.url).hostname), s.referer); } catch {} }
  if (streams.length && streams[0].referer) { sdLastRef = streams[0].referer; sdLastAt = Date.now(); }
  return { streams, note: streams.length ? '' : (r.pending ? 'السيرفرات ما زالت قيد المعالجة' : '') };
});

// حلّ أي رابط سيرفر (Uqload, Mp4upload, Voe, Dood, Mediafire...) لرابط فيديو مباشر باش يتشغّل داخل التطبيق
function toEmbed(u) {
  try {
    const x = new URL(u), h = x.hostname.replace(/^www\./, ''), id = x.pathname.split('/').filter(Boolean).pop() || '';
    if (/uqload/i.test(h)) return `https://${h}/embed-${id.replace(/\.html$/, '')}.html`;
    if (/mp4upload/i.test(h)) return `https://www.mp4upload.com/embed-${id.replace(/\.html$/, '')}.html`;
    if (/dsvplay|dood|d000d|ds2play/i.test(h)) return `https://${h}/e/${id}`;
    if (/voe\.sx/i.test(h)) return `https://voe.sx/e/${id}`;
    if (/mixdrop|mixdrp|mdy48tn|mxcontent/i.test(h)) return `https://${h}/e/${id}`;
    if (/vidmoly|vidoza/i.test(h)) return `https://${h}/embed-${id.replace(/\.html?$/, '')}.html`;
    if (/streamwish|awish|dwish|wishfast|embedwish|hlswish|swhoi|sfastwish|strwish|wishonly|vidhide|vidhidepro|vidhidevip|dhcplay|filelions|vidspeed|callistanise|filemoon|moonplayer|kerapoxy|bysezoxexe|lulustream|luluvdo|lulu\.st|streamhg|earnvids|upstream|vtube/i.test(h)) return /\/(?:e|embed)\//.test(x.pathname) ? u : `https://${h}/e/${id}`;
    if (/streamtape|strtape|shavetape|stape\./i.test(h)) return `https://${h}/e/${id}`;
  } catch {}
  return u;
}
const hostCache = new Map();   // رابط السيرفر -> { t, r }  (نتيجة التحليل، 4 دقايق)
const rememberRef = (r) => { try { if (r && r.url && r.referer) { sdRef.set(baseDom(new URL(r.url).hostname), r.referer); sdLastRef = r.referer; sdLastAt = Date.now(); } } catch {} };
async function resolveAny(url) {
  url = String(url || '');
  if (!/^https?:\/\//i.test(url)) return null;
  const c = hostCache.get(url);
  if (c && Date.now() - c.t < 4 * 60e3) { rememberRef(c.r); return c.r; }
  let r = null;
  if (/mediafire\./i.test(url)) { const d = await mediafireDirect(url); r = d ? { url: d, type: 'mp4' } : null; }
  else if (/\.(mp4|m3u8|webm|mkv|avi|mov|m4v|flv|ts|ogv|3gp)(\?|$)/i.test(url)) r = { url, type: /\.m3u8/i.test(url) ? 'hls' : 'mp4' };
  else {
    const emb = toEmbed(url), x = await sdUni.resolve(emb);
    // ما قدرناش نجيبو فيديو مباشر؟ نخلّيو صفحة السيرفر تتعرض داخل التطبيق (iframe)
    r = x && x.url ? { url: x.url, type: x.type, referer: x.referer } : { embed: emb };
  }
  if (r) { hostCache.set(url, { t: Date.now(), r }); rememberRef(r); }
  return r;
}
ipcMain.handle('host:resolve', async (_e, url) => {
  const r = await resolveAny(url);
  if (!r) return null;
  return r.embed ? { embed: r.embed } : { url: r.url, type: r.type, referer: r.referer || (() => { try { return sdRef.get(baseDom(new URL(r.url).hostname)) || ''; } catch { return ''; } })() };
});
// فحص سيرفر: نحلّوه ونجرّبو نجيبو أول بايتات الفيديو؛ اللي ما خدمش كيتحيّد من اللائحة
ipcMain.handle('host:check', async (_e, url) => {
  try {
    const r = await Promise.race([resolveAny(url), new Promise((res) => setTimeout(() => res(null), 25000))]);
    if (!r) return { ok: false };
    if (r.embed) return { ok: false, embed: r.embed };
    if (r.checked === undefined) {
      let ref = r.referer || ''; try { ref = ref || sdRef.get(baseDom(new URL(r.url).hostname)) || ''; } catch {}
      r.checked = await sdUni.probe(r.url, ref, 9000, r.type);
    }
    return { ok: !!r.checked, url: r.url, type: r.type, referer: ref };
  } catch { return { ok: false }; }
});

// ===== التحميلات: نحمّلو الحلقة لقرص الجهاز باش تتشاف بلا إنترنت =====
const dlFs = require('fs');
const { pathToFileURL } = require('url');
const dlFolder = () => { const d = path.join(app.getPath('userData'), 'downloads'); dlFs.mkdirSync(d, { recursive: true }); return d; };
const dlIdx = () => path.join(app.getPath('userData'), 'downloads.json');
const dlRead = () => { try { return JSON.parse(dlFs.readFileSync(dlIdx(), 'utf8')); } catch { return []; } };
const dlWrite = (l) => { try { dlFs.writeFileSync(dlIdx(), JSON.stringify(l)); } catch {} };
const dlJobs = new Map();   // key -> { entry, cancel }
const dlRefFor = (url) => { try { const h = new URL(url).hostname; return sdRef.get(baseDom(h)) || (Date.now() - sdLastAt < 3 * 3600e3 ? sdLastRef : ''); } catch { return ''; } };
ipcMain.handle('dl:list', () => {
  const out = dlRead().filter((e) => { try { return dlFs.existsSync(e.file); } catch { return false; } }).map((e) => ({ ...e, fileUrl: pathToFileURL(e.file).href, posterUrl: e.posterFile && dlFs.existsSync(e.posterFile) ? pathToFileURL(e.posterFile).href : '' }));
  for (const j of dlJobs.values()) out.unshift({ ...j.entry });
  return out;
});
ipcMain.handle('dl:cancel', (_e, key) => { const j = dlJobs.get(key); if (j) j.cancel(); return true; });
ipcMain.handle('dl:delete', (_e, key) => {
  const l = dlRead(), e = l.find((x) => x.key === key);
  if (e) { try { dlFs.unlinkSync(e.file); } catch {} try { e.posterFile && dlFs.unlinkSync(e.posterFile); } catch {} dlWrite(l.filter((x) => x.key !== key)); }
  return true;
});
ipcMain.handle('dl:start', async (ev, job) => {
  job = job || {};
  const key = String(job.animeId) + ':' + String(job.num);
  if (dlJobs.has(key)) return { ok: false, error: 'التحميل جاري' };
  if (dlRead().some((x) => x.key === key && dlFs.existsSync(x.file))) return { ok: false, error: 'هذه الحلقة محمّلة من قبل' };
  const url = String(job.url || ''); if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'رابط غير صالح' };
  const safe = (t) => String(t || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'anime';
  const file = path.join(dlFolder(), safe(job.name) + ' - ' + safe(job.num) + ' - ' + Date.now().toString(36) + '.mp4');
  // نحفظو البوستر فـ الجهاز باش يبان حتى بلا إنترنت
  let posterFile = '';
  try {
    const pf = path.join(dlFolder(), 'p-' + require('crypto').createHash('md5').update(key).digest('hex').slice(0, 10) + '.jpg');
    const grab = async (u) => { const o = (() => { try { return new URL(u).origin + '/'; } catch { return ''; } })(); const r = await fetch(u, { headers: { 'User-Agent': UA, Referer: o }, signal: AbortSignal.timeout(8000) }); if (!r.ok) return false; const buf = Buffer.from(await r.arrayBuffer()); if (buf.length < 800) return false; dlFs.writeFileSync(pf, buf); return true; };
    let ok = false;
    if (/^https?:/i.test(job.poster || '')) ok = await grab(job.poster).catch(() => false);
    if (!ok) { const u = await coverFor(job.name); if (u) ok = await grab(u).catch(() => false); }
    if (ok) posterFile = pf;
  } catch {}
  const entry = { key, animeId: job.animeId, name: job.name || '', poster: job.poster || '', posterFile, posterUrl: posterFile ? pathToFileURL(posterFile).href : '', num: String(job.num), file, size: 0, t: Date.now(), status: 'downloading', pct: 0 };
  let cancelled = false, ctrl = new AbortController(), proc = null;
  const send = (extra) => { Object.assign(entry, extra || {}); try { ev.sender.send('dl:progress', { ...entry }); } catch {} };
  dlJobs.set(key, { entry, cancel: () => { cancelled = true; try { ctrl.abort(); } catch {} try { proc && proc.kill(); } catch {} } });
  (async () => {
    try {
      const ref = dlRefFor(url), headers = { 'User-Agent': UA }; if (ref) { headers['Referer'] = ref; headers['Origin'] = new URL(ref).origin; }
      if (/\.m3u8(\?|$)/i.test(url) || job.type === 'hls') {
        await new Promise((resolve, reject) => {
          const args = ['-y', '-user_agent', UA]; if (ref) args.push('-headers', 'Referer: ' + ref + '\r\n'); args.push('-i', url, '-c', 'copy', file);
          proc = spawn(ffmpegBin(), args, { windowsHide: true }); let dur = 0, buf = '';
          const tsec = (h, m, sec) => (+h) * 3600 + (+m) * 60 + parseFloat(sec);
          proc.stderr.on('data', (d) => {
            buf = (buf + d.toString()).slice(-2000);
            const D = buf.match(/Duration:\s*(\d+):(\d+):([\d.]+)/); if (D && !dur) dur = tsec(D[1], D[2], D[3]);
            const all = [...buf.matchAll(/time=(\d+):(\d+):([\d.]+)/g)], T = all.length ? all[all.length - 1] : null;
            if (T && dur) send({ pct: Math.min(99, Math.round(tsec(T[1], T[2], T[3]) / dur * 100)) });
          });
          proc.on('error', reject);
          proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(cancelled ? 'cancelled' : 'ffmpeg ' + code))));
        });
      } else {
        const res = await fetch(url, { headers, signal: ctrl.signal, redirect: 'follow' });
        if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
        if (/text\/html/i.test(res.headers.get('content-type') || '')) throw new Error('أرجع السيرفر صفحة بدل الفيديو');
        const total = Number(res.headers.get('content-length')) || 0, out = dlFs.createWriteStream(file); let got = 0, last = 0;
        try {
          for await (const chunk of res.body) {
            if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
            got += chunk.length;
            if (Date.now() - last > 400) { last = Date.now(); send({ got, total, pct: total ? Math.round(got / total * 100) : 0 }); }
          }
        } finally { await new Promise((r) => out.end(r)); }
      }
      const size = dlFs.statSync(file).size;
      if (size < 200 * 1024) throw new Error('الملف المحمّل صغير جداً');
      dlWrite([...dlRead().filter((x) => x.key !== key), { key, animeId: entry.animeId, name: entry.name, poster: entry.poster, posterFile: entry.posterFile, num: entry.num, file, size, t: Date.now(), status: 'done' }]);
      dlJobs.delete(key); send({ status: 'done', pct: 100, size });
    } catch (err) {
      try { dlFs.unlinkSync(file); } catch {}
      dlJobs.delete(key); send({ status: cancelled ? 'cancelled' : 'error', error: String((err && err.message) || err) });
    }
  })();
  return { ok: true, key };
});

// ===== Discord Rich Presence =====
let discord; try { discord = require('./discord'); } catch (e) { console.error('discord.js:', e.message); discord = { connect() {}, set() {}, setEnabled() {}, stop() {} }; }   // إذا الملف فيه مشكل، التطبيق يبقى يخدم بلا Presence
ipcMain.handle('rpc:set', (_e, a) => { try { discord.set(a); } catch {} return true; });
ipcMain.handle('rpc:enable', (_e, on) => { try { discord.setEnabled(on); } catch {} return true; });

if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on('second-instance', showMain);
  app.on('before-quit', () => { quitting = true; });
  app.on('web-contents-created', (_e, c) => {   // نمنعو نوافذ الإعلانات المنبثقة ديال السيرفرات
    c.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
  app.whenReady().then(() => { setupMangaImages(); setupSdHeaders(); makeTray(); createWindow(); discord.connect(); });
}
app.on('window-all-closed', () => { stopTorrent(); stopTranscode(); app.quit(); });
app.on('will-quit', () => { stopTorrent(); stopTranscode(); try { discord.stop(); } catch {} });
