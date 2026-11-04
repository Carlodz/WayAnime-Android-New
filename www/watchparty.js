/* ===== مشاهدة مشتركة (Watch Party) =====
   - أيقونة فـ المشغّل → كود → تصيفطو لصديقك → كيدخلو فـ أيقونة الهيدر → نفس الفيديو + نفس الوقت.
   - النقل عبر MQTT على WebSocket (وسيط عمومي مجاني، بلا سيرفر ديالك). الكود كيحدد الوسيط + الغرفة.
   - ملاحظة: كيخدم غير مع المصادر المباشرة (video / HLS) ماشي iframe. */
(() => {
  const BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt', 'wss://test.mosquitto.org:8081/'];
  const PREFIX = 'ABC';                                  // حرف الكود الأول = رقم الوسيط
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const ICON = svg('<circle cx="8.5" cy="8" r="3"/><path d="M3 19v-.8a5.5 5.5 0 0 1 11 0v.8"/><circle cx="17" cy="9" r="2.5"/><path d="M16.2 13.7a4.6 4.6 0 0 1 5.3 4.5v.8"/>');
  const rid = () => Math.random().toString(36).slice(2, 10);
  const E = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- عميل MQTT 3.1.1 صغير (QoS 0) ----------
  const enc = new TextEncoder(), dec = new TextDecoder();
  const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; a.forEach((x) => { o.set(x, p); p += x.length; }); return o; };
  const mstr = (s) => { const b = enc.encode(s); return cat(new Uint8Array([b.length >> 8, b.length & 255]), b); };
  const rlen = (n) => { const o = []; do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; o.push(d); } while (n > 0); return new Uint8Array(o); };
  const pkt = (first, body) => cat(new Uint8Array([first]), rlen(body.length), body);

  function mqttConnect(url, onMsg, onClose) {
    return new Promise((res, rej) => {
      let ws, buf = new Uint8Array(0), ok = false, ping = 0, dead = false;
      try { ws = new WebSocket(url, 'mqtt'); } catch (e) { return rej(e); }
      ws.binaryType = 'arraybuffer';
      const to = setTimeout(() => { if (!ok) { try { ws.close(); } catch {} rej(new Error('timeout')); } }, 8000);
      const send = (u) => { if (ws.readyState === 1) ws.send(u); };
      const api = {
        sub: (t) => send(pkt(0x82, cat(new Uint8Array([0, 1]), mstr(t), new Uint8Array([0])))),
        pub: (t, o) => send(pkt(0x30, cat(mstr(t), enc.encode(JSON.stringify(o))))),
        close: () => { dead = true; clearInterval(ping); try { send(new Uint8Array([0xe0, 0])); ws.close(); } catch {} }
      };
      ws.onopen = () => send(pkt(0x10, cat(mstr('MQTT'), new Uint8Array([4, 2, 0, 30]), mstr('wa' + rid() + rid()))));
      ws.onmessage = (e) => {
        buf = cat(buf, new Uint8Array(e.data));
        while (buf.length >= 2) {
          let mul = 1, len = 0, i = 1, b;
          do { if (i >= buf.length) return; b = buf[i++]; len += (b & 127) * mul; mul *= 128; } while (b & 128);
          if (buf.length < i + len) return;
          const first = buf[0], type = first >> 4, body = buf.slice(i, i + len);
          buf = buf.slice(i + len);
          if (type === 2) {                                   // CONNACK
            if (body[1] === 0) { ok = true; clearTimeout(to); ping = setInterval(() => send(new Uint8Array([0xc0, 0])), 20000); res(api); }
            else { clearTimeout(to); rej(new Error('refused')); }
          } else if (type === 3) {                            // PUBLISH
            const tl = (body[0] << 8) | body[1];
            let p = 2 + tl; if ((first >> 1) & 3) p += 2;
            try { onMsg(dec.decode(body.subarray(2, 2 + tl)), JSON.parse(dec.decode(body.subarray(p)))); } catch {}
          }
        }
      };
      ws.onerror = () => {};
      ws.onclose = () => { clearTimeout(to); clearInterval(ping); if (!ok) rej(new Error('closed')); else if (!dead) onClose(); };
    });
  }

  // ---------- الجلسة ----------
  let S = null;                                              // الجلسة الحالية
  let myName = 'PC';
  window.api.wp.name().then((n) => { myName = n || 'PC'; }).catch(() => {});
  const vid = () => document.querySelector('#pl video');

  async function openChannel(code, role) {
    const idx = Math.max(0, PREFIX.indexOf(code[0])), topic = 'wayanime/wp/' + code;
    const order = role === 'host' ? BROKERS.map((_, i) => i) : [idx];
    let lastErr;
    for (const i of order) {
      try {
        const sess = { id: rid(), role, code: PREFIX[i] + code.slice(1), peer: null, ign: { play: 0, pause: 0, seeked: 0 }, hadPlayer: role === 'host', url: '' };
        const c = await mqttConnect(BROKERS[i], (t, m) => onMsg(sess, m), () => { if (S === sess) { toast('انقطع الاتصال بالجلسة'); leave(false); } });
        c.sub(role === 'host' ? 'wayanime/wp/' + sess.code : 'wayanime/wp/' + PREFIX[i] + code.slice(1));
        sess.c = c; sess.topic = 'wayanime/wp/' + sess.code;
        return sess;
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('fail');
  }
  const tx = (o) => { if (S && S.c) S.c.pub(S.topic, { ...o, id: S.id }); };

  async function host() {
    const v = vid(); if (!v) return toast('افتح فيديو أولاً (مصدر مباشر)');
    if (S) return panel();
    const rnd = Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => ALPHA[b % ALPHA.length]).join('');
    try {
      const s = await openChannel('A' + rnd, 'host');   // أول وسيط يخدم يتختار، والحرف الأول كيتحدّث
      S = s; S.url = currentUrl(); hookVideo(); drawChip(); panel();
    } catch { toast('تعذّر الاتصال بوسيط الجلسة، تأكد من الإنترنت'); }
  }
  async function join(raw) {
    const code = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 6 || PREFIX.indexOf(code[0]) < 0) return toast('الكود غير صحيح');
    if (S) leave(false);
    try {
      const s = await openChannel(code, 'guest');
      S = s; S.hadPlayer = !!vid(); if (vid()) hookVideo();
      tx({ t: 'hello', name: myName });
      panel(); drawChip();
      toast('تم الدخول، بانتظار أن يبدأ صديقك الفيديو…');
    } catch { toast('تعذّر الدخول للجلسة. تأكد من الكود والإنترنت'); }
  }
  function leave(notify) {
    const s = S; if (!s) return;
    if (notify !== false) { try { tx({ t: 'bye' }); } catch {} }
    S = null; setTimeout(() => s.c && s.c.close(), 200);
    document.querySelectorAll('.wpchip,#wp').forEach((n) => n.remove());
    if (s.fs) window.api.wp.fs(false).catch(() => {});
    if (notify !== 'quiet') toast('خرجت من الجلسة');
  }

  // ---------- المزامنة ----------
  const currentUrl = () => { const v = vid(); return (v && (v.currentSrc || v.src)) || (document.querySelector('#pl') || {})._wpUrl || ''; };
  const ig = (n) => { S.ign[n]++; const s = S; setTimeout(() => { if (S === s) s.ign[n] = Math.max(0, s.ign[n] - 1); }, 3000); };
  function remote(name, fn) { if (!S) return; ig(name); fn(); }
  function hookVideo() {
    const v = vid(); if (!v || !S || v._wp === S) return; v._wp = S;
    const s = S, g = (n, f) => v.addEventListener(n, () => { if (S !== s || s.syncing) return; if (s.ign[n === 'seeked' ? 'seeked' : n] > 0) { s.ign[n === 'seeked' ? 'seeked' : n]--; return; } f(); });
    g('play', () => tx({ t: 'play', at: v.currentTime }));
    g('pause', () => tx({ t: 'pause', at: v.currentTime }));
    g('seeked', () => tx({ t: 'seek', at: v.currentTime, paused: v.paused }));
    if (s.role === 'host') { clearInterval(s.tick); s.tick = setInterval(() => { if (S !== s) return clearInterval(s.tick); const x = vid(); if (x) tx({ t: 'tick', at: x.currentTime, paused: x.paused }); }, 4000); }
  }
  function sendOpen() {
    const v = vid(); if (!v || !S || S.role !== 'host') return;
    const title = ((document.querySelector('#pl .ptop b') || {}).textContent || '').trim();
    tx({ t: 'open', url: currentUrl(), title, at: v.currentTime, paused: v.paused });
  }
  function applyState(m) {
    const v = vid(); if (!v) return;
    if (isFinite(m.at) && Math.abs(v.currentTime - m.at) > (m.t === 'tick' ? 2 : 0.6)) remote('seeked', () => { v.currentTime = m.at; });
    if (m.paused === true && !v.paused) remote('pause', () => v.pause());
    if (m.paused === false && v.paused) remote('play', () => v.play().catch(() => {}));
  }
  function openRemote(m) {
    m._rx = m._rx || Date.now();
    if (!/^https?:\/\//i.test(m.url || '')) return;
    S.opening = true;
    const same = vid() && S.url === m.url;
    S.url = m.url;
    if (!same) {
      const s = S; s.syncing = true;                       // ما نصيفطو حتى حاجة للمضيف حتى نتزامنو (باش ما يرجعش الفيديو للصفر)
      attach(m.url, {});
      const v = vid(); if (!v) { s.opening = false; s.syncing = false; return; }
      const pl = document.querySelector('#pl'); pl._wpUrl = m.url;
      const b = pl.querySelector('.ptop b'); if (b && m.title) b.textContent = m.title;
      v.pause(); const wasMuted = v.muted; v.muted = true;  // بلا autoplay من الصفر ولا صوت أثناء التحضير
      const ov = document.createElement('div'); ov.className = 'wpload';
      ov.innerHTML = '<div class="wpspin"></div><p>' + E(m.title || 'مشاهدة مشتركة') + '</p><small>جارٍ تحضير الفيديو مع ' + E(s.peer ? s.peer.name : 'صديقك') + '…</small>';
      (pl.querySelector('.pbox') || pl).appendChild(ov);
      let done = false;
      const finish = () => {
        if (done) return; done = true; clearTimeout(guard);
        const t = (m.paused === false ? m.at + (Date.now() - m._rx) / 1000 : m.at) || 0;   // نعوضو وقت التحميل
        if (isFinite(t) && Math.abs(v.currentTime - t) > 0.6) { ig('seeked'); try { v.currentTime = t; } catch {} }
        if (m.paused === false) { ig('play'); v.play().catch(() => {}); } else if (!v.paused) { ig('pause'); v.pause(); }
        v.muted = wasMuted;
        setTimeout(() => { s.syncing = false; }, 600);
        ov.classList.add('out'); setTimeout(() => ov.remove(), 400);
        s.fs = true; window.api.wp.fs(true).catch(() => {});   // ملء الشاشة غير من بعد ما الفيديو يجهز
      };
      v.addEventListener('play', () => { if (!done) v.pause(); });   // إلا الـ HLS بدا autoplay وحنا مازال كنحضرو
      const guard = setTimeout(finish, 15000);
      v.addEventListener('canplay', finish, { once: true });
      s.opening = false; s.hadPlayer = true; hookVideo(); drawChip();
    } else { S.opening = false; applyState(m); }
    panelClose();
  }
  function onMsg(sess, m) {
    if (S !== sess || !m || m.id === sess.id) return;
    if (sess.peer && m.id !== sess.peer.id) return;          // جلسة بين شخصين فقط
    switch (m.t) {
      case 'hello':
        sess.peer = { id: m.id, name: String(m.name || 'PC').slice(0, 40) };
        if (!m.re) tx({ t: 'hello', name: myName, re: 1 });
        if (sess.role === 'host') { sendOpen(); toast(sess.peer.name + ' دخل للجلسة'); }
        panel(); drawChip(); break;
      case 'open': if (sess.role === 'guest') { m._rx = Date.now(); openRemote(m); } break;
      case 'play': remote0('play', m); break;
      case 'pause': remote0('pause', m); break;
      case 'seek': applyState({ t: 'seek', at: m.at, paused: m.paused }); break;
      case 'tick': if (sess.role === 'guest') applyState(m); break;
      case 'bye': toast((sess.peer ? sess.peer.name : 'صديقك') + ' خرج من الجلسة'); leave('quiet'); break;
    }
  }
  function remote0(kind, m) {
    const v = vid(); if (!v) return;
    if (isFinite(m.at) && Math.abs(v.currentTime - m.at) > 0.6) remote('seeked', () => { v.currentTime = m.at; });
    if (kind === 'play' && v.paused) remote('play', () => v.play().catch(() => {}));
    if (kind === 'pause' && !v.paused) remote('pause', () => v.pause());
  }

  // ---------- الواجهة ----------
  function panelClose() { const p = document.getElementById('wp'); p && p.remove(); }
  function panel() {
    panelClose();
    const p = document.createElement('div'); p.id = 'wp';
    const inPlayer = !!vid();
    let body = '';
    if (!S) {
      body = `<h3>${ICON} مشاهدة مشتركة</h3>
        ${inPlayer ? '<button class="wpb1" id="wpNew">إنشاء جلسة جديدة</button><div class="wpor">أو</div>' : '<p class="wpm">أدخل الكود الذي أرسله لك صديقك:</p>'}
        <div class="wprow"><input id="wpCode" maxlength="9" placeholder="الكود" autocomplete="off" spellcheck="false"><button class="wpb1" id="wpGo">OK</button></div>`;
    } else {
      body = `<h3>${ICON} الجلسة</h3>
        ${S.peer || S.role === 'guest' ? '' : `<p class="wpm">أرسل هذا الكود إلى صديقك:</p><div class="wpcode" id="wpShow">${E(S.code)}</div><button class="wpb1" id="wpCopy">نسخ الكود</button><p class="wpm">بانتظار دخول صديقك…</p>`}
        ${S.role === 'guest' && !S.peer ? '<p class="wpm">بانتظار الاتصال…</p>' : ''}
        <div class="wppeers">${peersHtml()}</div>
        <button class="wpb2" id="wpLeave">مغادرة الجلسة</button>`;
    }
    p.innerHTML = `<div class="wpbox" dir="rtl">${body}<button class="wpx" id="wpClose" title="إغلاق">✕</button></div>`;
    (document.fullscreenElement || document.body).appendChild(p);
    p.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Escape') panelClose(); else if (e.key === 'Enter' && p.querySelector('#wpCode')) p.querySelector('#wpGo').click(); };
    p.onclick = (e) => { if (e.target === p) panelClose(); };
    const q = (i) => p.querySelector(i);
    q('#wpClose').onclick = panelClose;
    if (q('#wpNew')) q('#wpNew').onclick = host;
    if (q('#wpGo')) q('#wpGo').onclick = () => join(q('#wpCode').value);
    if (q('#wpCode')) q('#wpCode').focus();
    if (q('#wpCopy')) q('#wpCopy').onclick = () => { navigator.clipboard.writeText(S.code).then(() => toast('تم نسخ الكود'), () => toast('تعذّر النسخ')); };
    if (q('#wpLeave')) q('#wpLeave').onclick = () => leave(true);
  }
  const peersHtml = () => !S ? '' :
    `<div class="wpme">● ${E(myName)} <small>(أنت)</small></div>` + (S.peer ? `<div class="wpfr">● ${E(S.peer.name)}</div>` : '');
  function drawChip() {
    document.querySelectorAll('.wpchip').forEach((n) => n.remove());
    const box = document.querySelector('#pl .pbox'); if (!S || !box) return;
    const c = document.createElement('div'); c.className = 'wpchip'; c.innerHTML = peersHtml();
    box.appendChild(c);
  }

  // ---------- ربط المشغّل ----------
  const _attach = attach;
  attach = function (url, s) {                                 // eslint-disable-line no-global-assign
    _attach(url, s);
    const pl = document.querySelector('#pl'); if (!pl) return;
    pl._wpUrl = url;
    const top = pl.querySelector('.ptop');
    if (top && !top.querySelector('#pwp')) {
      const b = document.createElement('button'); b.id = 'pwp'; b.title = 'مشاهدة مشتركة'; b.innerHTML = ICON;
      b.onclick = (e) => { e.stopPropagation(); panel(); };
      top.insertBefore(b, top.querySelector('.sp'));
    }
    if (S) {
      S.hadPlayer = true;
      if (!S.opening) { S.url = url; if (S.role === 'host') setTimeout(() => { hookVideo(); sendOpen(); }, 300); else hookVideo(); }
      drawChip();
    }
  };
  const _close = closePlayer;
  closePlayer = function () {                                  // eslint-disable-line no-global-assign
    _close.apply(this, arguments);
    if (S && S.hadPlayer) setTimeout(() => { if (S && !document.querySelector('#pl')) leave(true); }, 0);   // خرجت من المشغّل = خرجت من الجلسة
  };

  // أيقونة الهيدر (للي غادي يدخل بكود) + التنسيق
  const hb = document.getElementById('nParty');
  if (hb) { hb.innerHTML = ICON; hb.onclick = () => panel(); }
  const css = document.createElement('style');
  css.textContent = `
#nParty{flex:none;display:flex;align-items:center;justify-content:center;width:42px;height:42px;padding:0;background:#ffffff14;border:1px solid #ffffff22;border-radius:50%;color:#ff3b4a;-webkit-app-region:no-drag}
#nParty svg.i{width:20px;height:20px}#nParty:hover{background:#ffffff26}
#wp{position:fixed;inset:0;z-index:80;background:#000a;display:flex;align-items:center;justify-content:center;direction:rtl}
.wpbox{position:relative;width:min(380px,90vw);background:#14121c;border:1px solid #ffffff22;border-radius:16px;padding:22px 22px 18px;color:#fff;box-shadow:0 24px 70px #000c;display:flex;flex-direction:column;gap:12px}
.wpbox h3{margin:0;display:flex;align-items:center;gap:8px;font-size:17px}.wpbox h3 svg.i{width:22px;height:22px;color:var(--a1)}
.wpm{margin:0;font-size:13px;opacity:.75}.wpor{text-align:center;opacity:.5;font-size:12px}
.wprow{display:flex;gap:8px}
.wprow input{flex:1;min-width:0;background:#ffffff12;border:1px solid #ffffff2a;border-radius:10px;padding:10px 12px;color:#fff;font-size:18px;letter-spacing:4px;text-align:center;text-transform:uppercase;direction:ltr}
.wpb1,.wpb2{border:0;border-radius:10px;padding:10px 18px;font-weight:700;color:#fff;background:var(--a1);cursor:pointer}
.wpb2{background:#ffffff1f}.wpb1:hover,.wpb2:hover{filter:brightness(1.15)}
.wpcode{font-size:34px;font-weight:800;letter-spacing:8px;text-align:center;direction:ltr;background:#ffffff10;border-radius:12px;padding:12px;user-select:all}
.wpx{position:absolute;top:10px;inset-inline-start:12px;background:none;border:0;color:#fff9;font-size:16px;cursor:pointer}
.wppeers{display:flex;flex-direction:column;gap:6px;font-weight:700}
.wpme{color:#ff3b4a}.wpfr{color:#fff}.wppeers small{font-weight:400;opacity:.6}
#pl .wpchip,.wpchip{position:absolute;top:58px;inset-inline-start:20px;display:flex;flex-direction:column;gap:2px;background:#0008;border-radius:10px;padding:6px 12px;font-size:13px;font-weight:700;direction:ltr;z-index:3;transition:opacity .3s;pointer-events:none}
#pl.idle .wpchip{opacity:0}
.wpload{position:absolute;inset:0;z-index:5;background:#07060c;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:#fff;transition:opacity .4s;direction:rtl}
.wpload.out{opacity:0;pointer-events:none}.wpload p{margin:0;font-weight:700;font-size:18px}.wpload small{opacity:.65}
.wpspin{width:42px;height:42px;border-radius:50%;border:4px solid #ffffff2a;border-top-color:#ff3b4a;animation:wpr .8s linear infinite}@keyframes wpr{to{transform:rotate(360deg)}}
.wpchip .wpme{color:#ff3b4a}.wpchip .wpfr{color:#fff}.wpchip small{display:none}`;
  document.head.appendChild(css);
})();
