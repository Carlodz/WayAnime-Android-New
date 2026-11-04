/* تحسينات الموبايل: تبويب المانجا في الشريط السفلي + تمييز التبويب النشط */
(function () {
  const nav = document.querySelector('header .links');
  if (!nav) return;
  const btn = document.createElement('button');
  btn.id = 'nManga';
  btn.innerHTML = '<svg class="i" viewBox="0 0 24 24"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 19V5.5M9 8h6M9 12h6"/></svg>المانجا';
  nav.appendChild(btn);
  const clear = () => btn.classList.remove('on');
  btn.addEventListener('click', () => { if (typeof window.openManga === 'function') window.openManga(); });
  nav.querySelectorAll('button:not(#nManga)').forEach((b) => b.addEventListener('click', clear, true));
  if (typeof window.openManga === 'function') {
    const om = window.openManga;
    window.openManga = function () { const r = om.apply(this, arguments); nav.querySelectorAll('button').forEach((b) => b.classList.remove('on')); btn.classList.add('on'); return r; };
  }
  // إخفاء زر «تحديث» إذا لم يُضبط مستودع التحديث
  const up = document.getElementById('nUpdate'); if (up && !(window.WA_CFG && window.WA_CFG.UPDATE_REPO)) up.hidden = true;
})();
